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

const activeSymbols = new Set();

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
    this.autoRestart = false;  // ← ДОБАВЬ
    this.running = [];
    this.exchangeName = 'binance';

    this.busy = false; // идёт ли проход #jobItaretor (защита от наслаивания)

    this.API = new InvokeApi();
    this.job = new Job(process.env.STATUS_APP ? false : true); // Test === true
  }

  getSpotStatus(symbol) {
    return this.running[symbol];
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
   * Iterates through the entire table of placed orders.
   * @param {Object} obj - Configuration of order data from file or database.
   * @returns {Stop()} - Stop the cycle.
   */
  async #jobItaretor(obj = {}) {
    const strategy = this.#strategy();

    if (obj.status == Status.REDY && strategy != null) {
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
          const result = await this.#runToApi(currentOrder);

          // this.#applyStatusesToOrders(obj['BUY'], result);
          // this.#applyStatusesToOrders(obj['SELL'], result);

          obj.status = Status.DONE;
          obj.date_modified = new Date().toISOString();

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

        await writeFileAtomic(this.#filePath(), JSON.stringify(obj, null, 2));

        await this.#sleep(500);
      }
    }
  }

  #applyStatusesToOrders(orders, statuses) {
    orders.forEach((order) => {
      const match = statuses.find((status) => status.orderId === order.orderId);
      if (match) {
        order.status = match.status;
      }
    });
  }

  async readLoop() {
    if (!this.running[this.symbol]) return;

    try {
      const content = await fs.readFile(this.#filePath(), 'utf8');
      const data = JSON.parse(content);

      // один проход за раз: если предыдущий ещё идёт — пропускаем тик, но
      // планировщик не блокируем (устойчиво к медленным/зависшим запросам).
      // stop() реагирует через guard внутри #jobItaretor (this.running).
      if (!this.busy) {
        this.busy = true;
        this.#jobItaretor(data)
          .catch((err) => console.error('jobItaretor:', err))
          .finally(() => { this.busy = false; });
      }

      this.interval = data['BUY'].length * data['param']['field-requestFrequency'];

      // needs for update teble on UI
      const message = JSON.stringify({ type: 'data', data });

      this.wss.clients.forEach((client) => {
        if (client.readyState === 1) {
          client.send(message);
        }
      });
    } catch (err) {
      console.error(this.#filePath(), 'Error reading file:', err);
    }

    if (!this.running[this.symbol]) return; // остановлены во время прохода — не планируем следующий тик
    this.timer = setTimeout(() => this.readLoop(), this.interval);
  }

  async start(symbol, strategy, options = {}) {

    if (!this.running[symbol]) {
      // this.strategy = (this.strategy == null) ? strategy : this.strategy;
      this.strategy = strategy == 'short' ? 'short' : 'long';

      this.autoRestart = options.autoRestart || false;

      const api = new InvokeApi();

      // const userStream = api.getUserStream();
      // userStream.start();
      // userStream.on('executionReport', (order) => {
      //   console.log(`Execute order Stream`);
      // });
      // userStream.on('balance', (data) => {
      //   console.log(`Balance Stream`);
      // });

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

    // UserStreamAPI.removeInstance();
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
