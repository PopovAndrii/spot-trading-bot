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

// Real average fill price of an entry slot (cummulativeQuoteQty / executedQty),
// falling back to the slot's resting price when fill data is missing (old config).
// null when neither is known. Pure.
function entryFillPrice(slot) {
  const qty = Number(slot?.executedQty) || 0;
  const quote = Number(slot?.cummulativeQuoteQty) || 0;
  if (qty > 0 && quote > 0) return quote / qty;
  const p = parseFloat(slot?.price);
  return Number.isFinite(p) && p > 0 ? p : null;
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
// Does the scalp still own something the classic machine cannot read? A live micro
// close (NEW/PARTIALLY_FILLED), a filled one waiting to be banked (REARM), or a
// canceled one whose marker still stands on the slot. The classic machine knows
// nothing about the role — it would poll a resting micro as if it were the
// whole-position close and call the cycle DONE on a rung-sized fill. So while a
// cycle is dirty the hybrid keeps the wheel EVEN WITH THE SWITCH OFF: its own
// out-of-zone branch cancels the micro and hands the position back, re-priced off
// the real fills. The marker is dropped as the classic close is placed
// (applyOrderResult), so the cycle drains to clean within a tick or two. Pure.
function hybridDirty(obj, strategy) {
  const closeSide = strategy === 'short' ? 'BUY' : 'SELL';
  const closes = obj?.[closeSide];
  if (!Array.isArray(closes)) return false;
  return closes.some((c) => c?.role === 'micro');
}

// The live hybrid switch, as a pure param patch. ON aims the scalp at the rung the
// price is stuck on — the deepest held entry — by writing field-gridArm, the live
// floor the UI then shows in "Grid from order". You can retype it right after: a
// hand edit lands on the same key and wins outright, which is how you say "not
// here, wait for rung 5". Only this AUTOMATIC aim is held to the configured
// field-gridLevel — the robot never arms shallower than you asked for, though you
// may. With nothing held there is nothing to aim at and the config stands alone.
// OFF drops the switch and the live floor together, so the next ON re-aims fresh.
// field-gridLevel itself is never touched: it is the saved config and it must
// outlive the cycle. Returns a NEW param object. Pure/testable.
function hybridSwitch(param, entries, on) {
  const next = { ...param };

  if (!on) {
    next['field-hybrid'] = 'off';
    delete next['field-gridArm'];
    return next;
  }

  next['field-hybrid'] = 'on';

  const D = deepestFilledIndex(entries);
  if (D < 0) {
    delete next['field-gridArm'];
    return next;
  }

  const cfg = parseInt(next['field-gridLevel'], 10);
  const floor = Number.isInteger(cfg) && cfg >= 1 ? cfg : 1;
  next['field-gridArm'] = String(Math.max(D + 1, floor));
  return next;
}

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
    // Live market price for the hybrid scalp decision, refreshed each tick by
    // the engine (ticker stream, bookTicker fallback). null = unknown → the
    // scalp stays off and the machine behaves exactly like classic DCA.
    this.price = null;
    // Live hybrid switch, driven per tick from param['field-hybrid']. false = no
    // NEW scalp is armed, but the machine still runs its own cleanup: a resting
    // micro is canceled and the whole-position close returns. Default true so a
    // direct hybridLong/hybridShort call scalps.
    this.hybridEnabled = true;
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

  // ── Hybrid DCA/GRID (v3: classic DCA + a bounded pause-scalp) ───────────────
  //
  // The classic DCA machine (long()/short()) runs UNCHANGED over the whole
  // ladder: entries keep resting and follow the price down, the ONE
  // whole-position averaged close keeps descending with martingale, and all
  // DONE/orphan/partial handling stays classic. The position is NEVER peeled
  // apart and the base is never stranded.
  //
  // The hybrid only adds a scalp DURING THE PAUSE — the dead gap between the
  // deepest fill and the whole-position close, where plain DCA just waits.
  // split = interpolate(deepest entry fill, whole-position close price,
  // field-gridExit) (default 50 = midpoint), compared against the LIVE price:
  //   long: P < split → the resting close is swapped for a micro take-profit of
  //   ONLY the deepest rung's own volume (short mirrored: P > split, micro is a
  //   buy-back). Micro fill → REARM: bank the oscillation, re-arm the rung so
  //   its entry re-buys the same dip. Can repeat for weeks.
  //   P across the split → the micro yields (cancel) and the classic
  //   closes-aware full close returns.
  // The micro close itself must never cross the split line; if it would, the
  // scalp is skipped entirely. Unknown price / missing data → classic DCA.

  // 0-based index of the first GRID (scalp-capable) rung. One number decides it,
  // and the UI shows exactly that number:
  //   field-gridArm   — the LIVE floor, when a cycle carries one. Written by the
  //     switch (snapshot of the rung the price is stuck on) and re-writable by hand
  //     while the robot runs. It wins outright: what the field says is what the
  //     engine does.
  //   field-gridLevel — the saved config, used when no live floor is set. Survives
  //     the toggle untouched, so the next cycle starts from the user's own value.
  // Invalid/missing → Infinity, i.e. every rung stays DCA and hybrid degrades to
  // classic.
  #gridStartIndex(obj) {
    const arm = parseInt(obj?.param?.['field-gridArm'], 10);
    if (Number.isInteger(arm) && arm >= 1) return arm - 1;
    const n = parseInt(obj?.param?.['field-gridLevel'], 10);
    if (!Number.isInteger(n) || n < 1) return Infinity;
    return n - 1;
  }

  hybridLong = (obj, i, el) => this.#pauseScalp(obj, i, el, 'long', 'BUY', 'SELL', this.long);

  hybridShort = (obj, i, el) => this.#pauseScalp(obj, i, el, 'short', 'SELL', 'BUY', this.short);

  // The whole-position close over the REAL fills: everything held across filled
  // entries 0..D minus everything already sold/bought back by partial or micro
  // closes. Unlike the module-level rebalancedClose it does NOT bail out when
  // there are no partial closes — in hybrid the slot plan cannot be trusted (a
  // placed micro clobbers the slot's price/qty), so the full close is always
  // recomputed. Returns rounded { quantity, price } or null when fill data is
  // missing (old config) — the caller then keeps the classic fallback.
  #fullClose(obj, D, strategy) {
    const entrySide = strategy === 'long' ? 'BUY' : 'SELL';
    const closeSide = strategy === 'long' ? 'SELL' : 'BUY';

    const entries = [];
    for (let k = 0; k <= D; k++) {
      const e = obj[entrySide][k];
      if (!e || e.status !== state.FILLED) continue;
      if (e.executedQty === undefined || e.cummulativeQuoteQty === undefined) return null;
      entries.push(e);
    }
    if (entries.length === 0) return null;

    const closes = (obj[closeSide] || []).filter((c) => (Number(c?.executedQty) || 0) > 0);

    const p = obj.param || {};
    const fees = (parseFloat(p['field-profit']) || 0) + (parseFloat(p['field-commission']) || 0);

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

  // The split line inside the pause gap: interpolate between the deepest rung's
  // REAL entry fill price and the whole-position close price recomputed from the
  // fills (#fullClose; slot-plan fallback only for old configs without fill
  // data). null when either endpoint is unknown → the caller stays classic.
  #splitPrice(obj, D, strategy) {
    const entrySide = strategy === 'long' ? 'BUY' : 'SELL';
    const closeSide = strategy === 'long' ? 'SELL' : 'BUY';
    const entry = entryFillPrice(obj[entrySide]?.[D]);
    if (entry == null) return null;
    const full = this.#fullClose(obj, D, strategy);
    const close = parseFloat(full ? full.price : obj[closeSide]?.[D]?.price);
    if (!Number.isFinite(close) || close <= 0) return null;
    return gridExitThreshold(entry, close, obj.param?.['field-gridExit']);
  }

  // Scalp gate for the deepest held rung: the live price must sit on the entry
  // side of the split (long: P < split, short: P > split), and the micro's own
  // close price must stay strictly inside that zone too — the micro must NEVER
  // cross the split line. Unknown price / missing data → false (classic DCA).
  // The live switch is checked first: off = no new scalp, and the caller's
  // out-of-zone branch pulls whatever the scalp left resting.
  #scalpMode(obj, D, strategy, microPrice) {
    if (this.hybridEnabled !== true) return false;
    const P = parseFloat(this.price);
    if (!Number.isFinite(P) || P <= 0) return false;
    const split = this.#splitPrice(obj, D, strategy);
    if (split == null) return false;
    const m = parseFloat(microPrice);
    if (!Number.isFinite(m) || m <= 0) return false;
    return strategy === 'long' ? P < split && m < split : P > split && m > split;
  }

  // Hybrid dispatcher: everything is classic DCA except the deepest held grid
  // rung, which may carry the pause-scalp micro instead of the full close.
  #pauseScalp(obj, i, el, strategy, entrySide, closeSide, classic) {
    if (this.test === true) return { status: 'pass', method: false, side: null, id: i, data: {} };

    const g = this.#gridStartIndex(obj);
    const D = deepestFilledIndex(obj[entrySide]);
    const close = obj[closeSide][i] || {};
    const symbol = el.symbol;

    // A filled micro is a banked oscillation — bookkeep it (REARM) regardless of
    // the current price, BEFORE the classic machine reads entry+close FILLED at
    // the deepest index as "cycle DONE".
    if (
      i >= g &&
      el.status === state.FILLED &&
      close.status === state.FILLED &&
      close.role === 'micro'
    ) {
      return { status: 'REARM', method: false, side: null, id: i, data: { id: i, symbol } };
    }

    // Everything except the deepest held scalp-capable rung = pure DCA.
    if (i !== D || D < g) return classic(obj, i, el);

    // A FILLED close without the micro role is the classic whole-position close
    // → DONE path belongs to the classic machine, never to the scalp.
    if (close.status === state.FILLED) return classic(obj, i, el);

    const micro = this.#gridClose(obj, el, close, closeSide);

    if (!this.#scalpMode(obj, D, strategy, micro.price)) {
      // Classic mode. A leftover live micro must yield first — otherwise the
      // classic machine would poll it as if it were the full close.
      if (
        close.role === 'micro' &&
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
      return this.#classicClose(obj, i, el, D, strategy, closeSide, classic, symbol);
    }

    // ── scalp zone ──
    if (close.status === state.NEW || close.status === state.PARTIALLY_FILLED) {
      if (close.role !== 'micro') {
        // the resting whole-position close yields to the micro (re-placed by
        // the classic path as soon as the price crosses back over the split)
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

    if (parseFloat(micro.quantity) <= 0) {
      if (close.role === 'micro') {
        // a canceled partial micro predecessor already closed the whole rung —
        // the oscillation is complete even though it never reached FILLED
        return { status: 'REARM', method: false, side: null, id: i, data: { id: i, symbol } };
      }
      // the rung was emptied by a canceled partial FULL close — nothing left to
      // scalp; the classic closes-aware machine reconciles the leftover
      return this.#classicClose(obj, i, el, D, strategy, closeSide, classic, symbol);
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
        quantity: micro.quantity,
        price: micro.price,
      },
    };
  }

  // Classic delegation for the deepest rung with one hybrid correction: when the
  // classic machine decides to PLACE the whole-position close, its slot-plan
  // fallback cannot be trusted (a previously placed micro clobbered the slot's
  // price/qty via orderResultPatch, and rebalancedClose only recomputes when
  // partial closes exist) — so the order is re-priced from the real fills
  // (#fullClose), with the same below-minimum guard as the classic path.
  #classicClose(obj, i, el, D, strategy, closeSide, classic, symbol) {
    const r = classic(obj, i, el);
    if (!r || r.method !== 'newOrder' || r.side !== closeSide) return r;
    const full = this.#fullClose(obj, D, strategy);
    if (!full) return r; // old config without fill data → keep the classic plan
    if (this.#belowMin(full.quantity, full.price)) {
      return {
        status: Status.DONE,
        method: 'cancelOpenOrders',
        side: null,
        id: i,
        leftover: { quantity: full.quantity, price: full.price, symbol },
        data: { id: i, symbol },
      };
    }
    r.data.quantity = full.quantity;
    r.data.price = full.price;
    return r;
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
}

module.exports = {
  Job,
  Status,
  rebalancedClose,
  deepestFilledIndex,
  entryFillPrice,
  gridLegProfit,
  rearmGridLeg,
  bankGridLeg,
  hybridDirty,
  hybridSwitch,
};
