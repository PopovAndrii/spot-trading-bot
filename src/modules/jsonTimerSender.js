const EventEmitter = require('events');
const fs = require('fs/promises');
const path = require('path');
const {
  Job,
  Status,
  rebalancedClose,
  deepestFilledIndex,
  gridLegProfit,
  rearmGridLeg,
} = require('../lib/job');
const { InvokeApi } = require('../lib/invokeAPI');
const logBus = require('../lib/logBus');
const { StreamAPI } = require('../lib/streamAPI');
const { Calculator } = require('../lib/calculator');
const { writeFileAtomic } = require('../lib/atomicWrite');
const { recoveryStats } = require('../lib/recoveryStats');
const telegram = require('../lib/telegram');

/**
 * Decides whether the growth of an order's partial fill should be persisted.
 * Pure function — testable without the exchange.
 *
 * @param {Object} stored - the order stored in config (obj[side][id]).
 * @param {Object} message - the API response (getOrder) for this order.
 * @returns {{executedQty:number, cummulativeQuoteQty:number}|null}
 *   fields to write, or null if there's nothing to write (status isn't
 *   PARTIALLY_FILLED, or the filled quantity hasn't grown since the last poll).
 */
/**
 * Marks as CANCELED in the config every order actually placed on the exchange
 * (with an orderId) that hasn't reached a final status. Called after the final
 * cancelOpenOrders in the DONE branch: the exchange pulled the orders, but in the
 * table they stayed NEW — after a restart the recovery scan treated a finished
 * cycle as "live" (false ATTENTION + a locked Save).
 * Pure function — testable without the exchange.
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

// Realized quote flow of a finished cycle from the ACTUAL fills: Σ(SELL quote) −
// Σ(BUY quote) over FILLED orders. For both long and short this equals the cycle
// profit in the quote asset (long: buy low / sell high; short: sell high / buy
// back low — the sign works out either way). Read-only — used only for the
// Telegram completion notice. Pure/testable.
function cycleProfit(obj) {
  const sumFilledQuote = (arr) =>
    (arr || []).reduce((acc, o) => {
      if (!o || o.status !== 'FILLED') return acc;
      const quote =
        o.cummulativeQuoteQty !== undefined && o.cummulativeQuoteQty !== null
          ? parseFloat(o.cummulativeQuoteQty)
          : (parseFloat(o.price) || 0) * (parseFloat(o.executedQty ?? o.quantity) || 0);
      return acc + (Number.isFinite(quote) ? quote : 0);
    }, 0);
  // Hybrid: grid legs bank each oscillation and then reset their fills (rearmGridLeg
  // clears executedQty/cummulativeQuoteQty), so that realized profit is no longer in
  // the BUY/SELL sums — it is accumulated in obj.gridRealized. Fold it back in.
  const gridRealized = Number(obj?.gridRealized) || 0;
  return sumFilledQuote(obj?.SELL) - sumFilledQuote(obj?.BUY) + gridRealized;
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
    this.running = false;
    this.exchangeName = 'binance';

    this.busy = false;

    this.apiFailStreak = 0;
    this.apiOutageNotified = false;

    this.baseAsset = '';
    this.quoteAsset = '';
    this.tickDecimals = 2; // price decimals for notifications; refreshed from the grid on start

    this.API = InvokeApi.getInstance();
    this.job = new Job(process.env.STATUS_APP ? false : true); // Test === true

    this.onExecReport = null;

    this.manualPulls = { BUY: new Set(), SELL: new Set() };

    this.manualReplaces = { BUY: new Map(), SELL: new Map() };

    this.manualReminderAt = 0;
  }

  getSpotStatus(symbol) {
    return this.symbol === symbol ? this.running : false;
  }

  /**
   * Out-of-band readLoop tick — a reaction to executionReport.
   * 50 ms is a debounce in case of a burst of reports (a series of partial fills).
   * If a pass is already running (busy) — do nothing: it'll pick up the fresh
   * statuses via getOrder, and the next tick schedules readLoop as usual.
   */
  #kickTick() {
    if (!this.running) return;
    if (this.busy) return;

    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.readLoop(), 50);
  }

  // periodic reminder about slots pulled manually and not re-placed — the position
  // on them stays open until the person decides. The first trigger fires
  // immediately on detection (including after a server restart, when manual
  // survives in the file), then no more often than REMIND_MS. The channel is
  // logBus, like other operational alerts (network drop, orphan leftover).
  #remindManualStuck(obj) {
    const REMIND_MS = 10 * 60 * 1000; // 10 minutes
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
    // A toast over the UI — visible when the console is collapsed. Self-dismissing
    // (we don't set persist) — it's just a reminder, not a blocking event.
    this.emit('manualStuck', { symbol: this.symbol, text: line });
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
   * On a network drop, every call to the exchange returns { success:false }, the
   * iterator does continue — state doesn't move, but the limit orders on the
   * exchange keep matching by themselves in the meantime. We count consecutive
   * failures and write ONCE to the console that the cycle is running blind; on the
   * first success after a streak — report recovery. We don't touch trading logic.
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
   * Mixes fresh live edits from the file into obj before the iterator writes.
   * A #jobIterator pass is long (a sleep per order) and writes the WHOLE obj: without
   * the merge, a param edit (/calculator/param) or restart (/calculator/restart) made
   * during the pass would be silently lost — a lost update.
   * We don't touch orders (BUY/SELL): their only writer during a cycle is the
   * iterator itself (Save is held by a write-lock while the pair is running).
   */
  #applyManualPulls(obj) {
    for (const side of ['BUY', 'SELL']) {
      for (const i of this.manualPulls[side]) {
        if (obj[side]?.[i]) obj[side][i].manual = true;
      }
    }
  }

  async cancelManualOrder({ side, index, orderId } = {}) {
    if (!this.running) {
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
    if (!this.running) {
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

    // placed → no longer "pulled", the engine polls it as a normal NEW
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

      // Manual-pull marker: a manual single-order cancel writes
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
      // file missing/corrupt — write what we have; writeFileAtomic won't emit broken JSON
    }

    // in-memory manual cancels of this session — apply before writing (in case the
    // file doesn't contain them yet before the first tick after the cancel).
    // Re-places (manualReplaces) are NOT applied here: they're one-shot and persisted in readLoop.
    this.#applyManualPulls(obj);
  }

  /**
   * The entry grid is exhausted (all entries FILLED) and the closes
   * overlapped (≥2 live NEW — a burst fill on a wick). There's nothing left to
   * average into, while several closes hang on pieces of one position. Action:
   * pull the overlapping closes on the exchange, write ONE close at the deepest
   * entry index (quantity/price via rebalancedClose = avg×(1+profit+comm) — exactly
   * what job would place on Start), stop the cycle and notify. We don't poke the
   * limit order ourselves: there's usually a bounce within a minute, and the person
   * decides — Start (the bot places this close) or sell manually higher. Returns
   * true if the preparation was done.
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
    markOpenAsCanceled(obj); // pulled NEWs → CANCELED in the table

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
    this.emit('tableData', obj); // refresh the UI table immediately

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
      // Hybrid DCA/GRID: route to hybridLong/hybridShort so rungs ≥ gridLevel run
      // as recycling grid legs. The averaged-recovery consolidation is a DCA-only
      // safety (it assumes the whole grid folds into one close) — skip it in hybrid,
      // where grid legs are meant to keep several live closes at once.
      const hybrid = obj?.param?.['field-hybrid'] === 'on' || obj?.param?.['field-hybrid'] === true;
      const method = hybrid
        ? strategy.method === 'short'
          ? 'hybridShort'
          : 'hybridLong'
        : strategy.method;

      if (!hybrid && (await this.#maybePrepareRecoveryClose(obj, strategy))) return;

      let i = 0;

      // never started 0
      for (const [key, val] of obj[strategy.side].entries()) {
        if (!this.running) return;

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

        let currentOrder = this.job[method](obj, key, val); // strategy.

        // Hybrid grid leg banked one oscillation (entry + micro-close both FILLED):
        // record the realized quote profit, then re-arm the leg (reset both slots so
        // it buys/sells again at the same level). No API call — pure bookkeeping.
        if (currentOrder.status === 'REARM') {
          if (!this.running) return;
          const id = currentOrder.id;
          const banked = gridLegProfit(obj['BUY'][id], obj['SELL'][id]);
          obj.gridRealized = (Number(obj.gridRealized) || 0) + banked;
          obj.gridCycles = (Number(obj.gridCycles) || 0) + 1;
          rearmGridLeg(obj, id);
          obj.date_modified = new Date().toISOString();

          logBus.log(
            `♻️ ${this.symbol}: grid leg #${id + 1} banked ` +
              `${banked >= 0 ? '+' : ''}${banked.toFixed(this.tickDecimals)} ${this.quoteAsset || ''} ` +
              `(total grid: ${(Number(obj.gridRealized) || 0).toFixed(this.tickDecimals)})`
          );

          await this.#mergeLiveEdits(obj);
          await writeFileAtomic(this.#filePath(), JSON.stringify(obj, null, 2));
          continue;
        }

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

          // Telegram: cycle finished — realized profit in the quote asset from the
          // actual fills (read-only, does not touch trading).
          const profit = cycleProfit(obj);
          telegram.send(
            `🏁 <b>Done</b> ${this.symbol}\n` +
              `Profit: <b>${profit >= 0 ? '+' : ''}${profit.toFixed(this.tickDecimals)}</b> ${this.quoteAsset || ''}\n` +
              `Auto-restart: <b>${this.autoRestart ? 'on' : 'off'}</b>`
          );

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
            if (!this.running) return;
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

        if (!this.running) return;

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
    if (!this.running) return;

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
          .finally(() => {
            this.busy = false;
          });
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

    if (!this.running) return;

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
    if (!this.running) {
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

          // Telegram: a real fill (a TRADE that completed the order). 🟢 BUY / 🔴 SELL.
          if (report.x === 'TRADE' && report.X === 'FILLED') {
            const qty = parseFloat(report.z) || 0; // cumulative filled qty
            const quote = parseFloat(report.Z) || 0; // cumulative quote spent/received
            const avg = qty > 0 ? quote / qty : parseFloat(report.p) || 0;
            const isBuy = report.S === 'BUY';
            telegram.send(
              `${isBuy ? '🟢' : '🔴'} <b>${report.S}</b> ${symbol}\n` +
                `${qty} ${this.baseAsset || ''} @ ${avg.toFixed(this.tickDecimals)}\n` +
                `≈ ${quote.toFixed(this.tickDecimals)} ${this.quoteAsset || ''}`
            );
          }

          this.#kickTick();
        };

        userStream.on('executionReport', this.onExecReport);
        userStream.start(); // a repeated start() is a no-op (isStarted)
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

      this.running = true;

      this.symbol = symbol;

      this.readLoop();

      const startMsg = `🟢 Start: ${this.symbol} | ${this.strategy} | restart: ${this.autoRestart}`;
      console.log(startMsg);
      logBus.log(startMsg);

      // Telegram: cycle start — price (grid base), strategy, auto-restart status.
      let startPrice = '';
      try {
        const obj = JSON.parse(await fs.readFile(this.#filePath(), 'utf8'));
        startPrice = obj?.param?.['field-currency'] || '';
        const td = parseInt(obj?.param?.['field-tickSize'], 10);
        if (Number.isInteger(td) && td >= 0) this.tickDecimals = td;
      } catch {
        // grid file unreadable — send without a price rather than skip the notice
      }
      telegram.send(
        `🟢 <b>Start</b> ${this.symbol}\n` +
          `Strategy: <b>${this.strategy}</b>\n` +
          (startPrice ? `Price: <b>${startPrice}</b> ${this.quoteAsset || ''}\n` : '') +
          `Auto-restart: <b>${this.autoRestart ? 'on' : 'off'}</b>`
      );
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
    this.running = false;

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
      // Same leftover notice over Telegram: the cycle stopped with unsold
      // inventory on hand and the person decides what to do with it.
      telegram.send(`💰 <b>Leftover</b> ${this.symbol}\n${rec.text}`);
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

      const price = this.strategy === 'long' ? data.message.askPrice : data.message.bidPrice;

      // recalculete
      const settings = {
        ...obj['param'],
        'field-currency': `${price}`,
        'field-indent': '0',
      };

      const calc = Calculator.build(settings, this.strategy);

      const tmp = this.#config(calc);
      tmp.param = settings;
      tmp.restart = true;

      // Save to file
      const filePath = path.join(__dirname, '../data', `${this.symbol}-binance.json`);
      await writeFileAtomic(filePath, JSON.stringify(tmp, null, 2), 'utf8');

      // Telegram: the cycle looped — new grid built around the fresh price.
      telegram.send(
        `🔄 <b>Restart</b> ${this.symbol}\n` +
          `Strategy: <b>${this.strategy}</b>\n` +
          `Price: <b>${price}</b> ${this.quoteAsset || ''}`
      );

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
    });

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
module.exports.cycleProfit = cycleProfit;
