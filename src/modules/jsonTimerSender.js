const EventEmitter = require('events');
const fs = require('fs/promises');
const path = require('path');
const {
  Job,
  Status,
  rebalancedClose,
  deepestFilledIndex,
  slotQty,
  slotQuote,
  bankGridLeg,
  hybridDirty,
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

/**
 * Close orders whose price went stale the moment a micro banked: every live
 * whole-position close was priced before this oscillation's profit existed, so
 * it no longer matches what rebalancedClose would place (the bank lowers a long
 * exit / raises a short one). Returns their indices; the REARM handler cancels
 * them and lets the next pass re-place each at the recomputed price. A resting
 * micro is never stale (it IS the scalp) and a manual pull stays the user's.
 * Pure function — testable without the exchange.
 */
function staleCloseIndices(obj, strategy) {
  const closeSide = strategy === 'short' ? 'BUY' : 'SELL';
  const out = [];
  (obj?.[closeSide] || []).forEach((c, i) => {
    if (!c || c.role === 'micro' || c.manual || c.orderId == null) return;
    if (c.status === 'NEW' || c.status === 'PARTIALLY_FILLED') out.push(i);
  });
  return out;
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
// Σ(BUY quote). For both long and short this equals the cycle profit in the quote
// asset (long: buy low / sell high; short: sell high / buy back low — the sign
// works out either way). Read-only — used only for the Telegram completion notice.
//
// "Actual" means every fill the slot has ever carried, not just the FILLED ones: an
// order that partially filled and was then pulled moved real money, and so did the
// orders a slot has replaced (slotQuote folds in filledQuote). Counting only FILLED
// reported a +10 USDT cycle as a −72 USDT one. Pure/testable.
function cycleProfit(obj) {
  const sumFilledQuote = (arr) =>
    (arr || []).reduce((acc, o) => {
      if (!o) return acc;
      // FILLED without fill data = an old config: price × quantity is all we have.
      if (o.status === 'FILLED' && (o.cummulativeQuoteQty === undefined || o.cummulativeQuoteQty === null)) {
        const legacy = (parseFloat(o.price) || 0) * (parseFloat(o.executedQty ?? o.quantity) || 0);
        return acc + (Number.isFinite(legacy) ? legacy : 0);
      }
      const quote = slotQuote(o);
      return acc + (Number.isFinite(quote) ? quote : 0);
    }, 0);
  // Hybrid: grid legs bank each oscillation and then reset their fills (rearmGridLeg
  // clears executedQty/cummulativeQuoteQty), so that realized profit is no longer in
  // the BUY/SELL sums — it is accumulated in obj.gridRealized. Fold it back in.
  const gridRealized = Number(obj?.gridRealized) || 0;
  return sumFilledQuote(obj?.SELL) - sumFilledQuote(obj?.BUY) + gridRealized;
}

// Live price for the hybrid frontier decision: the cached stream tick if it is
// fresh enough, otherwise null — the caller then falls back to a bookTicker
// request. maxAgeMs default 10s: on a liquid pair the @ticker stream pushes about
// once a second, so 10s of quiet already means the cache cannot be trusted for a
// money decision — on an illiquid pair it simply means no trades. Pure/testable.
function freshPrice(price, ts, now, maxAgeMs = 10_000) {
  const p = parseFloat(price);
  if (!Number.isFinite(p) || p <= 0) return null;
  if (!ts || now - ts > maxAgeMs) return null;
  return p;
}

function partialFillDelta(stored, message) {
  if (!message || message.status !== 'PARTIALLY_FILLED') return null;
  if (message.executedQty === undefined) return null;

  const executedQty = parseFloat(message.executedQty) || 0;
  const cummulativeQuoteQty = parseFloat(message.cummulativeQuoteQty) || 0;

  if (stored && stored.executedQty === executedQty) return null;

  return { executedQty, cummulativeQuoteQty };
}

// Is this order still the exchange's to fill?
const isOpen = (status) => status === 'NEW' || status === 'PARTIALLY_FILLED';

// A cycle's strategy is a property of the GRID ON DISK, not of the toggle in the
// browser — the grid's entries and closes are already laid out for one side.
//
// Start believed the toggle. With a short cycle saved, picking Long and pressing
// Start ran the LONG engine over the SHORT's table: the short's buy-back, resting on
// the BUY side, read as an entry buy. Meanwhile the table redrew from the file and
// the toggle snapped back to Short on its own. Seen live.
//
// So the two must agree or nothing starts. Returns the refusal text, or null when
// the start is sound (no grid on disk yet → any strategy is fine). Pure/testable.
function strategyConflict(saved, requested) {
  if (saved !== 'long' && saved !== 'short') return null;
  if (saved === requested) return null;

  return (
    `this pair holds a ${saved.toUpperCase()} cycle — its grid is on disk and its orders may be live. ` +
    `Stop and delete the series, or Calculate + Save a new grid, before starting ${String(requested).toUpperCase()}.`
  );
}

// The one order in the system that rests AT the market and exists to be hit: the
// micro. Cancelling it blind is a race against its own fill — and the engine pulls
// it at exactly the moment it is most likely to have been hit (the price is moving,
// the ladder is deepening, the arm is shifting). Classic never had this problem: it
// only ever cancels closes sitting above the market, which cannot fill while they
// are being pulled. That unspoken invariant — "we only cancel the dead" — is what
// the scalp broke, and one lost fill deadlocked the whole cycle.
//
// So a cancel marked `probe` asks before it swings. Returns the getOrder to run
// first, or null when the call needs no probe. Pure/testable.
function probeCall(currentOrder, slot) {
  if (currentOrder?.probe !== true) return null;
  if (currentOrder.method !== 'cancelOrder') return null;
  if (currentOrder.data?.orderId == null) return null;

  return {
    ...currentOrder,
    method: 'getOrder',
    status: slot?.status ?? null, // the stale status → any real one reads as a change
  };
}

// The exchange refused a cancel because the order is not open (`gone`, -2011): it
// filled between two polls, or the user pulled it by hand. Nothing was cancelled,
// but retrying can never cancel it either — the order is already resolved, and the
// slot that still calls it NEW is the thing that is wrong.
//
// Retried blind, that deadlocks the entire cycle, and it did, live: a micro filled
// unobserved, every pass re-cancelled the phantom, and the whole-position close —
// which may only be placed once every lower close is off the book — was never
// reached. The position sat with no exit order on the exchange for hours.
//
// So a cancel is never the last word on an order it did not cancel: go ask what
// really happened. Returns the getOrder to run in its place (the normal result path
// then records the truth, fill data included, so a filled micro banks and re-prices
// the exit), or null when the result needs no follow-up. Pure/testable.
function cancelFollowUp(currentOrder, result, slot) {
  if (currentOrder?.method !== 'cancelOrder') return null;
  if (result?.gone !== true) return null;
  if (currentOrder.data?.orderId == null) return null; // nothing to ask about

  return {
    ...currentOrder,
    method: 'getOrder',
    status: slot?.status ?? null, // the stale status → any real one is a change
  };
}

// Fields to persist into the slot after an API result changed the order state.
// Pure — the iterator applies it with Object.assign.
//
// On newOrder the ACTUALLY SENT price/quantity are persisted too: rebalanced DCA
// closes and hybrid micro/exit closes are priced at send time, so without this
// the slot keeps the stale plan value — the table then compares the plan against
// itself and either hides a real difference or shows a false "re-placed" badge.
function orderResultPatch(currentOrder, message) {
  const patch = {
    status: message.status,
    orderId: message.orderId,
  };

  if (message.executedQty !== undefined) {
    patch.executedQty = parseFloat(message.executedQty) || 0;
    patch.cummulativeQuoteQty = parseFloat(message.cummulativeQuoteQty) || 0;
  }

  // Hybrid v2: a frontier placement carries the slot's dual role
  // ('micro' | 'exit') so the next tick can tell which close is resting.
  if (currentOrder.role) {
    patch.role = currentOrder.role;
  }

  // cancelReplace persists the SENT price/quantity for the same reason newOrder
  // does: the moved micro is re-priced at send time, so the slot must hold the sent
  // value — otherwise the table shows the stale price and, worse, the next tick's
  // drift check compares the recompute against a stale resting price and re-moves an
  // order that is already where it should be (churn).
  if (currentOrder.method === 'newOrder' || currentOrder.method === 'cancelReplace') {
    if (currentOrder.data?.price !== undefined) patch.price = currentOrder.data.price;
    if (currentOrder.data?.quantity !== undefined) patch.quantity = currentOrder.data.quantity;
  }

  return patch;
}

// Persist an API result into its slot. Beyond orderResultPatch's fields this owns
// the one thing Object.assign cannot express — a deletion. A fresh newOrder that
// carries no role REPLACES whatever the scalp left on the slot, so a stale 'micro'
// marker must go with it: kept, it would let the next tick read the FILLED
// whole-position close as a banked micro (entry FILLED + close FILLED + role
// 'micro' = REARM), bank the entire close into gridRealized and re-arm a rung on a
// position that is already closed. Classic slots never carry a role, so this is a
// no-op for them. Mutates and returns the slot. Pure/testable.
function applyOrderResult(slot, currentOrder, message) {
  if (currentOrder.method === 'newOrder' && !currentOrder.role) delete slot.role;
  bankSlotFills(slot, message);
  return Object.assign(slot, orderResultPatch(currentOrder, message));
}

// The fills of the order LEAVING the slot, before the arriving one overwrites them.
//
// A slot outlives its orders: a close is placed, partially fills, is pulled when the
// bank moves the exit, and a fresh close takes its place. executedQty holds the fill
// of the CURRENT order only, so the moment a new orderId lands, the base and quote
// the pulled order actually traded vanish from the books — while the money sits on
// the exchange. Live, that closed 0.141 BNB for 81.96 USDT and then reported the
// position as still open.
//
// So the outgoing fills are added into the slot's running totals, which every reader
// folds back in (slotQty/slotQuote). rearmGridLeg clears them with the rest of the
// leg: by then the profit is banked in gridRealized and the base is flat, so keeping
// them would double-count. Mutates the slot. Pure/testable.
function bankSlotFills(slot, message) {
  if (!slot) return slot;

  const qty = Number(slot.executedQty) || 0;
  if (qty <= 0) return slot; // nothing traded under the outgoing order
  // Same order coming back from a poll — not a replacement, its fills are its own.
  if (slot.orderId != null && message?.orderId === slot.orderId) return slot;

  slot.filledQty = (Number(slot.filledQty) || 0) + qty;
  slot.filledQuote = (Number(slot.filledQuote) || 0) + (Number(slot.cummulativeQuoteQty) || 0);
  return slot;
}

class JsonTimerSender extends EventEmitter {
  constructor(wss, strategy = null) {
    super();
    this.wss = wss;
    this.timer = null;
    this.symbol = null;
    this.strategy = strategy;
    this.autoRestart = false;
    // Greed Lock: refuse an auto-restart that would build a SHORTER ladder than the
    // cycle that just ended. Orders are sized from the price (orderSize × currency)
    // while the deposit is fixed, so a price rally makes each rung dearer and the
    // last rung no longer fits — that slice of the deposit would sit idle.
    this.greedLock = false;
    this.running = false;
    this.exchangeName = 'binance';

    this.busy = false;

    // A hybrid swap cancelled the resting exit this pass; the replacement is owed on
    // the next one, and it must not wait a full ladder's worth of polling.
    this.swapPending = false;

    this.apiFailStreak = 0;
    this.apiOutageNotified = false;

    // Which blocked-micro state we have already reported ("rung:neededPercent"), so
    // the warning goes out once per rung instead of once per tick. Cleared the moment
    // the micro fits again.
    this.blockedNotice = null;

    this.baseAsset = '';
    this.quoteAsset = '';
    this.tickDecimals = 2; // price decimals for notifications; refreshed from the grid on start

    // Latest tick from the public @ticker stream (hybrid grid/exit decision).
    this.lastPrice = null;
    this.lastPriceTime = 0;

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
      if ('greedLock' in fresh) obj.greedLock = fresh.greedLock;

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
    this.emit('tableData', this.#withView(obj)); // refresh the UI table immediately

    const line = `🧰 ${this.symbol}: grid fully filled — consolidated to one ${closeSide} of ${reb.quantity} ${this.baseAsset || ''} @ ${reb.price}. Stopped: press Start to place it, or sell manually.`;
    console.log(line);
    logBus.log(line);

    this.stop().catch((err) => console.error('stop():', err));
    return true;
  }

  // Trade-event notices over Telegram, driven by the POLL loop — the user stream
  // is a latency optimization and must not be a prerequisite for notifications
  // (on testnet it was silently down for weeks). Called once per persisted slot
  // transition: placement, cancel, and the NEW→FILLED / PARTIAL→FILLED edge.
  // slot is read AFTER Object.assign, so role ('micro') is up to date.
  #notifyOrderEvent(currentOrder, message, slot) {
    const num = currentOrder.id + 1;
    const side = message.side || currentOrder.side || '';
    const role = slot?.role === 'micro' ? ' micro' : slot?.role === 'tail' ? ' tail' : '';

    // One-line-per-event notices batched under the pair header by #jobIterator
    // (telegram.open/flush). The symbol lives in the batch header, so lines omit it.
    if (currentOrder.method === 'cancelOrder') {
      telegram.push(this.symbol, `canceled ${side} #${num}${role}`);
      return;
    }

    if (currentOrder.method === 'newOrder') {
      telegram.push(
        this.symbol,
        `placed ${side} #${num}${role} ${currentOrder.data?.quantity} @ ${currentOrder.data?.price}`
      );
      if (message.status !== 'FILLED') return; // instant taker fill → also report below
    }

    if (message.status === 'FILLED') {
      const qty = parseFloat(message.executedQty) || 0;
      const quote = parseFloat(message.cummulativeQuoteQty) || 0;
      const avg = qty > 0 ? quote / qty : parseFloat(slot?.price) || 0;
      telegram.push(
        this.symbol,
        `filled ${side} #${num}${role} ${qty} @ ${avg.toFixed(this.tickDecimals)}` +
        ` ≈ ${quote.toFixed(this.tickDecimals)} ${this.quoteAsset || ''}`
      );
    }
  }

  // job.price for the hybrid scalp decision: the stream cache when fresh,
  // otherwise one bookTicker request (mid of bid/ask). On total failure the price
  // stays null and the Job conservatively behaves like classic DCA (no scalp).
  async #refreshJobPrice() {
    let p = freshPrice(this.lastPrice, this.lastPriceTime, Date.now());
    if (p == null) {
      try {
        const res = await this.API.bookTicker({ symbol: this.symbol });
        const bid = parseFloat(res?.message?.bidPrice);
        const ask = parseFloat(res?.message?.askPrice);
        if (res?.success && bid > 0 && ask > 0) {
          p = (bid + ask) / 2;
        }
      } catch (err) {
        console.error('refreshJobPrice:', err);
      }
    }
    this.job.price = p;
  }

  // A blocked micro — the scalp does not fit under the split — is the one hybrid
  // state that needs a decision, and the engine used to refuse in silence: the cycle
  // ran on as plain DCA and nothing said why. The table said "raise Grid exit %" and
  // left the only question that matters unanswered: raise it to WHAT. On a pair whose
  // whole gap is a tick or two wide (ETHBTC) guessing costs a cycle.
  //
  // Job.view already computes the percent that would fit (needExit), so this is the
  // fork: field-autoExit ON turns the knob to it, OFF says exactly which knob and to
  // what — once per rung, not once per tick. Auto writes the file itself: the param
  // is re-read off disk every tick (#mergeLiveEdits), so an in-memory-only change
  // would be gone before the next pass reads it.
  async #blockedMicro(obj, strategy) {
    const view = this.job.view(obj, strategy);

    // Not blocked (or nothing to block): clear the notice, so a LATER block on this
    // rung is news again rather than a state we have "already reported".
    if (!view?.enabled || !view.micro || view.deepest == null || view.fits) {
      this.blockedNotice = null;
      return;
    }

    const param = obj.param || {};
    const auto = param['field-autoExit'] === 'on' || param['field-autoExit'] === true;
    const need = view.needExit;
    const cur = param['field-gridExit'];

    if (auto && need != null && String(need) !== String(cur)) {
      param['field-gridExit'] = String(need);
      await writeFileAtomic(this.#filePath(), JSON.stringify(obj, null, 2));

      const line =
        `🎚️ ${this.symbol}: Grid exit ${cur}% → ${need}% — the micro on #${view.deepest} ` +
        `(${view.micro.price}) did not fit under the split (${view.split})`;
      console.log(line);
      logBus.log(line);
      telegram.send(
        `🎚️ <b>${this.symbol}</b>: auto exit\n` +
        `Grid exit <b>${cur}% → ${need}%</b>\n` +
        `micro #${view.deepest} @ ${view.micro.price} — now it fits`
      );

      this.blockedNotice = null;
      this.#kickTick(); // re-run at once: the scalp can be armed on this very rung
      return;
    }

    const key = `${view.deepest}:${need ?? '-'}`;
    if (this.blockedNotice === key) return; // already said it for this rung
    this.blockedNotice = key;

    // No percent fits when the micro needs more room than the WHOLE gap has — then
    // Grid exit % is the wrong knob and only a smaller Micro profit % helps.
    const fix =
      need != null
        ? `raise Grid exit % to ${need} (now ${cur})`
        : `lower Micro profit % (now ${param['field-microProfit']}) — no Grid exit % fits this gap`;

    const line =
      `⚠️ ${this.symbol}: no room for the micro on #${view.deepest} — micro ${view.micro.price} ` +
      `vs split ${view.split}. ${fix}. Until then the cycle runs as plain DCA.`;
    console.log(line);
    logBus.log(line);
    telegram.send(
      `⚠️ <b>${this.symbol}</b>: micro blocked on #${view.deepest}\n` +
      `micro <b>${view.micro.price}</b> vs split <b>${view.split}</b>\n` +
      `${fix}`
    );
  }

  // Attach the engine's own scalp numbers (Job.view) to a table payload. Shallow
  // copy on purpose: `obj` is the very object #jobIterator persists, and the cycle
  // file must not grow a UI-only key. Never throws — a broken view must not take
  // the table down with it.
  #withView(obj) {
    try {
      const strategy = this.#strategy();
      if (!strategy) return obj;
      const hybridView = this.job.view(obj, strategy.method);
      return hybridView ? { ...obj, hybridView } : obj;
    } catch (err) {
      console.error('hybridView:', err);
      return obj;
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
      // Hybrid DCA/GRID: route to hybridLong/hybridShort — classic DCA plus the
      // pause-scalp micro on the deepest held rung. The averaged-recovery
      // consolidation stops the bot on a fully-filled grid; skip it in hybrid,
      // where a fully-filled grid is exactly where the scalp keeps working.
      //
      // The switch is LIVE (#mergeLiveEdits re-reads param every tick), and the
      // two questions it raises are separate:
      //   enabled — may a NEW scalp be armed? Straight from the flag.
      //   routing — who drives this tick? The hybrid keeps the wheel while it
      //     still has a micro on the table (hybridDirty), even after the switch
      //     goes off: handing a resting micro to the classic machine, which has
      //     no concept of the role, would have it poll a rung-sized order as the
      //     whole-position close and call the cycle DONE on its fill. Disabled +
      //     dirty = the hybrid's own out-of-zone branch cancels the micro and
      //     puts the real close back; the cycle drains to clean in a tick or two
      //     and routing falls back to classic on its own.
      const enabled =
        obj?.param?.['field-hybrid'] === 'on' || obj?.param?.['field-hybrid'] === true;
      const hybrid = enabled || hybridDirty(obj, strategy.method);
      const method = hybrid
        ? strategy.method === 'short'
          ? 'hybridShort'
          : 'hybridLong'
        : strategy.method;

      this.job.hybridEnabled = enabled;

      // classic runs never pay for the price plumbing (no request, price unused);
      // neither does a disabled hybrid draining its micro — the scalp gate is shut
      // by the switch before it ever reads the price.
      if (enabled) await this.#refreshJobPrice();

      if (enabled) await this.#blockedMicro(obj, strategy.method);

      if (!hybrid && (await this.#maybePrepareRecoveryClose(obj, strategy))) return;

      // Batch this pass's per-order notices into one Telegram message; flushed in
      // readLoop's finally (and before the Done finale below). See telegram.js.
      telegram.open(this.symbol);

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

        // Hybrid grid leg banked one oscillation (entry + micro-close both done):
        // record the realized quote profit, bump this rung's micro-fire counter
        // (on its close order), then re-arm the leg (reset both slots so it
        // buys/sells again at the same level). No API call — pure bookkeeping.
        if (currentOrder.status === 'REARM') {
          if (!this.running) return;
          const id = currentOrder.id;
          const banked = bankGridLeg(obj, id, this.strategy);
          const closeSide = this.strategy === 'short' ? 'BUY' : 'SELL';
          const fires = Number(obj[closeSide]?.[id]?.hybrid) || 0;
          obj.date_modified = new Date().toISOString();

          logBus.log(
            `♻️ ${this.symbol}: grid leg #${id + 1} banked ` +
            `${banked >= 0 ? '+' : ''}${banked.toFixed(this.tickDecimals)} ${this.quoteAsset || ''} ` +
            `(×${fires}, total grid: ${(Number(obj.gridRealized) || 0).toFixed(this.tickDecimals)})`
          );

          // Telegram: a micro take-profit banked one oscillation — the rung is
          // re-armed and will re-buy on the next dip. ×N = this rung's fire count.
          // Batched under the pair header by open/flush; symbol omitted per line.
          telegram.push(
            this.symbol,
            `micro banked ${closeSide} #${id + 1} ×${fires} ` +
            `${banked >= 0 ? '+' : ''}${banked.toFixed(this.tickDecimals)} ${this.quoteAsset || ''}` +
            ` (grid: ${(Number(obj.gridRealized) || 0).toFixed(this.tickDecimals)})`
          );

          // The bank just moved the exit: every resting whole-position close is
          // now priced off pre-bank math. Pull them — the next pass re-places
          // each through rebalancedClose, which folds the bank in ("current
          // order + profit trim = recalculation → re-entry"). Best-effort:
          // a failed cancel stays live and is retried on the next bank, or swept
          // by the classic machine when it needs the balance anyway.
          let repriced = false;
          for (const j of staleCloseIndices(obj, this.strategy)) {
            const c = obj[closeSide][j];
            const res = await this.#runToApi({
              method: 'cancelOrder',
              data: { id: j, symbol: this.symbol, orderId: c.orderId },
            });
            if (res && res.success !== false) {
              c.status = 'CANCELED';
              // A pulled close may have filled part of the position on its way out,
              // and the cancel response is where the exchange says how much. Record
              // it: the slot is about to be re-used, and only these numbers keep that
              // base and quote on the books (bankSlotFills carries them over).
              if (res.message?.executedQty !== undefined) {
                c.executedQty = parseFloat(res.message.executedQty) || 0;
                c.cummulativeQuoteQty = parseFloat(res.message.cummulativeQuoteQty) || 0;
              }
              repriced = true;
              const partial = Number(c.executedQty) || 0;
              logBus.log(
                `🔁 ${this.symbol}: ${closeSide} #${j + 1} @ ${c.price} pulled — ` +
                'the bank changed the exit, re-placing at the recomputed price' +
                (partial > 0 ? ` (it had closed ${partial} ${this.baseAsset || ''} — kept on the books)` : '')
              );
            }
          }
          if (repriced) this.#kickTick();

          await this.#mergeLiveEdits(obj);
          await writeFileAtomic(this.#filePath(), JSON.stringify(obj, null, 2));
          continue;
        }

        if (currentOrder.status === Status.DONE) {
          // A DONE that came from the scalp carries one last oscillation to bank: the
          // micro that sold the final volume the cycle held. It has to land BEFORE
          // the books close — bankGridLeg re-arms the leg, which clears the fills the
          // profit is computed from, so anything reading them afterwards (the Telegram
          // finale, the archive) would silently lose it.
          if (currentOrder.bank != null) {
            const banked = bankGridLeg(obj, currentOrder.bank, this.strategy);
            const line =
              `♻️ ${this.symbol}: grid leg #${currentOrder.bank + 1} banked ` +
              `${banked >= 0 ? '+' : ''}${banked.toFixed(this.tickDecimals)} ${this.quoteAsset || ''}` +
              ' — it closed the last of the position, so the cycle ends here';
            console.log(line);
            logBus.log(line);
          }

          const result = await this.#runToApi(currentOrder); // cancelOpenOrders

          if (currentOrder.leftover) {
            const { quantity, price } = currentOrder.leftover;
            const base = this.baseAsset || '';
            const quote = this.quoteAsset || '';
            const notional = (parseFloat(quantity) || 0) * (parseFloat(price) || 0);
            logBus.log(
              `⚠️ ${this.symbol}: cycle closed, ${quantity} ${base} left unsold ` +
              `(~${notional.toFixed(8)} ${quote}) — below exchange minimum to re-close. ` +
              'Funds are on the exchange; decide manually (swap or keep).'
            );
          }

          markOpenAsCanceled(obj);

          obj.status = Status.DONE;
          obj.date_modified = new Date().toISOString();

          await this.#mergeLiveEdits(obj);

          this.autoRestart = obj.restart == true ? true : false;
          this.greedLock = obj.greedLock == true ? true : false;

          // Flush any batched order lines from this pass before the standalone
          // finale, so the chat reads batch → Done → Restart, not Done mixed in.
          telegram.flush(this.symbol);

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

          // 'locked' = Greed Lock refused the restart; fall through to the stop path
          // below so the cycle ends cleanly instead of looping into a shorter ladder.
          const outcome =
            this.autoRestart && !stranded ? await this.restartCycle(obj) : 'skipped';

          if (outcome !== 'locked' && outcome !== 'skipped') {
            await this.#sleep(100);

            return;
          } else {
            if (this.autoRestart && stranded) {
              const skipMsg = `⏸️ ${this.symbol}: auto-restart canceled — unsold inventory left over`;
              console.log(skipMsg);
              logBus.log(skipMsg);
            }

            await writeFileAtomic(this.#filePath(), JSON.stringify(obj, null, 2));
            this.stop().catch((err) => console.error('stop():', err));
            return;
          }
        }

        // A role-less resting close whose recompute already matches it byte
        // for byte (the tail landed on the same price the old classic close
        // held) — no order-book action needed, just the role tag so a future
        // FILL routes through the tail-completion path instead of classic's
        // whole-position DONE. No API call.
        if (currentOrder.status === 'STAMP') {
          if (currentOrder.role) obj[currentOrder.side][currentOrder.id].role = currentOrder.role;
          await this.#mergeLiveEdits(obj);
          await writeFileAtomic(this.#filePath(), JSON.stringify(obj, null, 2));
          continue;
        }

        if (currentOrder.status === 'pass') {
          console.log(`${this.symbol} ${JSON.stringify(currentOrder)}`);
          // await this.#sleep(100);
          continue;
        } // processed order (api request not needed) or test loop

        let result = null;

        // Pulling the micro? Ask before swinging: an order that already filled must
        // be BANKED, never "cancelled". Costs one poll per micro pull. See probeCall.
        const probe = probeCall(currentOrder, obj[currentOrder.side]?.[currentOrder.id]);

        if (probe) {
          const polled = await this.#runToApi(probe);

          // Resolved out from under us (filled, or pulled by hand) → there is nothing
          // to cancel. Record what really happened and let the next pass act on it.
          if (polled?.success === true && !isOpen(polled.message?.status)) {
            currentOrder = probe;
            result = polled;
          }
        }

        if (result === null) result = await this.#runToApi(currentOrder);

        // Last resort: it filled in the gap between the probe and the cancel. A cancel
        // that cancelled nothing must not be the last word on the order.
        const followUp = cancelFollowUp(
          currentOrder,
          result,
          obj[currentOrder.side]?.[currentOrder.id]
        );

        if (followUp) {
          currentOrder = followUp;
          result = await this.#runToApi(currentOrder);
        }

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

        if (!this.running) return;

        // result.message.side == "SELL" or "BUY"
        // currentOrder['id'] !== [key] !!!
        applyOrderResult(obj[result.message.side][currentOrder['id']], currentOrder, result.message);

        // A hybrid swap (the full close yielding to the micro, or the micro yielding
        // back) is a cancel now and a placement on the NEXT pass — and a pass is
        // orders × requestFrequency, ten seconds on a full ladder. Ten seconds with
        // the position carrying no exit order at all. Kick an out-of-band tick the
        // moment this pass ends and the replacement lands in ~50 ms instead.
        if (currentOrder.swap) this.swapPending = true;

        this.#notifyOrderEvent(
          currentOrder,
          result.message,
          obj[result.message.side][currentOrder['id']]
        );

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

      // Let the API layer format log prices/quantities to this pair's precision
      // (field-tickSize/field-stepSize hold decimal counts, not raw filter values).
      this.API.setLogDecimals?.(this.symbol, {
        price: parseInt(data?.param?.['field-tickSize'], 10),
        qty: parseInt(data?.param?.['field-stepSize'], 10),
      });

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
            // Send this pass's batched order notices as one framed message. No-op
            // when nothing was queued (the common quiet tick) or already flushed.
            telegram.flush(this.symbol);
            this.busy = false;

            // A hybrid swap pulled the resting exit this pass and its replacement is
            // owed on the next one. Do not make the position wait a full ladder for
            // it — kickTick needs busy to be down, which is why this fires here.
            if (this.swapPending) {
              this.swapPending = false;
              this.#kickTick();
            }
          });
      }

      this.#remindManualStuck(data);

      this.interval = Math.max(
        1000,
        Number(data['BUY'].length * data['param']['field-requestFrequency']) || 5000
      );

      this.emit('tableData', this.#withView(data));
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

  // Open ONLY the public price stream and forward ticks (emit 'price') without
  // starting the trading loop — lets the UI show a live price the moment the
  // user picks Long/Short, before Start. Touches no orders, no user stream and
  // no cycle state; start() supersedes it (its removeAllListeners('message')
  // drops this handler and re-adds its own). Idempotent; a no-op while running.
  watchPrice(symbol) {
    if (this.running || this.watching) return;

    this.symbol = symbol;
    this.watching = true;

    const api = InvokeApi.getInstance();
    const streamAPI = api.getPublicStream(symbol);

    streamAPI.removeAllListeners('message');
    streamAPI.start();
    streamAPI.on('message', (data) => {
      const p = parseFloat(data?.c);
      if (Number.isFinite(p) && p > 0) {
        this.lastPrice = p;
        this.lastPriceTime = Date.now();
      }
      this.emit('price', data);
    });
  }

  async start(symbol, strategy, options = {}) {
    if (!this.running) {
      // this.strategy = (this.strategy == null) ? strategy : this.strategy;
      this.strategy = strategy == 'short' ? 'short' : 'long';

      // The UI's Start button never sends this — the file's own `restart` flag
      // (the same one Save persists) is the real source of truth, exactly like
      // greedLock just below. options.autoRestart stays as an explicit override
      // for callers that DO pass it.
      this.autoRestart = options.autoRestart === true;

      this.apiFailStreak = 0;
      this.apiOutageNotified = false;
      this.blockedNotice = null;

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

          // No Telegram here: fill notices are sent by the poll loop
          // (#notifyOrderEvent), which works even when this stream is down —
          // the push only shortens the reaction time.
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
        // cache the last price for the hybrid frontier decision (data.c = last
        // trade price in the @ticker payload)
        const p = parseFloat(data?.c);
        if (Number.isFinite(p) && p > 0) {
          this.lastPrice = p;
          this.lastPriceTime = Date.now();
        }
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

      // Telegram: cycle start — price (grid base), strategy, auto-restart status.
      let startPrice = '';
      try {
        const obj = JSON.parse(await fs.readFile(this.#filePath(), 'utf8'));
        startPrice = obj?.param?.['field-currency'] || '';
        // Greed Lock lives in the grid file (its own route writes it), not in the
        // start options — the file is the one authority, and #mergeLiveEdits keeps
        // it current if the switch is flipped mid-cycle. Auto-restart is the same
        // story: the file's `restart` is what Save persisted and what the DONE
        // path reads (see below), so Start reports that unless a caller passed
        // an explicit override.
        this.greedLock = obj?.greedLock === true;
        if (options.autoRestart !== true) this.autoRestart = obj?.restart === true;
        const td = parseInt(obj?.param?.['field-tickSize'], 10);
        if (Number.isInteger(td) && td >= 0) this.tickDecimals = td;
      } catch {
        // grid file unreadable — send without a price rather than skip the notice
      }

      this.readLoop();

      const startMsg = `🟢 Start: ${this.symbol} | ${this.strategy} | restart: ${this.autoRestart}`;
      console.log(startMsg);
      logBus.log(startMsg);
      telegram.send(
        `🟩 <b>Start</b> ${this.symbol}\n` +
        `Strategy: <b>${this.strategy}</b>\n` +
        (startPrice ? `Price: <b>${startPrice}</b> ${this.quoteAsset || ''}\n` : '') +
        `Auto-restart: <b>${this.autoRestart ? 'on' : 'off'}</b>`
      );
    }
  }

  #filePath(timestamp = '') {
    return path.join(__dirname, '../data', `${timestamp}${this.symbol}-${this.exchangeName}.json`);
  }

  // Which strategy is the saved cycle? Read straight off the grid on disk — the one
  // authority on it. null = no grid (or unreadable), i.e. nothing to conflict with.
  // Asked BEFORE start(), so it cannot lean on this.symbol.
  async savedStrategy(symbol) {
    try {
      const file = path.join(__dirname, '../data', `${symbol}-${this.exchangeName}.json`);
      const saved = JSON.parse(await fs.readFile(file, 'utf8'))?.param?.['field-strategy'];
      return saved === 'short' || saved === 'long' ? saved : null;
    } catch {
      return null;
    }
  }

  async stop() {
    // running→stopped transition only: stop() is also hit on idempotent repeats
    // (cleanup, shutdown sweep) — those must not notify.
    const wasRunning = this.running;

    // STATE FIRST, teardown second, and nothing between them may throw.
    //
    // stop() is called fire-and-forget from the DONE branch (`this.stop()`, no await,
    // no catch), so anything that throws before `running = false` leaves the engine
    // reporting itself alive forever: getSpotStatus keeps saying "running", the
    // 'stopped' event never fires, and the UI stays locked on a finished cycle with
    // no way back short of a server restart. The stream teardown below is exactly
    // that kind of code — getUserStream() can be null when the socket dropped and is
    // mid-reconnect, which is precisely what happens during a burst of fills.
    clearTimeout(this.timer);
    this.timer = null;
    this.running = false;
    this.watching = false; // stream destroyed below → allow watchPrice() to re-arm

    try {
      if (this.onExecReport) {
        this.API?.getUserStream()?.removeListener('executionReport', this.onExecReport);
        this.onExecReport = null;
      }
      StreamAPI.removeInstance(this.symbol);
    } catch (err) {
      // A leaked listener or a stream instance is a leak, not a reason to keep a
      // finished cycle "running" — the transition has already happened above.
      console.warn('🟡 stop(): stream teardown failed:', err.message);
    }

    const stopMsg = `🛑 Stop: ${this.symbol}`;
    console.log(stopMsg);
    logBus.log(stopMsg);

    if (wasRunning) {
      telegram.send(`🟨 <b>Pause</b> ${this.symbol}`);
    }

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

      const rawPrice = this.strategy === 'long' ? data.message.askPrice : data.message.bidPrice;
      // bookTicker returns the price padded to 8 decimals ("582.22000000"); on a
      // first Start the frontend stores a clean parseFloat'd value. Trim to the
      // pair's tick precision so the restarted config matches (numeric value is
      // identical — this only drops the trailing-zero noise). Fallback: parseFloat.
      const tick = parseInt(obj?.param?.['field-tickSize'], 10);
      const price = Number.isInteger(tick)
        ? Number(rawPrice).toFixed(tick)
        : String(parseFloat(rawPrice));

      // recalculete
      const settings = {
        ...obj['param'],
        'field-currency': `${price}`,
        'field-indent': '0',
      };

      // field-gridArm is the LIVE scalp floor of the cycle that just ENDED — it was
      // aimed at a rung that was filled back then. The new ladder starts empty, so it
      // must not inherit it: the fresh cycle obeys the saved field-gridLevel config
      // again, and the switch re-aims when there is something to aim at.
      delete settings['field-gridArm'];

      const calc = Calculator.build(settings, this.strategy);

      // Greed Lock: the ladder is sized from the LIVE price (orderSize × currency)
      // against a fixed deposit, so after a rally the deepest rung no longer fits and
      // the grid comes back one (or more) orders shorter — that unspent slice of the
      // deposit then sits idle for the whole cycle. Refuse the restart and stop, so
      // the deposit/order size can be raised deliberately instead of silently
      // trading a smaller ladder.
      const prevOrders = Array.isArray(obj.BUY) ? obj.BUY.length : 0;

      if (this.greedLock && prevOrders > 0 && calc.length < prevOrders) {
        // Unspent quote left by the new ladder — what would have gone idle.
        const idle = calc.length ? calc[calc.length - 1].calcBalance : settings['field-deposit'];

        const lockMsg =
          `🔒 ${this.symbol}: greed lock — restart canceled, ` +
          `${calc.length} orders instead of ${prevOrders} (idle ${idle} ${this.quoteAsset || ''})`;
        console.log(lockMsg);
        logBus.log(lockMsg);

        telegram.send(
          `🔒 <b>Greed Lock</b> ${this.symbol}\n` +
          `Restart canceled: <b>${calc.length}</b> orders instead of <b>${prevOrders}</b>\n` +
          `Idle balance: <b>${idle}</b> ${this.quoteAsset || ''}\n` +
          `Price: <b>${price}</b> — raise deposit or order size, then Start`
        );

        return 'locked';
      }

      const tmp = this.#config(calc);
      tmp.param = settings;
      tmp.restart = true;
      // #config() builds a fresh object — carry the flag over or the restarted cycle
      // starts with the switch cleared.
      tmp.greedLock = obj.greedLock === true;

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

      return 'restarted';
    } catch (err) {
      console.error('❌ Failed to restart cycle:', err);
      this.emit('stopped', this.symbol);

      // Not 'locked': the failure path keeps its previous behaviour (emit stopped,
      // no extra stop() call) — only Greed Lock routes into the stop path.
      return 'failed';
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
module.exports.staleCloseIndices = staleCloseIndices;
module.exports.manualStuckSlots = manualStuckSlots;
module.exports.cycleProfit = cycleProfit;
module.exports.freshPrice = freshPrice;
module.exports.orderResultPatch = orderResultPatch;
module.exports.applyOrderResult = applyOrderResult;
module.exports.cancelFollowUp = cancelFollowUp;
module.exports.probeCall = probeCall;
module.exports.strategyConflict = strategyConflict;
