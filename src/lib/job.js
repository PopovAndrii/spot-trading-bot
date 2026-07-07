const Decimal = require('decimal.js');
const { rebalanceClose } = require('./rebalanceClose');
const { microClosePrice, gridExitThreshold } = require('./calculator');

const Status = Object.freeze({
  READY: 0, // 0 - can deletad. never started
  STARTED: 1, // 1 - in process. some order done
  STOPPED: 2, // 2 -
  DONE: 3, // 3 - not done(error etc)
});

const state = Object.freeze({
  NEW: 'NEW', // Order created but not yet executed
  CANCELED: 'CANCELED', // Order was canceled by the user before execution
  PARTIALLY_FILLED: 'PARTIALLY_FILLED', // Order partially executed, not yet fully complete
  FILLED: 'FILLED', // Order fully executed
  PENDING_CANCEL: 'PENDING_CANCEL', // Cancellation in progress (rarely used)
  REJECTED: 'REJECTED', // Order rejected by the Binance system (e.g. due to errors)
  EXPIRED: 'EXPIRED', // Order expired by time (e.g. a LIMIT GTC may be canceled on timeout or network failures)
});

// Deepest index of an order with status FILLED (or -1). For long this is buy,
// for short it is sell: the index up to which a position is actually held. Needed
// so we do not declare the cycle complete while filled entry orders remain below
// an executed close (orphan inventory after a "blind" window).
function deepestFilledIndex(arr) {
  if (!Array.isArray(arr)) return -1;
  for (let j = arr.length - 1; j >= 0; j--) {
    if (arr[j] && arr[j].status === state.FILLED) return j;
  }
  return -1;
}

// Quantity/price of the closing order, accounting for what was actually
// sold/bought back across partially filled and canceled closes during the cycle.
// Returns { quantity, price } (strings, rounded by step/tick) or null — in which
// case the caller uses the precomputed values from config.
function rebalancedClose(obj, i, strategy) {
  const entrySide = strategy === 'long' ? 'BUY' : 'SELL'; // what we built the position with
  const closeSide = strategy === 'long' ? 'SELL' : 'BUY'; // what we close with

  // Position entry: actually filled orders 0..i.
  const entries = [];
  for (let k = 0; k <= i; k++) {
    const e = obj[entrySide][k];
    if (!e || e.status !== state.FILLED) continue;
    if (e.executedQty === undefined || e.cummulativeQuoteQty === undefined) {
      return null; // incomplete data (old config) → fall back to precompute
    }
    entries.push(e);
  }

  // Closes that actually closed something (partial/canceled-with-fill).
  const closes = (obj[closeSide] || []).filter((c) => (Number(c.executedQty) || 0) > 0);
  if (closes.length === 0) return null; // no partials → precompute

  const profit = parseFloat(obj['param']['field-profit']) || 0;
  const commission = parseFloat(obj['param']['field-commission']) || 0;

  const res = rebalanceClose(entries, closes, strategy, profit + commission);
  if (!res) return null; // position already fully closed

  const stepSize = parseInt(obj['param']['field-stepSize'], 10) || 0;
  const tickSize = parseInt(obj['param']['field-tickSize'], 10) || 0;

  return {
    // floor the quantity — so we don't try to close more than we actually hold
    quantity: new Decimal(res.quantity)
      .toDecimalPlaces(stepSize, Decimal.ROUND_DOWN)
      .toFixed(stepSize),
    price: new Decimal(res.price).toFixed(tickSize),
  };
}

// Hybrid v2 frontier F: the deepest currently-HELD grid rung — the deepest FILLED
// entry at index ≥ gridStart. -1 when no grid rung is held (the deepest fill, if
// any, is still in the DCA base) — the caller then degrades to classic DCA. When
// the frontier's micro-close fires the rung is re-armed (entry back to null), so
// the next call naturally walks the frontier UP to the shallower held rung. Pure.
function frontierIndex(entries, gridStart) {
  const d = deepestFilledIndex(entries);
  return d >= gridStart ? d : -1;
}

// Averaged close price of the position built by the FILLED entries 0..upTo — S_j
// from the v2 spec (j = upTo+1 in 1-based order numbers), computed from the REAL
// fills (executedQty/cummulativeQuoteQty), not the planned config prices: micro
// recycling re-arms rungs, so the plan drifts from what is actually held.
// feesPct = profit + commission (round-trip). Partial closes are intentionally NOT
// subtracted: S feeds only the exit threshold (a switching boundary between two
// rungs); the exit order itself is priced closes-aware by rebalancedClose. Returns
// a number, or null when nothing (with fill data) is filled in 0..upTo — e.g.
// S_{F-1} at the very first grid rung; the caller decides the fallback. Pure.
function averagedClosePrice(obj, upTo, strategy, feesPct) {
  const entrySide = strategy === 'long' ? 'BUY' : 'SELL';
  const entries = [];
  for (let k = 0; k <= upTo; k++) {
    const e = obj?.[entrySide]?.[k];
    if (!e || e.status !== state.FILLED) continue;
    if (e.executedQty === undefined || e.cummulativeQuoteQty === undefined) continue;
    entries.push(e);
  }
  if (entries.length === 0) return null;
  const res = rebalanceClose(entries, [], strategy, feesPct);
  return res ? res.price : null;
}

// Realized quote profit of one completed grid oscillation: quote received on the
// SELL minus quote spent on the BUY. Works for both long and short (entry/close
// sides differ, but sellQuote − buyQuote is the leg profit either way). Pure.
function gridLegProfit(buySlot, sellSlot) {
  const q = (o) => Number(o?.cummulativeQuoteQty) || 0;
  return q(sellSlot) - q(buySlot);
}

// Re-arm a grid leg in place: reset both paired slots (BUY[i]/SELL[i]) to
// "not placed", keeping quantity/price/side so the next pass re-buys/re-sells at
// the SAME level. The realized profit must be banked (gridLegProfit) BEFORE this,
// since it drops the fill fields (and the v2 dual-role marker). Mutates and
// returns obj. Pure/testable.
function rearmGridLeg(obj, i) {
  for (const side of ['BUY', 'SELL']) {
    const s = obj?.[side]?.[i];
    if (!s) continue;
    s.status = null;
    s.orderId = null;
    delete s.executedQty;
    delete s.cummulativeQuoteQty;
    delete s.manual;
    delete s.role;
  }
  return obj;
}

// One banked grid oscillation, all bookkeeping in one place: fold the leg's
// realized quote profit into the running quote total, then bump the per-rung
// micro-fire counter and re-arm the leg. The counter (`hybrid`) lives on the
// CLOSE order of the rung — the order that actually fires the micro (long: SELL,
// short: BUY) — so the orders table shows ×N right on that row. rearmGridLeg
// keeps it (it only wipes the fill/status fields), so the count accumulates
// across re-arms. Must run while the fills are still on the slots. Returns the
// banked amount. Mutates obj. Pure/testable.
function bankGridLeg(obj, i, strategy) {
  const banked = gridLegProfit(obj['BUY'][i], obj['SELL'][i]);
  obj.gridRealized = (Number(obj.gridRealized) || 0) + banked;
  const closeSide = strategy === 'short' ? 'BUY' : 'SELL';
  const close = obj[closeSide]?.[i];
  if (close) close.hybrid = (Number(close.hybrid) || 0) + 1;
  rearmGridLeg(obj, i);
  return banked;
}

class Job {
  constructor(test = false) {
    this.test = test;
    // Exchange limits for reconciling the orphan leftover. Passed in from
    // jsonTimerSender at cycle start (exchangeInfo). 0 = unknown (test or a
    // failed request) → #belowMin never triggers, behavior stays as before.
    this.minQty = 0;
    this.minNotional = 0;
    // Live market price for the hybrid grid/exit decision, refreshed each tick by
    // the engine (ticker stream, bookTicker fallback). null = unknown → the
    // frontier conservatively stays in grid mode (micro keeps resting).
    this.price = null;
  }

  // Is the leftover below exchange limits (LOT_SIZE.minQty / NOTIONAL.minNotional)?
  // If the limits are unknown (0) — treat it as passing (don't block the close).
  #belowMin(qty, price) {
    const q = parseFloat(qty) || 0;
    const p = parseFloat(price) || 0;
    if (this.minQty && q < this.minQty) return true;
    if (this.minNotional && q * p < this.minNotional) return true;
    return false;
  }

  long = (obj, i, el) => {
    if (this.test === true) return { status: 'pass', method: false, side: null, id: i, data: {} };

    // The whole-position close hangs on ONE sell at the topmost filled buy index;
    // lower sells are canceled (CANCELED) or were never placed (null) as stale —
    // pass is correct for them WHILE the close is delegated upward, i.e. buy[i+1]
    // is also FILLED. null here is an orphan after a "blind" window: several buys
    // filled at once and a lower-index sell executed before the close could crawl
    // down; the lower closes were never placed. Without higherFilled (the upper
    // sell is CANCELED and buy[i+1] did not fill) the position would be left with
    // no close — then we re-place.
    const higherFilled = obj['BUY'][i + 1]?.status === state.FILLED;
    if (
      el.status === state.FILLED &&
      (obj['SELL'][i].status === state.CANCELED || obj['SELL'][i].status === null) &&
      higherFilled
    ) {
      return { status: 'pass', method: false, side: null, id: i, data: {} };
    }

    if (el.status === state.FILLED && obj['SELL'][i].status === state.PARTIALLY_FILLED) {
      return {
        status: state.PARTIALLY_FILLED,
        method: 'getOrder',
        side: 'SELL',
        id: i,
        data: {
          id: i,
          symbol: el.symbol,
          orderId: obj['SELL'][i].orderId,
        },
      };
    }

    if (obj['SELL'][i].status !== state.FILLED) {
      switch (el.status) {
        case state.FILLED:
          // Cancel ANY live lower close, not just i-1. During a burst fill the
          // intermediate indices pass as "delegated upward" (guard above), and the
          // active close may remain at an index < i-1. It reserves the base balance
          // → a new close hits -2010 insufficient balance. Cancel one per pass while
          // live ones remain.
          for (let j = i - 1; j >= 0; j--) {
            const prev = obj['SELL'][j];
            if (
              prev &&
              prev.orderId != null &&
              (prev.status === state.NEW || prev.status === state.PARTIALLY_FILLED)
            ) {
              return {
                status: null,
                method: 'cancelOrder',
                side: 'SELL',
                id: j,
                data: {
                  id: j,
                  symbol: el.symbol,
                  orderId: prev.orderId,
                },
              };
            }
          }

          if (obj['SELL'][i].status === null || obj['SELL'][i].status === state.CANCELED) {
            // Manual pull: user cancelled this close — do NOT re-place
            // it; the position stays open until they re-place (their choice).
            if (obj['SELL'][i].manual) {
              return { status: 'pass', method: false, side: null, id: i, data: {} };
            }
            const reb = rebalancedClose(obj, i, 'long'); // null → precompute
            const quantity = reb ? reb.quantity : obj['SELL'][i].quantity;
            const price = reb ? reb.price : obj['SELL'][i].price;

            // Orphan inventory: part of the position was already sold by a filled
            // lower sell, and the leftover is below the exchange minimum — the close
            // can't be placed. End the cycle and mark leftover: the iterator notifies
            // that dust is left on the balance (the user decides what to do).
            if (this.#belowMin(quantity, price)) {
              return {
                status: Status.DONE,
                method: 'cancelOpenOrders',
                side: null,
                id: i,
                leftover: { quantity, price, symbol: el.symbol },
                data: { id: i, symbol: el.symbol },
              };
            }

            return {
              status: null,
              method: 'newOrder',
              side: 'SELL',
              id: i,
              data: {
                id: i,
                symbol: el.symbol,
                side: 'SELL',
                type: 'LIMIT',
                timeInForce: 'GTC',
                quantity,
                price,
              },
            };
          } else if (
            obj['SELL'][i].status === state.NEW ||
            obj['SELL'][i].status === state.PARTIALLY_FILLED
          ) {
            return {
              status: obj['SELL'][i].status,
              method: 'getOrder',
              side: 'SELL',
              id: i,
              data: {
                id: i,
                symbol: el.symbol,
                orderId: obj['SELL'][i].orderId,
              },
            };
          }

          return { status: 'pass', method: false, side: null, id: i, data: {} };

        case state.NEW:
          return {
            status: state.NEW,
            method: 'getOrder',
            side: 'BUY',
            id: i,
            data: {
              id: i,
              symbol: el.symbol,
              orderId: el.orderId,
            },
          };

        case state.PARTIALLY_FILLED:
          return {
            status: state.PARTIALLY_FILLED,
            method: 'getOrder',
            side: 'BUY',
            id: i,
            data: {
              id: i,
              symbol: el.symbol,
              orderId: el.orderId,
            },
          };

        default:
          // Manual pull: user cancelled this entry — leave it alone,
          // do not re-place. Without the flag a null/CANCELED entry is re-placed.
          if (el.manual) {
            return { status: 'pass', method: false, side: null, id: i, data: {} };
          }
          return {
            status: null,
            method: 'newOrder',
            side: 'BUY',
            id: i,
            data: {
              id: i,
              symbol: el.symbol,
              side: 'BUY',
              type: 'LIMIT',
              timeInForce: 'GTC',
              quantity: el.quantity,
              price: el.price,
            },
          };
      }
    } else {
      if (obj['SELL'][i].status === state.NEW) {
        return {
          status: state.NEW,
          method: 'getOrder',
          side: 'SELL',
          id: i,
          data: {
            id: i,
            symbol: el.symbol,
            orderId: obj['SELL'][i].orderId,
          },
        };
      }

      if (obj['SELL'][i].status === state.FILLED) {
        // The close at index i executed. DONE is valid ONLY if i is the deepest
        // filled buy. If there are filled buys below (k>i) — an orphan after a
        // "blind" window (the sell slipped through between the drop and the bounce):
        // the position is only partially closed. Don't end the cycle — pass yields
        // to the lower indices, which deliver a close for the leftover (guard above
        // + case FILLED with rebalancedClose).
        if (deepestFilledIndex(obj['BUY']) > i) {
          return { status: 'pass', method: false, side: null, id: i, data: {} };
        }

        return {
          status: Status.DONE,
          method: 'cancelOpenOrders',
          side: null,
          id: i,
          data: {
            id: i,
            symbol: el.symbol,
          },
        };
      }
    }
  };

  short = (obj, i, el) => {
    if (this.test === true) return { status: 'pass', method: false, side: null, id: i, data: {} };

    // Mirror of long: the short close hangs on ONE buy at the topmost filled
    // sell index. pass on a lower buy (CANCELED, or a not-yet-placed null — an
    // orphan after a blind window) is allowed only when the close is delegated
    // upward (sell[i+1] is also FILLED); otherwise we re-place.
    const higherFilled = obj['SELL'][i + 1]?.status === state.FILLED;
    if (
      el.status === state.FILLED &&
      (obj['BUY'][i].status === state.CANCELED || obj['BUY'][i].status === null) &&
      higherFilled
    ) {
      return { status: 'pass', method: false, side: null, id: i, data: {} };
    }

    if (el.status === state.FILLED && obj['BUY'][i].status === state.PARTIALLY_FILLED) {
      return {
        status: state.PARTIALLY_FILLED,
        method: 'getOrder',
        side: 'BUY',
        id: i,
        data: {
          id: i,
          symbol: el.symbol,
          orderId: obj['BUY'][i].orderId,
        },
      };
    }

    if (obj['BUY'][i].status !== state.FILLED) {
      switch (el.status) {
        case state.FILLED:
          // Mirror of long: cancel ANY live lower close (buy), not just i-1 —
          // during a burst fill the active close may get stuck lower and reserve
          // the quote balance → -2010 on the new close.
          for (let j = i - 1; j >= 0; j--) {
            const prev = obj['BUY'][j];
            if (
              prev &&
              prev.orderId != null &&
              (prev.status === state.NEW || prev.status === state.PARTIALLY_FILLED)
            ) {
              return {
                status: null,
                method: 'cancelOrder',
                side: 'BUY',
                id: j,
                data: {
                  symbol: el.symbol,
                  orderId: prev.orderId,
                },
              };
            }
          }

          if (obj['BUY'][i].status === null || obj['BUY'][i].status === state.CANCELED) {
            // Manual pull: user cancelled this close — do NOT re-place
            // it; the position stays open until they re-place (their choice).
            if (obj['BUY'][i].manual) {
              return { status: 'pass', method: false, side: null, id: i, data: {} };
            }
            const reb = rebalancedClose(obj, i, 'short'); // null → precompute
            const quantity = reb ? reb.quantity : obj['BUY'][i].quantity;
            const price = reb ? reb.price : obj['BUY'][i].price;

            // Orphan inventory: part of the position was already bought back by a
            // filled lower buy, and the leftover is below the exchange minimum — the
            // close can't be placed. End the cycle and mark leftover for notification.
            if (this.#belowMin(quantity, price)) {
              return {
                status: Status.DONE,
                method: 'cancelOpenOrders',
                side: null,
                id: i,
                leftover: { quantity, price, symbol: el.symbol },
                data: { id: i, symbol: el.symbol },
              };
            }

            return {
              status: null,
              method: 'newOrder',
              side: 'BUY',
              id: i,
              data: {
                id: i,
                symbol: el.symbol,
                side: 'BUY',
                type: 'LIMIT',
                timeInForce: 'GTC',
                quantity,
                price,
              },
            };
          } else if (
            obj['BUY'][i].status === state.NEW ||
            obj['BUY'][i].status === state.PARTIALLY_FILLED
          ) {
            return {
              status: obj['BUY'][i].status,
              method: 'getOrder',
              side: 'BUY',
              id: i,
              data: {
                id: i,
                symbol: el.symbol,
                orderId: obj['BUY'][i].orderId,
              },
            };
          }

          return { status: 'pass', method: false, side: null, id: i, data: {} };

        case state.NEW:
          return {
            status: state.NEW,
            method: 'getOrder',
            side: 'SELL',
            id: i,
            data: {
              id: i,
              symbol: el.symbol,
              orderId: el.orderId,
            },
          };

        case state.PARTIALLY_FILLED:
          return {
            status: state.PARTIALLY_FILLED,
            method: 'getOrder',
            side: 'SELL',
            id: i,
            data: {
              id: i,
              symbol: el.symbol,
              orderId: el.orderId,
            },
          };

        default:
          // Manual pull: user cancelled this entry — leave it alone,
          // do not re-place. Without the flag a null/CANCELED entry is re-placed.
          if (el.manual) {
            return { status: 'pass', method: false, side: null, id: i, data: {} };
          }
          return {
            status: null,
            method: 'newOrder',
            side: 'SELL',
            id: i,
            data: {
              id: i,
              symbol: el.symbol,
              side: 'SELL',
              type: 'LIMIT',
              timeInForce: 'GTC',
              quantity: el.quantity,
              price: el.price,
            },
          };
      }
    } else {
      if (obj['BUY'][i].status === state.NEW) {
        return {
          status: state.NEW,
          method: 'getOrder',
          side: 'BUY',
          id: i,
          data: {
            id: i,
            symbol: el.symbol,
            orderId: obj['BUY'][i].orderId,
          },
        };
      }

      if (obj['BUY'][i].status === state.FILLED) {
        // Mirror of long: DONE is valid only if i is the deepest filled sell. A
        // filled sell remains below (k>i) → orphan, don't end the cycle.
        if (deepestFilledIndex(obj['SELL']) > i) {
          return { status: 'pass', method: false, side: null, id: i, data: {} };
        }

        return {
          status: Status.DONE,
          method: 'cancelOpenOrders',
          side: null,
          id: i,
          data: {
            symbol: el.symbol,
          },
        };
      }
    }
  };

  // ── Hybrid DCA/GRID (v2 frontier machine) ──────────────────────────────────
  //
  // Rungs 0..g-1 (g = field-gridLevel − 1, 1-based in the UI) are the DCA base;
  // rungs g..deep are grid-capable. While NO grid rung is held, the base runs the
  // UNCHANGED long()/short() over a base-only VIEW (a shallow slice shares element
  // references, so the proven DCA machine reads only base rungs while the iterator
  // still writes results by absolute id), and grid rungs simply keep their safety
  // entries resting.
  //
  // Once a grid rung is held, the FRONTIER F (deepest held rung) owns the ONLY
  // resting close — its micro take-profit. A micro fill banks one oscillation
  // (REARM → iterator bookkeeping) and re-arms the rung, so the frontier walks UP
  // as price rises. Any other live close is stale and gets canceled — including
  // the base averaged close raced by the first grid fill: in grid mode nothing
  // but the micro may reserve inventory. The whole-position exit above
  // T_F = interpolate(S_{F-1}, S_F, field-gridExit) is the next step; until it
  // lands, the frontier micro-recycles all the way up and the cycle finishes
  // through the classic DCA close once no grid rung is held.

  // 0-based index of the first GRID rung. Invalid/missing level → Infinity, i.e.
  // every rung stays DCA and hybrid degrades to the classic behavior.
  #gridStartIndex(obj) {
    const n = parseInt(obj?.param?.['field-gridLevel'], 10);
    if (!Number.isInteger(n) || n < 1) return Infinity;
    return n - 1;
  }

  hybridLong = (obj, i, el) => {
    if (this.test === true) return { status: 'pass', method: false, side: null, id: i, data: {} };

    const g = this.#gridStartIndex(obj);
    const F = frontierIndex(obj['BUY'], g); // -1 when no grid rung is held

    if (F >= 0) return this.#frontierGrid(obj, i, el, g, F, 'BUY', 'SELL');

    if (i >= g) return this.#armEntry(i, el, 'BUY'); // grid rung, not held yet

    // DCA base over a base-only view (indices < g)
    const view = { ...obj, BUY: obj['BUY'].slice(0, g), SELL: obj['SELL'].slice(0, g) };
    return this.long(view, i, el);
  };

  hybridShort = (obj, i, el) => {
    if (this.test === true) return { status: 'pass', method: false, side: null, id: i, data: {} };

    const g = this.#gridStartIndex(obj);
    const F = frontierIndex(obj['SELL'], g); // mirror: entries are SELLs

    if (F >= 0) return this.#frontierGrid(obj, i, el, g, F, 'SELL', 'BUY');

    if (i >= g) return this.#armEntry(i, el, 'SELL');

    const view = { ...obj, BUY: obj['BUY'].slice(0, g), SELL: obj['SELL'].slice(0, g) };
    return this.short(view, i, el);
  };

  // Should the frontier switch from micro-recycling to the whole-position exit?
  // T_F interpolates between S_{F-1} and S_F (field-gridExit, default 50 = the
  // spec midpoint); long exits when P ≥ T_F, short when P ≤ T_F. Unknown price or
  // missing fill data (S_F null) → false: stay in grid mode, never guess an exit.
  // S_{F-1} null (the frontier is the first held rung, nothing filled above) →
  // T = S_F: exit exactly at the averaged close, pct has nothing to interpolate.
  #exitMode(obj, F, strategy) {
    const P = parseFloat(this.price);
    if (!Number.isFinite(P) || P <= 0) return false;
    const p = obj.param || {};
    const fees =
      (parseFloat(p['field-profit']) || 0) + (parseFloat(p['field-commission']) || 0);
    const sF = averagedClosePrice(obj, F, strategy, fees);
    if (sF == null) return false;
    const sPrev = averagedClosePrice(obj, F - 1, strategy, fees);
    const T = sPrev == null ? sF : gridExitThreshold(sPrev, sF, p['field-gridExit']);
    return strategy === 'long' ? P >= T : P <= T;
  }

  // The whole-position exit close for the frontier: everything actually held
  // across filled entries 0..F minus everything already sold/bought back by
  // partial or raced closes — the lib rebalanceClose over the REAL fills. Unlike
  // the module-level rebalancedClose it does NOT bail out when there are no
  // partial closes (the exit is always recomputed from fills). Returns rounded
  // { quantity, price } or null when fill data is missing (old config) — the
  // caller then falls back to the slot's precomputed plan, like the DCA path.
  #exitClose(obj, F, strategy) {
    const entrySide = strategy === 'long' ? 'BUY' : 'SELL';
    const closeSide = strategy === 'long' ? 'SELL' : 'BUY';

    const entries = [];
    for (let k = 0; k <= F; k++) {
      const e = obj[entrySide][k];
      if (!e || e.status !== state.FILLED) continue;
      if (e.executedQty === undefined || e.cummulativeQuoteQty === undefined) return null;
      entries.push(e);
    }
    if (entries.length === 0) return null;

    const closes = (obj[closeSide] || []).filter((c) => (Number(c?.executedQty) || 0) > 0);

    const p = obj.param || {};
    const fees =
      (parseFloat(p['field-profit']) || 0) + (parseFloat(p['field-commission']) || 0);

    const res = rebalanceClose(entries, closes, strategy, fees);
    if (!res) return null; // position already fully closed

    const stepSize = parseInt(p['field-stepSize'], 10) || 0;
    const tickSize = parseInt(p['field-tickSize'], 10) || 0;

    return {
      quantity: new Decimal(res.quantity)
        .toDecimalPlaces(stepSize, Decimal.ROUND_DOWN)
        .toFixed(stepSize),
      price: new Decimal(res.price).toFixed(tickSize),
    };
  }

  // Grid close order (price + quantity) computed at placement time, like DCA's
  // rebalancedClose. Price = the rung's own entry LEVEL marked by microProfit +
  // commission (matches the displayed micro column). Quantity = what the entry
  // actually filled MINUS what a canceled partial predecessor on the same slot
  // already sold/bought back (frontier moves and rollbacks cancel live closes —
  // without the subtraction the re-placed micro oversells the rung), floored to
  // stepSize. Zero left → the oscillation is de-facto complete (caller banks it).
  #gridClose(obj, entry, close, closeSide) {
    const p = obj.param || {};
    const microProfit = p['field-microProfit'] ?? 0.1;
    const commission = p['field-commission'] ?? 0;
    const tick = parseInt(p['field-tickSize'], 10) || 0;
    const step = parseInt(p['field-stepSize'], 10) || 0;
    const strategy = closeSide === 'SELL' ? 'long' : 'short';

    const price = microClosePrice(entry.price, microProfit, commission, tick, strategy);
    const execQty = new Decimal(entry.executedQty || entry.quantity || 0);
    const already = new Decimal(Number(close?.executedQty) || 0);
    const quantity = Decimal.max(execQty.minus(already), 0)
      .toDecimalPlaces(step, Decimal.ROUND_DOWN)
      .toFixed(step);
    return { quantity, price };
  }

  // Ladder entry management shared by the not-held and frontier paths: keep the
  // rung's safety entry resting. Not placed → newOrder; NEW/PARTIAL → poll;
  // manually pulled → pass (like the DCA path). FILLED never reaches here.
  #armEntry(i, el, entrySide) {
    const symbol = el.symbol;
    if (el.status === state.NEW || el.status === state.PARTIALLY_FILLED) {
      return {
        status: el.status,
        method: 'getOrder',
        side: entrySide,
        id: i,
        data: { id: i, symbol, orderId: el.orderId },
      };
    }
    if (el.manual) {
      return { status: 'pass', method: false, side: null, id: i, data: {} };
    }
    return {
      status: null,
      method: 'newOrder',
      side: entrySide,
      id: i,
      data: {
        id: i,
        symbol,
        side: entrySide,
        type: 'LIMIT',
        timeInForce: 'GTC',
        quantity: el.quantity,
        price: el.price,
      },
    };
  }

  // Grid mode — a grid rung is held, F = frontier (deepest held rung, F ≥ g).
  // Handles EVERY index while active. Per index:
  //   exit close FILLED              → DONE              [whole position closed;
  //     pass instead if a deeper safety entry raced it — the new frontier
  //     reconciles the sold inventory via the closes-aware #exitClose]
  //   grid rung, entry+micro FILLED  → REARM             [oscillation banked]
  //   base rung, entry+close FILLED  → pass              [base close raced the
  //     cancel during the frontier transition; its fills stay on the slot and the
  //     closes-aware exit reconciles the inventory later]
  //   live close at i ≠ F            → cancelOrder       [stale: an old frontier's
  //     micro or the base averaged close — only the frontier's close may rest]
  //   i == F                         → grid mode (P < T_F): micro take-profit;
  //                                    exit mode (P ≥ T_F): ONE whole-position
  //                                    close. A live close of the WRONG role is
  //                                    canceled first (rollback / micro yields).
  //   entry FILLED elsewhere         → pass              [held rung]
  //   entry not FILLED               → #armEntry         [keep the ladder resting]
  #frontierGrid(obj, i, el, g, F, entrySide, closeSide) {
    const close = obj[closeSide][i] || {};
    const symbol = el.symbol;
    const strategy = closeSide === 'SELL' ? 'long' : 'short';

    if (el.status === state.FILLED && close.status === state.FILLED) {
      if (close.role === 'exit') {
        // A safety entry may fill between the exit placement and its fill (blind
        // window) — then the close did NOT cover the new deepest rung: keep the
        // cycle open, the fills on this slot feed the next exit computation.
        if (deepestFilledIndex(obj[entrySide]) > i) {
          return { status: 'pass', method: false, side: null, id: i, data: {} };
        }
        return {
          status: Status.DONE,
          method: 'cancelOpenOrders',
          side: null,
          id: i,
          data: { id: i, symbol },
        };
      }
      if (i >= g) {
        return { status: 'REARM', method: false, side: null, id: i, data: { id: i, symbol } };
      }
      return { status: 'pass', method: false, side: null, id: i, data: {} };
    }

    if (
      i !== F &&
      close.orderId != null &&
      (close.status === state.NEW || close.status === state.PARTIALLY_FILLED)
    ) {
      return {
        status: null,
        method: 'cancelOrder',
        side: closeSide,
        id: i,
        data: { id: i, symbol, orderId: close.orderId },
      };
    }

    if (i === F) {
      const exitMode = this.#exitMode(obj, F, strategy);

      if (close.status === state.NEW || close.status === state.PARTIALLY_FILLED) {
        // wrong role for the current mode → cancel: an exit close while the price
        // fell back under T_F (rollback), or a micro while the price crossed it
        // (yield to the whole-position close). Re-placed on the next pass.
        if ((close.role === 'exit') !== exitMode) {
          return {
            status: null,
            method: 'cancelOrder',
            side: closeSide,
            id: i,
            data: { id: i, symbol, orderId: close.orderId },
          };
        }
        return {
          status: close.status,
          method: 'getOrder',
          side: closeSide,
          id: i,
          data: { id: i, symbol, orderId: close.orderId },
        };
      }
      if (close.manual) {
        return { status: 'pass', method: false, side: null, id: i, data: {} };
      }

      if (exitMode) {
        // ONE averaged close over the WHOLE held position (null → slot plan)
        const reb = this.#exitClose(obj, F, strategy);
        const quantity = reb ? reb.quantity : close.quantity;
        const price = reb ? reb.price : close.price;

        if (this.#belowMin(quantity, price)) {
          return {
            status: Status.DONE,
            method: 'cancelOpenOrders',
            side: null,
            id: i,
            leftover: { quantity, price, symbol },
            data: { id: i, symbol },
          };
        }

        return {
          status: null,
          method: 'newOrder',
          side: closeSide,
          id: i,
          role: 'exit',
          data: {
            id: i,
            symbol,
            side: closeSide,
            type: 'LIMIT',
            timeInForce: 'GTC',
            quantity,
            price,
          },
        };
      }

      // micro take-profit price/qty from the real entry fill (not the stale slot)
      const { quantity, price } = this.#gridClose(obj, el, close, closeSide);
      if (parseFloat(quantity) <= 0) {
        // the canceled predecessor already closed the whole rung — the oscillation
        // is complete even though the close never reached FILLED: bank it
        return { status: 'REARM', method: false, side: null, id: i, data: { id: i, symbol } };
      }
      return {
        status: null,
        method: 'newOrder',
        side: closeSide,
        id: i,
        role: 'micro',
        data: {
          id: i,
          symbol,
          side: closeSide,
          type: 'LIMIT',
          timeInForce: 'GTC',
          quantity,
          price,
        },
      };
    }

    if (el.status === state.FILLED) {
      return { status: 'pass', method: false, side: null, id: i, data: {} }; // held rung
    }

    return this.#armEntry(i, el, entrySide);
  }
}

module.exports = {
  Job,
  Status,
  rebalancedClose,
  deepestFilledIndex,
  frontierIndex,
  averagedClosePrice,
  gridLegProfit,
  rearmGridLeg,
  bankGridLeg,
};
