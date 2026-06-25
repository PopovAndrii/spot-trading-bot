const EventEmitter = require('events');
const fs = require('fs/promises');
const path = require('path');
const { Job, Status, rebalancedClose, deepestFilledIndex } = require('../lib/job');
const { InvokeApi } = require('../lib/invokeAPI');
const logBus = require('../lib/logBus');
const { StreamAPI } = require('../lib/streamAPI');
const { Calculator } = require('../lib/calculator');
const { writeFileAtomic } = require('../lib/atomicWrite');
const { recoveryStats } = require('../lib/recoveryStats');

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

function needsRecoveryConsolidation(obj, strategy) {
  const entrySide = strategy === 'short' ? 'SELL' : 'BUY';
  const closeSide = strategy === 'short' ? 'BUY' : 'SELL';
  const entries = obj?.[entrySide] || [];
  const closes = obj?.[closeSide] || [];
  if (entries.length === 0) return false;
  if (!entries.every((e) => e?.status === 'FILLED')) return false;
  return closes.filter((c) => c?.status === 'NEW').length >= 2;
}

function manualStuckSlots(obj, pending = { BUY: new Map(), SELL: new Map() }) {
  const out = [];
  for (const side of ['BUY', 'SELL']) {
    const arr = obj?.[side];
    if (!Array.isArray(arr)) continue;
    arr.forEach((o, i) => {
      if (o && o.manual === true && o.status === 'CANCELED' && !pending[side]?.has(i)) {
        out.push({ side, index: i });
      }
    });
  }
  return out;
}

function partialFillDelta(stored, message) {
  if (!message || message.status !== 'PARTIALLY_FILLED') return null;
  if (message.executedQty === undefined) return null;

  const executedQty = parseFloat(message.executedQty) || 0;
  const cummulativeQuoteQty = parseFloat(message.cummulativeQuoteQty) || 0;

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
    this.running = {};
    this.exchangeName = 'binance';

    this.busy = false;

    this.apiFailStreak = 0;
    this.apiOutageNotified = false;

    this.baseAsset = '';
    this.quoteAsset = '';

    this.API = InvokeApi.getInstance();
    this.job = new Job(process.env.STATUS_APP ? false : true); // Test === true

    this.onExecReport = null;

    this.manualPulls = { BUY: new Set(), SELL: new Set() };

    this.manualReplaces = { BUY: new Map(), SELL: new Map() };

    this.manualReminderAt = 0;
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

  // периодическое напоминание о слотах, снятых вручную и не
  // переустановленных — позиция по ним висит открытой, пока человек не решит.
  // Первое срабатывание — сразу при обнаружении (в т.ч. после рестарта сервера,
  // когда manual переживает в файле), затем не чаще REMIND_MS. Канал — logBus,
  // как у прочих операционных алертов (обрыв сети, орфан-остаток).
  #remindManualStuck(obj) {
    const REMIND_MS = 10 * 60 * 1000; // 10 минут
    const stuck = manualStuckSlots(obj, this.manualReplaces);
    if (stuck.length === 0) {
      this.manualReminderAt = 0;
      return;
    }
    const now = Date.now();
    if (now - this.manualReminderAt < REMIND_MS) return;
    this.manualReminderAt = now;

    const list = stuck.map((s) => `${s.side} #${s.index + 1}`).join(', ');
    const line = `⏸️ ${this.symbol}: ${stuck.length} order(s) pulled manually and not re-placed (${list}) — position stays open until you re-place or sell.`;
    console.log(line);
    logBus.log(line);
  }

  async #runToApi(data = {}) {
    if (typeof data.method !== 'string') {
      console.error('Method not specified or has invalid format');
      return null;
    }

    if (typeof this.API[data.method] === 'function') {
      const result = await this.API[data.method](data.data);
      this.#trackApiHealth(result);
      return result;
    }

    console.error(`Method [${data.method}] does not exist`);
    return null;
  }

  /**
   * При сетевом обрыве все вызовы к бирже возвращают
   * { success:false }, итератор делает continue — состояние не двигается, но
   * лимитки на бирже тем временем матчатся сами. Считаем подряд идущие неудачи
   * и ОДИН раз пишем в консоль, что цикл идёт вслепую; на первом успехе после
   * серии — сообщаем о восстановлении. Торговую логику не трогаем.
   */
  #trackApiHealth(result) {
    const ALERT_AT = 5;
    if (!result) return;

    if (result.success === false) {
      this.apiFailStreak++;
      if (this.apiFailStreak === ALERT_AT && !this.apiOutageNotified) {
        this.apiOutageNotified = true;
        logBus.log(
          `⚠️ ${this.symbol}: exchange unreachable (${this.apiFailStreak} failures in a row) — cycle running blind, resting orders are uncontrolled`
        );
      }
      return;
    }

    if (result.success === true) {
      if (this.apiOutageNotified) {
        logBus.log(
          `🟢 ${this.symbol}: exchange connection restored (after ${this.apiFailStreak} failures in a row)`
        );
      }
      this.apiFailStreak = 0;
      this.apiOutageNotified = false;
    }
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
  #applyManualPulls(obj) {
    for (const side of ['BUY', 'SELL']) {
      for (const i of this.manualPulls[side]) {
        if (obj[side]?.[i]) obj[side][i].manual = true;
      }
    }
  }

  async cancelManualOrder({ side, index, orderId } = {}) {
    if (!this.running[this.symbol]) {
      return { success: false, message: 'cycle is not running' };
    }
    if ((side !== 'BUY' && side !== 'SELL') || !Number.isInteger(index) || orderId == null) {
      return { success: false, message: 'invalid cancel request' };
    }

    this.manualPulls[side].add(index);

    const res = await this.#runToApi({
      method: 'cancelOrder',
      data: { symbol: this.symbol, orderId },
    });
    if (!res || res.success === false) {
      this.manualPulls[side].delete(index);
      return res || { success: false, message: 'cancel failed' };
    }

    return { success: true, message: `${side} #${index + 1} cancelled` };
  }

  #applyManualReplaces(obj) {
    let applied = false;
    for (const side of ['BUY', 'SELL']) {
      for (const [i, repl] of this.manualReplaces[side]) {
        const cell = obj[side]?.[i];
        if (!cell) continue;
        cell.status = repl.status;
        cell.orderId = repl.orderId;
        cell.price = repl.price;
        delete cell.manual;
        applied = true;
      }
    }
    return applied;
  }

  async replaceManualOrder({ side, index, price } = {}) {
    if (!this.running[this.symbol]) {
      return { success: false, message: 'cycle is not running' };
    }
    const priceNum = Number(price);
    if (
      (side !== 'BUY' && side !== 'SELL') ||
      !Number.isInteger(index) ||
      !Number.isFinite(priceNum) ||
      priceNum <= 0
    ) {
      return { success: false, message: 'invalid replace request' };
    }

    let slot, tickDecimals;
    try {
      const obj = JSON.parse(await fs.readFile(this.#filePath(), 'utf8'));
      slot = obj[side]?.[index];
      tickDecimals = parseInt(obj?.param?.['field-tickSize'], 10);
    } catch {
      return { success: false, message: 'grid file unreadable' };
    }
    if (!slot || slot.quantity == null) {
      return { success: false, message: 'order slot not found' };
    }

    const pulledManually = this.manualPulls[side].has(index) || slot.manual === true;
    if (!pulledManually) {
      return { success: false, message: 'order was not manually pulled' };
    }
    if (slot.status !== 'CANCELED') {
      return { success: false, message: 'order is not cancelled yet' };
    }

    const placePrice =
      Number.isInteger(tickDecimals) && tickDecimals >= 0
        ? priceNum.toFixed(tickDecimals)
        : String(priceNum);

    const res = await this.#runToApi({
      method: 'newOrder',
      data: {
        id: index,
        symbol: this.symbol,
        side,
        type: 'LIMIT',
        timeInForce: 'GTC',
        quantity: slot.quantity,
        price: placePrice,
      },
    });
    if (!res || res.success === false) {
      return res || { success: false, message: 'replace failed' };
    }

    // размещён → больше не «снятый», движок опрашивает его как обычный NEW
    this.manualPulls[side].delete(index);
    this.manualReplaces[side].set(index, {
      status: 'NEW',
      orderId: res.message.orderId,
      price: placePrice,
    });

    this.#kickTick();

    return { success: true, message: `${side} #${index + 1} re-placed @ ${placePrice}` };
  }

  async #mergeLiveEdits(obj) {
    try {
      const fresh = JSON.parse(await fs.readFile(this.#filePath(), 'utf8'));
      if (fresh.param) obj.param = fresh.param;
      if ('restart' in fresh) obj.restart = fresh.restart;

      // Manual-pull marker (Item 10): a manual single-order cancel writes
      // { status: CANCELED, manual: true } straight to the grid file. The robot
      // owns the file and rewrites it every tick, so without this merge its
      // write would clobber that flag. Carry a manual pull (with its canceled
      // status/orderId) over from the fresh file so the engine can later respect
      // it. No-op until the cancel route actually sets `manual` — nothing writes
      // it yet, so existing behaviour is unchanged.
      for (const side of ['BUY', 'SELL']) {
        const arr = fresh[side];
        if (!Array.isArray(arr)) continue;
        arr.forEach((o, i) => {
          if (o && o.manual && obj[side]?.[i]) {
            obj[side][i].manual = true;
            obj[side][i].status = o.status;
            obj[side][i].orderId = o.orderId;
          }
        });
      }
    } catch {
      // файла нет/битый — пишем что есть; writeFileAtomic не даст битого JSON
    }

    // in-memory ручные отмены этой сессии — наносим перед записью (на случай,
    // если файл их ещё не содержит до первого тика после отмены). Переустановки
    // (manualReplaces) сюда НЕ наносим: они одноразовые и персистятся в readLoop.
    this.#applyManualPulls(obj);
  }

  /**
   * Шаг 3: сетка набора исчерпана (все entry FILLED) и закрытия перекрылись
   * (≥2 живых NEW — залповый залив по фитилю). Усредняться больше нечем, а
   * несколько закрытий висят на куски одной позиции. Действие: снять перекрытые
   * закрытия на бирже, записать ОДНО закрытие на самый глубокий индекс набора
   * (объём/цена по rebalancedClose = avg×(1+profit+comm) — ровно то, что job
   * поставит при Start), остановить цикл и уведомить. Лимитку сами НЕ дёргаем:
   * через минуту обычно отскок, и человек решает — Start (бот выставит этот
   * close) или продать вручную выше. Возвращает true, если подготовка сделана.
   */
  async #maybePrepareRecoveryClose(obj, strategy) {
    if (!needsRecoveryConsolidation(obj, strategy.method)) return false;

    const closeSide = strategy.method === 'short' ? 'BUY' : 'SELL';
    const entrySide = strategy.side;
    const k = deepestFilledIndex(obj[entrySide]);
    const reb = rebalancedClose(obj, k, strategy.method);
    if (!reb) return false;

    const res = await this.#runToApi({ method: 'cancelOpenOrders', data: { symbol: this.symbol } });
    if (!res || res.success === false) return false;
    markOpenAsCanceled(obj); // снятые NEW → CANCELED в таблице

    obj[closeSide][k] = {
      ...obj[closeSide][k],
      status: null,
      orderId: null,
      quantity: reb.quantity,
      price: reb.price,
    };
    obj.date_modified = new Date().toISOString();
    await this.#mergeLiveEdits(obj);
    await writeFileAtomic(this.#filePath(), JSON.stringify(obj, null, 2));
    this.emit('tableData', obj); // обновить таблицу в UI сразу

    const line = `🧰 ${this.symbol}: grid fully filled — consolidated to one ${closeSide} of ${reb.quantity} ${this.baseAsset || ''} @ ${reb.price}. Stopped: press Start to place it, or sell manually.`;
    console.log(line);
    logBus.log(line);

    this.stop();
    return true;
  }

  /**
   * Iterates through the entire table of placed orders.
   * @param {Object} obj - Configuration of order data from file or database.
   * @returns {Stop()} - Stop the cycle.
   */
  async #jobIterator(obj = {}) {
    const strategy = this.#strategy();

    if (obj.status == Status.READY && strategy != null) {

      if (await this.#maybePrepareRecoveryClose(obj, strategy)) return;

      let i = 0;

      // never started 0
      for (const [key, val] of obj[strategy.side].entries()) {

        if (!this.running[this.symbol]) return;

        const cellStatus = obj[strategy.side][key]['status'];
        if (
          cellStatus === 'NEW' ||
          cellStatus === null ||
          cellStatus === 'CANCELED' ||
          cellStatus === 'PARTIALLY_FILLED'
        ) {
          if (i === parseFloat(obj['param']['field-activeOrders'])) {
            return;
          }
          i++;
        }

        let currentOrder = this.job[strategy.method](obj, key, val); // strategy.

        if (currentOrder.status === Status.DONE) {
          const result = await this.#runToApi(currentOrder); // cancelOpenOrders

          if (currentOrder.leftover) {
            const { quantity, price } = currentOrder.leftover;
            const base = this.baseAsset || '';
            const quote = this.quoteAsset || '';
            const notional = (parseFloat(quantity) || 0) * (parseFloat(price) || 0);
            logBus.log(
              `⚠️ ${this.symbol}: cycle closed, ${quantity} ${base} left unsold ` +
              `(~${notional.toFixed(8)} ${quote}) — below exchange minimum to re-close. ` +
              `Funds are on the exchange; decide manually (swap or keep).`
            );
          }

          markOpenAsCanceled(obj);

          obj.status = Status.DONE;
          obj.date_modified = new Date().toISOString();

          await this.#mergeLiveEdits(obj);

          this.autoRestart = obj.restart == true ? true : false;

          await writeFileAtomic(this.#filePath(`${Date.now()}-`), JSON.stringify(obj, null, 2));

          const stranded = recoveryStats(obj);

          if (this.autoRestart && !stranded) {
            // await this.#sleep(500);
            this.restartCycle(obj);
            await this.#sleep(100);

            return;
          } else {
            if (this.autoRestart && stranded) {
              const skipMsg = `⏸️ ${this.symbol}: auto-restart canceled — unsold inventory left over`;
              console.log(skipMsg);
              logBus.log(skipMsg);
            }

            await writeFileAtomic(this.#filePath(), JSON.stringify(obj, null, 2));
            this.stop();
            return;
          }

        }

        if (currentOrder.status === 'pass') {
          console.log(`${this.symbol} ${JSON.stringify(currentOrder)}`);
          // await this.#sleep(100);
          continue;
        } // processed order (api request not needed) or test loop

        const result = await this.#runToApi(currentOrder);

        if (result === null || result.success === false) {
          continue;
        }

        if (result.message.status === currentOrder.status) {

          const stored = obj[result.message.side]?.[currentOrder['id']];
          const delta = partialFillDelta(stored, result.message);

          if (delta) {
            if (!this.running[this.symbol]) return;
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

        if (result.message.executedQty !== undefined) {
          toObj.executedQty = parseFloat(result.message.executedQty) || 0;
          toObj.cummulativeQuoteQty = parseFloat(result.message.cummulativeQuoteQty) || 0;
        }

        if (!this.running[this.symbol]) return;

        // result.message.side == "SELL" or "BUY"
        // currentOrder['id'] !== [key] !!!
        Object.assign(obj[result.message.side][currentOrder['id']], toObj);

        await this.#mergeLiveEdits(obj);
        await writeFileAtomic(this.#filePath(), JSON.stringify(obj, null, 2));

        await this.#sleep(250);
      }
    }
  }

  async readLoop() {
    if (!this.running[this.symbol]) return;

    try {
      const content = await fs.readFile(this.#filePath(), 'utf8');
      const data = JSON.parse(content);

      this.#applyManualPulls(data);

      if (!this.busy) {
        this.busy = true;

        if (this.#applyManualReplaces(data)) {
          try {
            await writeFileAtomic(this.#filePath(), JSON.stringify(data, null, 2));
            this.manualReplaces = { BUY: new Map(), SELL: new Map() };
          } catch (err) {
            console.error('persist manual re-place:', err);
          }
        }

        this.#jobIterator(data)
          .catch((err) => console.error('jobIterator:', err))
          .finally(() => { this.busy = false; });
      }

      this.#remindManualStuck(data);

      this.interval = Math.max(
        1000,
        Number(data['BUY'].length * data['param']['field-requestFrequency']) || 5000
      );

      this.emit('tableData', data);
    } catch (err) {
      console.error(this.#filePath(), 'Error reading file:', err);
    }

    if (!this.running[this.symbol]) return;

    this.timer = setTimeout(() => this.readLoop(), this.interval || 5000);
  }

  async #loadExchangeLimits(api, symbol) {
    try {
      const info = await api.exchangeInfo({ symbol });
      if (!info.success) return;
      const s = info.message.symbols?.[0] || {};
      const filters = s.filters || [];
      const lot = filters.find((f) => f.filterType === 'LOT_SIZE');
      const notional = filters.find((f) => f.filterType === 'NOTIONAL');
      this.job.minQty = lot ? parseFloat(lot.minQty) || 0 : 0;
      this.job.minNotional = notional ? parseFloat(notional.minNotional) || 0 : 0;
      this.baseAsset = s.baseAsset || '';
      this.quoteAsset = s.quoteAsset || '';
    } catch (err) {
      console.error('loadExchangeLimits:', err);
    }
  }

  async start(symbol, strategy, options = {}) {

    if (!this.running[symbol]) {
      // this.strategy = (this.strategy == null) ? strategy : this.strategy;
      this.strategy = strategy == 'short' ? 'short' : 'long';

      this.autoRestart = options.autoRestart || false;

      this.apiFailStreak = 0;
      this.apiOutageNotified = false;

      this.manualPulls = { BUY: new Set(), SELL: new Set() };
      this.manualReplaces = { BUY: new Map(), SELL: new Map() };
      this.manualReminderAt = 0;

      const api = InvokeApi.getInstance();

      await this.#loadExchangeLimits(api, symbol);

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

      streamAPI.removeAllListeners('message');
      streamAPI.removeAllListeners('maxReconnectReached');
      streamAPI.removeAllListeners('reconnected');
      streamAPI.start();
      streamAPI.on('message', (data) => {
        this.emit('price', data);
      });

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

    await this.#emitRecovery();

    this.emit('stopped', this.symbol);
  }

  async #emitRecovery() {
    try {
      const obj = JSON.parse(await fs.readFile(this.#filePath(), 'utf8'));
      const rec = recoveryStats(obj);
      if (!rec) return;
      const line = `💰 ${this.symbol}: ${rec.text}`;
      console.log(line);
      logBus.log(line);
      this.emit('recovery', { symbol: this.symbol, text: rec.text });
    } catch (err) {
      console.warn('🟡 recoveryStats failed:', err.message);
    }
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

      const calc = Calculator.build(settings, this.strategy);

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
module.exports.needsRecoveryConsolidation = needsRecoveryConsolidation;
module.exports.manualStuckSlots = manualStuckSlots;
