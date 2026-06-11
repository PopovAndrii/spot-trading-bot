const EventEmitter = require('events');
const fs = require('fs/promises');
const path = require('path');
const { Job, Status } = require('../lib/job');
const { InvokeApi } = require('../lib/invokeAPI');
const logBus = require('../lib/logBus');
const { StreamAPI } = require('../lib/streamAPI');
const { Calculator } = require('../lib/calculator');
const { writeFileAtomic } = require('../lib/atomicWrite');
// const { UserStreamAPI } = require('../lib/UserStreamApi');

/**
 * Решает, нужно ли персистить рост частичного исполнения ордера.
 * Чистая функция — тестируется без биржи (REQUIREMENTS.md п.20).
 *
 * @param {Object} stored - сохранённый в конфиге ордер (obj[side][id]).
 * @param {Object} message - ответ API (getOrder) по этому ордеру.
 * @returns {{executedQty:number, cummulativeQuoteQty:number}|null}
 *   поля для записи, либо null если писать нечего (статус не PARTIALLY_FILLED
 *   или объём исполнения не вырос с прошлого опроса).
 */
/**
 * Помечает в конфиге CANCELED все ордера, реально размещённые на бирже
 * (orderId) и не дошедшие до финального статуса. Вызывается после финального
 * cancelOpenOrders в DONE-ветке: биржа ордера сняла, но в таблице они
 * оставались NEW — recovery-скан после рестарта считал завершённый цикл
 * «живым» (ложный ATTENTION + заблокированный Save).
 * Чистая функция — тестируется без биржи.
 */
function markOpenAsCanceled(obj) {
  for (const side of ['BUY', 'SELL']) {
    for (const o of obj[side] || []) {
      if (o && o.orderId != null && (o.status === 'NEW' || o.status === 'PARTIALLY_FILLED')) {
        o.status = 'CANCELED';
      }
    }
  }
  return obj;
}

function partialFillDelta(stored, message) {
  if (!message || message.status !== 'PARTIALLY_FILLED') return null;
  if (message.executedQty === undefined) return null;

  const executedQty = parseFloat(message.executedQty) || 0;
  const cummulativeQuoteQty = parseFloat(message.cummulativeQuoteQty) || 0;

  // объём не изменился с прошлого опроса — лишняя запись в ФС не нужна
  if (stored && stored.executedQty === executedQty) return null;

  return { executedQty, cummulativeQuoteQty };
}

class JsonTimerSender extends EventEmitter {
  constructor(wss, strategy = null) {
    super();
    this.wss = wss;
    this.timer = null;
    this.symbol = null;
    this.strategy = strategy;
    this.autoRestart = false;
    this.running = {}; // словарь по символу (раньше был массив — работало случайно)
    this.exchangeName = 'binance';

    this.busy = false; // идёт ли проход #jobIterator (защита от наслаивания)

    this.API = new InvokeApi();
    this.job = new Job(process.env.STATUS_APP ? false : true); // Test === true

    this.onExecReport = null; // слушатель user data stream (снимается в stop)
  }

  getSpotStatus(symbol) {
    return this.running[symbol];
  }

  /**
   * Внеочередной тик readLoop — реакция на executionReport (ANALYSIS п.10).
   * 50 мс — дебаунс на случай шквала отчётов (серия частичных исполнений).
   * Если проход уже идёт (busy) — ничего не делаем: он подхватит свежие
   * статусы через getOrder, а следующий тик запланирует readLoop как обычно.
   */
  #kickTick() {
    if (!this.running[this.symbol]) return;
    if (this.busy) return;

    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.readLoop(), 50);
  }

  async #runToApi(data = {}) {
    if (typeof data.method !== 'string') {
      console.error('Method not specified or has invalid format');
      return null;
    }

    if (typeof this.API[data.method] === 'function') {
      const result = await this.API[data.method](data.data);
      return result;
    }

    console.error(`Method [${data.method}] does not exist`);
    return null;
  }

  #strategy() {
    if (this.strategy === 'short') {
      return { method: 'short', side: 'SELL' };
    }

    if (this.strategy === 'long') {
      return { method: 'long', side: 'BUY' };
    }

    return null;
  }

  /**
   * Подмешивает в obj свежие live-правки из файла перед записью итератора.
   * Проход #jobIterator долгий (sleep на каждый ордер) и пишет ВЕСЬ obj целиком:
   * без мерджа правка param (/calculator/param) или restart (/calculator/restart),
   * сделанная во время прохода, молча терялась — lost update (ANALYSIS.md п.1.3).
   * Ордера (BUY/SELL) не трогаем: их единственный писатель во время цикла — сам
   * итератор (Save заблокирован write-lock'ом, пока пара running).
   */
  async #mergeLiveEdits(obj) {
    try {
      const fresh = JSON.parse(await fs.readFile(this.#filePath(), 'utf8'));
      if (fresh.param) obj.param = fresh.param;
      if ('restart' in fresh) obj.restart = fresh.restart;
    } catch {
      // файла нет/битый — пишем что есть; writeFileAtomic не даст битого JSON
    }
  }

  /**
   * Iterates through the entire table of placed orders.
   * @param {Object} obj - Configuration of order data from file or database.
   * @returns {Stop()} - Stop the cycle.
   */
  async #jobIterator(obj = {}) {
    const strategy = this.#strategy();

    if (obj.status == Status.READY && strategy != null) {
      let i = 0;

      // never started 0
      for (const [key, val] of obj[strategy.side].entries()) {

        // стоп нажат во время прохода — прерываем итератор, не дёргаем API дальше
        if (!this.running[this.symbol]) return;

        if (obj[strategy.side][key]['status'] === "NEW" || obj[strategy.side][key]['status'] === null) {
          if (i === parseFloat(obj['param']['field-activeOrders'])) {
            return;
          }
          i++;
        }

        let currentOrder = this.job[strategy.method](obj, key, val); // strategy.

        if (currentOrder.status === Status.DONE) {
          const result = await this.#runToApi(currentOrder); // cancelOpenOrders

          // cancelOpenOrders снял страховочные ордера на бирже — зафиксировать
          // их отмену в таблице (иначе в истории остаются вечные NEW)
          markOpenAsCanceled(obj);

          obj.status = Status.DONE;
          obj.date_modified = new Date().toISOString();

          // свежий restart: свитч могли переключить во время прохода
          await this.#mergeLiveEdits(obj);

          this.autoRestart = obj.restart == true ? true : false;

          if (this.autoRestart) {
            // write old data
            await writeFileAtomic(this.#filePath(`${Date.now()}-`), JSON.stringify(obj, null, 2));

            await this.#sleep(500);
            this.restartCycle(obj);
            await this.#sleep(500);

            return;
          } else {
            // сначала пишем ОСНОВНОЙ файл (статус DONE + date_modified + итоговые
            // цвета), и только потом stop() → 'stopped'. Иначе клиент дёрнет
            // финальный фетч таблицы раньше записи и снова покажет старое состояние.
            await writeFileAtomic(this.#filePath(), JSON.stringify(obj, null, 2));
            this.stop();
            return;
          }

        }

        if (currentOrder.status === 'pass') {
          logBus.log(`${this.symbol} ${JSON.stringify(currentOrder)}`);
          await this.#sleep(100);
          continue;
        } // processed order (api request not needed) or test loop

        const result = await this.#runToApi(currentOrder);

        if (result === null || result.success === false) {
          continue;
        }

        if (result.message.status === currentOrder.status) {
          // Статус не сменился: ["NEW"] (писать нечего) или ["PARTIALLY_FILLED"].
          // Для частичного исполнения реальный executedQty может расти между
          // опросами, пока статус остаётся PARTIALLY_FILLED. Раньше мы делали
          // continue до блока записи — фактический объём не попадал в файл, и
          // (а) при рестарте сервера терялся, (б) пересчёт закрытия
          // (rebalanceClose) не видел текущий партиал до его отмены/долива.
          // Решение в чистой функции partialFillDelta (тестируется без биржи).
          // См. REQUIREMENTS.md п.20.
          const stored = obj[result.message.side]?.[currentOrder['id']];
          const delta = partialFillDelta(stored, result.message);

          if (delta) {
            Object.assign(stored, delta);
            await this.#mergeLiveEdits(obj);
            await writeFileAtomic(this.#filePath(), JSON.stringify(obj, null, 2));
          }

          await this.#sleep(100);
          continue;
        }

        const toObj = {
          status: result.message.status,
          orderId: result.message.orderId,
        };

        // Этап 3a: фиксируем РЕАЛЬНОЕ исполнение в конфиг (cost basis для пересчёта).
        // getOrder/cancelOrder возвращают полный ордер с этими полями; для cancel
        // это финальные значения отменённого частичного ордера.
        if (result.message.executedQty !== undefined) {
          toObj.executedQty = parseFloat(result.message.executedQty) || 0;
          toObj.cummulativeQuoteQty = parseFloat(result.message.cummulativeQuoteQty) || 0;
        }

        // result.message.side == "SELL" or "BUY"
        // currentOrder['id'] !== [key] !!!
        Object.assign(obj[result.message.side][currentOrder['id']], toObj);

        await this.#mergeLiveEdits(obj);
        await writeFileAtomic(this.#filePath(), JSON.stringify(obj, null, 2));

        await this.#sleep(500);
      }
    }
  }

  async readLoop() {
    if (!this.running[this.symbol]) return;

    try {
      const content = await fs.readFile(this.#filePath(), 'utf8');
      const data = JSON.parse(content);

      // один проход за раз: если предыдущий ещё идёт — пропускаем тик, но
      // планировщик не блокируем (устойчиво к медленным/зависшим запросам).
      // stop() реагирует через guard внутри #jobIterator (this.running).
      if (!this.busy) {
        this.busy = true;
        this.#jobIterator(data)
          .catch((err) => console.error('jobIterator:', err))
          .finally(() => { this.busy = false; });
      }

      // clamp: битые/отсутствующие параметры дают NaN|0 → setTimeout(…, NaN)
      // сработал бы через 0 мс — тугая петля чтения ФС (ANALYSIS.md п.1.2)
      this.interval = Math.max(
        1000,
        Number(data['BUY'].length * data['param']['field-requestFrequency']) || 5000
      );

      // push-обновление таблицы (ANALYSIS п.9): раньше полный конфиг шёл ВСЕМ
      // клиентам как {type:'data'} — фронт его игнорировал (матчит только
      // event) и поллил /spotbot/table каждые 20 с. Теперь websocketRouter
      // рассылает событие 'tableData' только комнате этого символа.
      this.emit('tableData', data);
    } catch (err) {
      console.error(this.#filePath(), 'Error reading file:', err);
    }

    if (!this.running[this.symbol]) return; // остановлены во время прохода — не планируем следующий тик
    // this.interval может быть не присвоен, если чтение упало на первом тике
    this.timer = setTimeout(() => this.readLoop(), this.interval || 5000);
  }

  async start(symbol, strategy, options = {}) {

    if (!this.running[symbol]) {
      // this.strategy = (this.strategy == null) ? strategy : this.strategy;
      this.strategy = strategy == 'short' ? 'short' : 'long';

      this.autoRestart = options.autoRestart || false;

      const api = new InvokeApi();

      // User data stream (ANALYSIS п.10, фаза 1 — «ускоритель»):
      // executionReport по нашему символу запускает внеочередной тик readLoop —
      // реакция на исполнение за миллисекунды вместо ожидания интервала.
      // Файл из обработчика НЕ пишем: источник правды — итератор (getOrder),
      // это исключает гонки записи. Поллинг остаётся фолбэком при лежащем
      // стриме. Без ключей (test-режим без них) стрим не поднимаем.
      if (api.configured) {
        const userStream = api.getUserStream();

        this.onExecReport = (report) => {
          if (report.s !== symbol) return;
          logBus.log(`⚡ ${symbol} executionReport: ${report.S} ${report.X} (order ${report.i})`);
          this.#kickTick();
        };

        userStream.on('executionReport', this.onExecReport);
        userStream.start(); // повторный start() — no-op (isStarted)
      }

      const streamAPI = api.getPublicStream(symbol);
      // не дублировать слушатели при повторном start на singleton-инстансе
      streamAPI.removeAllListeners('message');
      streamAPI.removeAllListeners('maxReconnectReached');
      streamAPI.removeAllListeners('reconnected');
      streamAPI.start();
      streamAPI.on('message', (data) => {
        this.emit('price', data);
      });

      // Длительный сбой прайс-стрима: реконнект продолжается в фоне
      // (capped backoff в StreamAPI), но UI должен знать, что цена замерла.
      streamAPI.on('maxReconnectReached', () => {
        const msg = `⚠️ ${symbol}: price stream lost, reconnecting in background...`;
        logBus.log(msg);
        this.emit('streamState', { symbol, up: false, message: msg });
      });
      streamAPI.on('reconnected', () => {
        const msg = `🟢 ${symbol}: price stream restored`;
        logBus.log(msg);
        this.emit('streamState', { symbol, up: true, message: msg });
      });

      this.running[symbol] = true;

      this.symbol = symbol;

      this.readLoop();

      const startMsg = `🟢 Start: ${this.symbol} | ${this.strategy} | restart: ${this.autoRestart}`;
      console.log(startMsg);
      logBus.log(startMsg);
    }
  }

  #filePath(timestamp = '') {
    return path.join(__dirname, '../data', `${timestamp}${this.symbol}-${this.exchangeName}.json`);
  }

  async stop() {
    clearTimeout(this.timer);

    // user data stream общий для всего аккаунта (singleton) — снимаем только
    // СВОЙ слушатель; сам стрим продолжает жить для других символов и для
    // следующего Start (закрывается целиком в graceful shutdown)
    if (this.onExecReport) {
      this.API.getUserStream().removeListener('executionReport', this.onExecReport);
      this.onExecReport = null;
    }

    StreamAPI.removeInstance(this.symbol);

    this.timer = null;
    this.running[this.symbol] = false;

    const stopMsg = `🛑 Stop: ${this.symbol}`;
    console.log(stopMsg);
    logBus.log(stopMsg);
    this.emit('stopped', this.symbol);
  }

  async restartCycle(obj = {}) {
    try {
      const restartMsg = `🔄 Restarting cycle: ${this.symbol}`;
      console.log(restartMsg);
      logBus.log(restartMsg);

      // Get current price (and param ??)
      const data = await this.API.bookTicker({ symbol: this.symbol });

      const price = (this.strategy === "long") ? data.message.askPrice : data.message.bidPrice;

      // recalculete
      const settings = {
        ...obj['param'],
        'field-currency': `${price}`,
        'field-indent': "0",
      }

      const calc = new Calculator(settings, this.strategy);

      const tmp = this.#config(calc);
      tmp.param = settings;
      tmp.restart = true;

      // Save to file
      const filePath = path.join(__dirname, '../data', `${this.symbol}-binance.json`);
      await writeFileAtomic(filePath, JSON.stringify(tmp, null, 2), 'utf8');

      this.emit('restarted', { symbol: this.symbol, price });

    } catch (err) {
      console.error('❌ Failed to restart cycle:', err);
      this.emit('stopped', this.symbol);
    }
  }

  #config(calcResult = []) {
    const config = {
      id: 'hash-hash',
      status: 0,
      pair: this.symbol,
      param: {},
      date_added: new Date().toISOString(),
      date_modified: null,
      BUY: [],
      SELL: [],
    };

    calcResult.forEach((el, index) => {
      config['BUY'][index] = {
        status: null,
        symbol: this.symbol,
        side: 'BUY',
        type: 'LIMIT',
        quantity: el.buy,
        price: el.buyCurrency,
        timeInForce: 'GTC',
        orderId: null,
      };

      config['SELL'][index] = {
        status: null,
        symbol: this.symbol,
        side: 'SELL',
        type: 'LIMIT',
        quantity: el.totalSell,
        price: el.sellCurrency,
        timeInForce: 'GTC',
        orderId: null,
      };
    })

    return config;
  }

  #sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

module.exports = JsonTimerSender;
module.exports.partialFillDelta = partialFillDelta;
module.exports.markOpenAsCanceled = markOpenAsCanceled;
