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

  // Position entry: everything rungs 0..i actually bought — a FILLED order, or a
  // slot still carrying the fills of an order that was replaced in it (filledQty).
  const entries = [];
  for (let k = 0; k <= i; k++) {
    const e = obj[entrySide][k];
    if (!e) continue;
    if (e.status !== state.FILLED && slotQty(e) <= 0) continue;
    if (e.status === state.FILLED && (e.executedQty === undefined || e.cummulativeQuoteQty === undefined)) {
      return null; // incomplete data (old config) → fall back to precompute
    }
    entries.push(e);
  }

  // Closes that actually closed something (partial/canceled-with-fill, including
  // fills inherited from an order the slot has since replaced).
  const closes = (obj[closeSide] || []).filter((c) => slotQty(c) > 0);
  if (closes.length === 0) return null; // no partials → precompute

  const profit = parseFloat(obj['param']['field-profit']) || 0;
  const commission = parseFloat(obj['param']['field-commission']) || 0;

  // The hybrid scalp bank is realized money of THIS cycle — the close no longer
  // has to recover it (see rebalanceClose). Zero on non-hybrid cycles.
  const res = rebalanceClose(entries, closes, strategy, profit + commission,
    Number(obj.gridRealized) || 0);
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

// What a SLOT has really executed — the money question, and it is not the same as
// what its CURRENT order has executed.
//
// A slot is one rung of the ladder, but over a cycle it carries a succession of
// orders: a close is placed, partially fills, gets pulled (the bank moved the exit),
// and a fresh one takes its place. The fill of the pulled order is real — the base
// changed hands, the quote landed — yet it lived only in executedQty, which the
// next order's result overwrites with its own zero. That is how a cycle sold 0.141
// BNB for 81.96 USDT and then reported the position as still open: the money was on
// the exchange and gone from the books.
//
// So a replaced order's fills are added into filledQty/filledQuote before its slot
// is reused (see applyOrderResult), and every reader of a slot's fills asks these
// two helpers instead of executedQty. Absent fields = 0, so pre-existing configs
// read exactly as they did. Pure.
function slotQty(slot) {
  return (Number(slot?.executedQty) || 0) + (Number(slot?.filledQty) || 0);
}

function slotQuote(slot) {
  return (Number(slot?.cummulativeQuoteQty) || 0) + (Number(slot?.filledQuote) || 0);
}

// Real average fill price of an entry slot (quote / qty), falling back to the
// slot's resting price when fill data is missing (old config). null when neither
// is known. Pure.
function entryFillPrice(slot) {
  const qty = slotQty(slot);
  const quote = slotQuote(slot);
  if (qty > 0 && quote > 0) return quote / qty;
  const p = parseFloat(slot?.price);
  return Number.isFinite(p) && p > 0 ? p : null;
}

// Realized quote profit of one completed grid oscillation: quote received on the
// SELL minus quote spent on the BUY. Works for both long and short (entry/close
// sides differ, but sellQuote − buyQuote is the leg profit either way). Pure.
function gridLegProfit(buySlot, sellSlot) {
  return slotQuote(sellSlot) - slotQuote(buySlot);
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
    // The leg's whole history goes with it: its profit is banked into gridRealized
    // and its base is back to zero. Left behind, the accumulators would be counted
    // a second time by every reader of the leg's fills.
    delete s.filledQty;
    delete s.filledQuote;
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
  // 'tail' counts too: a filled tail read by the classic machine is entry+close
  // FILLED = "cycle DONE" — with the carrying rung still held.
  return closes.some((c) => c?.role === 'micro' || c?.role === 'tail');
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
            // No partial fills to net out → rebalancedClose bows out and the slot
            // plan takes over. That plan is only trustworthy while the slot still
            // holds what the calculator wrote: the scalp overwrites price/qty with
            // ITS OWN rung-sized numbers, and they outlive the micro. Seen live:
            // the hybrid was switched off, the micro was pulled, and the classic
            // close inherited 0.096 @ 606.35 while 0.363 was held — a quarter of the
            // position covered, for three days, until that close filled and ended
            // the cycle. So recompute from the real fills first (#fullClose does not
            // bail out on a clean book) and keep the slot plan only for a config too
            // old to carry fill data.
            const reb = rebalancedClose(obj, i, 'long') || this.#fullClose(obj, i, 'long');
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
        const D = deepestFilledIndex(obj['BUY']);
        if (D > i) {
          return { status: 'pass', method: false, side: null, id: i, data: {} };
        }

        return this.#doneIfFlat(obj, i, el, D, 'long', 'SELL');
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
            // Mirror of long: the slot plan is the last resort, not the first —
            // a pulled micro leaves its rung-sized numbers behind on the slot.
            const reb = rebalancedClose(obj, i, 'short') || this.#fullClose(obj, i, 'short');
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
        const D = deepestFilledIndex(obj['SELL']);
        if (D > i) {
          return { status: 'pass', method: false, side: null, id: i, data: {} };
        }

        return this.#doneIfFlat(obj, i, el, D, 'short', 'BUY');
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

    // Fold the scalp bank into the exit: each banked oscillation lowers the
    // whole-position close (long; raises it for short), doing the work of the
    // martingale volume the re-arm took back. See rebalanceClose.
    const res = rebalanceClose(entries, closes, strategy, fees, Number(obj.gridRealized) || 0);
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

  // Is the cycle holding anything at all? Everything the filled entries bought,
  // minus everything the closes have already sold back — the micro that just fired
  // included, since its fills are still on the slot when this is asked.
  //
  // Missing fill data (a config from before executedQty was persisted) reads as NOT
  // flat: "cannot tell" must never be allowed to mean "closed", or an old cycle ends
  // itself on the first micro. Rounded down to stepSize — dust below the exchange's
  // own resolution is not a position.
  #positionFlat(obj, D, strategy) {
    const entrySide = strategy === 'short' ? 'SELL' : 'BUY';
    const closeSide = strategy === 'short' ? 'BUY' : 'SELL';

    let held = new Decimal(0);
    for (let k = 0; k <= D; k++) {
      const e = obj[entrySide]?.[k];
      if (!e) continue;
      if (e.status !== state.FILLED && slotQty(e) <= 0) continue;
      if (e.status === state.FILLED && e.executedQty === undefined) return false;
      held = held.plus(slotQty(e));
    }
    for (const c of obj[closeSide] || []) {
      held = held.minus(slotQty(c));
    }

    const step = parseInt(obj.param?.['field-stepSize'], 10) || 0;
    return held.toDecimalPlaces(step, Decimal.ROUND_DOWN).lte(0);
  }

  // A filled close ends the cycle ONLY if the books are square. Index reasoning
  // ("i is the deepest filled entry, so this close was THE close") is not enough:
  // a close sized for ONE RUNG fills at the deepest index too. That is what a
  // hybrid micro is — and once its 'role' marker is gone (it is deleted, never
  // re-derived) the classic machine cannot tell the two apart. Seen live: a micro
  // sold its one rung, the cycle went DONE on that fill, cancelOpenOrders pulled
  // the tail with it, and the rest of the position was left on the balance with
  // nothing on the book.
  //
  // So ask the books. While anything is still held, re-place the close for the
  // leftover: rebalancedClose nets out what the filled closes already sold, so it
  // is both sized and priced off what actually remains (the bank included). The
  // slot's fills survive the re-use — bankSlotFills carries them into
  // filledQty/filledQuote, which is what rebalancedClose reads next time.
  //
  // Falls back to the old behaviour where it cannot do better: a leftover under
  // the exchange minimum is dust (DONE + leftover, the user is notified), and a
  // config too old to carry fill data ends as it always did.
  #doneIfFlat(obj, i, el, D, strategy, closeSide) {
    const symbol = el.symbol;
    const done = (leftover) => ({
      status: Status.DONE,
      method: 'cancelOpenOrders',
      side: null,
      id: i,
      ...(leftover ? { leftover } : {}),
      data: { id: i, symbol },
    });

    if (this.#positionFlat(obj, D, strategy)) return done();

    const reb = rebalancedClose(obj, i, strategy);
    if (!reb) return done(); // no fill data (old config) → classic ending

    if (this.#belowMin(reb.quantity, reb.price)) {
      return done({ quantity: reb.quantity, price: reb.price, symbol });
    }

    return {
      status: null,
      method: 'newOrder',
      side: closeSide,
      id: i,
      data: {
        id: i,
        symbol,
        side: closeSide,
        type: 'LIMIT',
        timeInForce: 'GTC',
        quantity: reb.quantity,
        price: reb.price,
      },
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

  // The Grid exit % the micro NEEDS on this rung — the knob, already turned.
  //
  // A blocked micro (the micro crosses the split) refuses in silence and the cycle
  // quietly runs as plain DCA. The table said "raise Grid exit %" and stopped there,
  // which leaves the one question that matters unanswered: raise it to WHAT. On a
  // pair like ETHBTC the whole gap is a tick or two wide, so guessing costs a cycle.
  //
  // Both ends of the split move with the rung, not with the knob, so the answer is a
  // sweep of the only free variable: the lowest whole percent that fits, chosen
  // NEAREST the current setting (the split is not always monotonic in pct — a far
  // side may also fit, and jumping there would be a bigger change than asked for).
  // null = no percent fits (the micro needs more room than the whole gap has — the
  // knob to turn is Micro profit %) or the endpoints are unknown. Read-only.
  requiredGridExit(obj, D, strategy, microPrice) {
    const entrySide = strategy === 'long' ? 'BUY' : 'SELL';
    const closeSide = strategy === 'long' ? 'SELL' : 'BUY';
    const entry = entryFillPrice(obj[entrySide]?.[D]);
    if (entry == null) return null;
    const full = this.#fullClose(obj, D, strategy);
    const close = parseFloat(full ? full.price : obj[closeSide]?.[D]?.price);
    if (!Number.isFinite(close) || close <= 0) return null;

    const m = parseFloat(microPrice);
    if (!Number.isFinite(m) || m <= 0) return null;

    const cur = Number(obj.param?.['field-gridExit']);
    const from = Number.isFinite(cur) ? cur : 50;
    const fits = (pct) => {
      const s = gridExitThreshold(entry, close, pct);
      return strategy === 'short' ? m > s : m < s;
    };

    let best = null;
    for (let pct = 0; pct <= 100; pct++) {
      if (!fits(pct)) continue;
      if (best == null || Math.abs(pct - from) < Math.abs(best - from)) best = pct;
    }
    return best;
  }

  // Scalp gate for the deepest held rung. Unknown price / missing data → false
  // (classic DCA). The live switch is checked first: off = no new scalp, and the
  // caller's out-of-zone branch pulls whatever the scalp left resting.
  //
  // Two thresholds, not one, and they are deliberately different — this asymmetry
  // IS the anti-flap:
  //
  //   ARMING (nothing resting yet): the price must still be on the ENTRY side of the
  //     MICRO itself. A micro is a limit order placed away from the market, waiting
  //     for a bounce to come to it; armed once the price is already past it, it is a
  //     sell below the bid — an instant taker fill at whatever the book offers, which
  //     is not a scalp at all.
  //   HOLDING (a micro is on the book): only the SPLIT pulls it. Since the micro must
  //     always sit inside the split, the arm line and the release line can never
  //     coincide: the price has to travel the whole micro→split band to flip the
  //     state. Gate on the split alone (as this did) and the two lines are the same
  //     one — a price grazing it arms and cancels the scalp tick after tick, which is
  //     exactly what a narrow ladder produced live. Want a wider dead band? Raise
  //     Grid exit %: it pushes the split away from the micro.
  //
  // The micro must NEVER cross the split — that is a placement invariant, checked
  // against the raw line in both states.
  #scalpMode(obj, D, strategy, microPrice, resting = false) {
    if (this.hybridEnabled !== true) return false;
    const P = parseFloat(this.price);
    if (!Number.isFinite(P) || P <= 0) return false;
    const split = this.#splitPrice(obj, D, strategy);
    if (split == null) return false;
    const m = parseFloat(microPrice);
    if (!Number.isFinite(m) || m <= 0) return false;

    const inside = (x, line) => (strategy === 'short' ? x > line : x < line);

    if (!inside(m, split)) return false; // no room under the split → no scalp, ever
    return inside(P, resting ? split : m);
  }

  // Hybrid dispatcher: everything is classic DCA except the deepest held grid
  // rung, which may carry the pause-scalp micro instead of the full close.
  #pauseScalp(obj, i, el, strategy, entrySide, closeSide, classic) {
    if (this.test === true) return { status: 'pass', method: false, side: null, id: i, data: {} };

    const g = this.#gridStartIndex(obj);
    const D = deepestFilledIndex(obj[entrySide]);
    const close = obj[closeSide][i] || {};
    const symbol = el.symbol;

    // A micro is ALWAYS the hybrid's to finish — the aim knob (field-gridArm)
    // gates NEW scalps only, never the care of an existing one. Seen live: with
    // a micro resting on rung #3 the arm was raised to #4, the rung fell out of
    // the scalp gate and the classic machine adopted the micro as if it were the
    // whole-position close — polling a rung-sized order whose fill would have
    // ended the cycle with most of the position still held. So the role is
    // checked BEFORE any arm/deepest routing:
    //   FILLED micro → bank the oscillation (REARM) wherever the arm points now,
    //   before the classic machine reads entry+close FILLED as "cycle DONE";
    if (
      el.status === state.FILLED &&
      close.status === state.FILLED &&
      close.role === 'micro'
    ) {
      // …unless that micro sold the LAST volume the cycle was holding. Re-arming
      // there would re-open a position the cycle had already fully exited — the rung
      // has nothing left to oscillate against, and the ladder below it is still
      // armed, so the next dip is entered as if the cycle never ended. Seen live: the
      // micro and the whole-position close filled on the same rise, the books were
      // square and in profit, and the re-arm bought straight back into a crash.
      // The oscillation is still banked (the money is real) — `bank` says so — and
      // then the cycle closes on the spot.
      if (this.#positionFlat(obj, D, strategy)) {
        return {
          status: Status.DONE,
          method: 'cancelOpenOrders',
          side: null,
          id: i,
          bank: i,
          data: { id: i, symbol },
        };
      }
      return { status: 'REARM', method: false, side: null, id: i, data: { id: i, symbol } };
    }

    //   live micro on a rung that is no longer the scalp-capable deepest (the
    //   arm was raised past it, or a deeper rung filled) → pull it and hand the
    //   rung back; swap gets the classic close placed the same tick.
    if (
      close.role === 'micro' &&
      close.orderId != null &&
      (close.status === state.NEW || close.status === state.PARTIALLY_FILLED) &&
      (i !== D || D < g)
    ) {
      return {
        status: null,
        method: 'cancelOrder',
        probe: true,
        swap: true,
        side: closeSide,
        id: i,
        data: { id: i, symbol, orderId: close.orderId },
      };
    }

    // The TAIL — the rest of the position resting NEXT TO the micro, so the
    // closes on the book always add up to the whole position: a burst spike
    // fills both and the cycle closes on the exchange, not in the engine's
    // reaction time. It lives on the rung right above the carrying one, priced
    // like the whole-position close of rungs 0..D-1 with the bank folded in;
    // after every banked micro the REARM handler pulls it (staleCloseIndices)
    // and it is re-placed here at the recomputed price.
    if (close.role === 'tail') {
      if (el.status === state.FILLED && close.status === state.FILLED) {
        // The tail closed rungs 0..D-1 on its own. With nothing else held the
        // cycle is over; otherwise it goes on holding just the carrying rung —
        // never a classic DONE, which would end it with that rung still held.
        if (this.#positionFlat(obj, D, strategy)) {
          return {
            status: Status.DONE,
            method: 'cancelOpenOrders',
            side: null,
            id: i,
            data: { id: i, symbol },
          };
        }
        return { status: 'pass', method: false, side: null, id: i, data: {} };
      }
      // the ladder moved — a live tail off its slot covers the wrong remainder
      if (
        close.orderId != null &&
        (close.status === state.NEW || close.status === state.PARTIALLY_FILLED) &&
        i !== D - 1
      ) {
        return {
          status: null,
          method: 'cancelOrder',
          swap: true,
          side: closeSide,
          id: i,
          data: { id: i, symbol, orderId: close.orderId },
        };
      }
    }

    // Everything except the deepest held scalp-capable rung = pure DCA — with
    // one insertion: the slot right above a live micro carries the tail.
    if (i !== D || D < g) {
      const md = obj[closeSide]?.[D];
      const microLive =
        md?.role === 'micro' &&
        md.orderId != null &&
        (md.status === state.NEW || md.status === state.PARTIALLY_FILLED);

      // While the scalp holds the head, a live close anywhere but the tail's
      // slot covers the wrong remainder (left from before the ladder deepened).
      // Pull it — the tail takes its place bigger and lower, exactly the way
      // the classic close has always moved on every new fill. Any close already
      // resting ON the tail's own slot (role 'tail', or a role-less classic
      // close the ladder deepened past) is handled below instead — placed,
      // corrected on drift, or left alone if it already matches.
      if (
        microLive &&
        i !== D - 1 &&
        close.role !== 'micro' &&
        !close.manual &&
        close.orderId != null &&
        (close.status === state.NEW || close.status === state.PARTIALLY_FILLED)
      ) {
        return {
          status: null,
          method: 'cancelOrder',
          swap: true,
          side: closeSide,
          id: i,
          data: { id: i, symbol, orderId: close.orderId },
        };
      }

      if (i === D - 1 && el.status === state.FILLED) {
        const t = this.#tailClose(obj, i, D, strategy, closeSide);
        // Resting covers role 'tail' AND a role-less leftover classic close on
        // this slot (the ladder deepened past it without it ever yielding) —
        // both are diffed against the recompute below and cancelReplaced on
        // drift, which also stamps the slot with role 'tail' going forward.
        const tailResting =
          close.orderId != null &&
          (close.status === state.NEW || close.status === state.PARTIALLY_FILLED);

        if (t && !tailResting) {
          return {
            status: null,
            method: 'newOrder',
            side: closeSide,
            id: i,
            role: 'tail',
            data: {
              id: i,
              symbol,
              side: closeSide,
              type: 'LIMIT',
              timeInForce: 'GTC',
              quantity: t.quantity,
              price: t.price,
            },
          };
        }

        // Live tail already resting on its slot: follow the same knobs the
        // micro follows (Micro profit %, commission) by diffing the freshly
        // recomputed price/qty against what is actually on the book and
        // cancelReplacing on drift — otherwise a lowered Micro profit % only
        // ever reaches the tail the next time the ladder deepens.
        if (t && tailResting) {
          const tick = parseInt(obj.param?.['field-tickSize'], 10) || 0;
          const tickVal = tick > 0 ? Math.pow(10, -tick) : 1;
          const drift = Math.abs(parseFloat(t.price) - parseFloat(close.price));
          if (drift >= tickVal / 2 && parseFloat(t.quantity) > 0) {
            return {
              status: null,
              method: 'cancelReplace',
              side: closeSide,
              id: i,
              role: 'tail',
              data: {
                id: i,
                symbol,
                side: closeSide,
                type: 'LIMIT',
                timeInForce: 'GTC',
                quantity: t.quantity,
                price: t.price,
                orderId: close.orderId,
              },
            };
          }
        }
      }
      return classic(obj, i, el);
    }

    // A FILLED close without the micro role is the classic whole-position close
    // → DONE path belongs to the classic machine, never to the scalp.
    if (close.status === state.FILLED) return classic(obj, i, el);

    const micro = this.#gridClose(obj, el, close, closeSide);

    // Is a micro already on the book? The gate holds a resting one to a different
    // line than it uses to arm a new one (see #scalpMode).
    const resting =
      close.role === 'micro' &&
      close.orderId != null &&
      (close.status === state.NEW || close.status === state.PARTIALLY_FILLED);

    if (!this.#scalpMode(obj, D, strategy, micro.price, resting)) {
      // Classic mode. A leftover live micro must yield first — otherwise the
      // classic machine would poll it as if it were the full close.
      if (resting) {
        return {
          status: null,
          method: 'cancelOrder',
          probe: true,
          swap: true,
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
          swap: true,
          side: closeSide,
          id: i,
          data: { id: i, symbol, orderId: close.orderId },
        };
      }

      // Follow the Micro profit %/commission knob on the LIVE micro, not only on the
      // next arm: #gridClose has re-priced the target from the real entry fill, and
      // when the knob moved it a whole tick or more, carry the resting micro there.
      // WHY an atomic cancel-replace and not cancel-then-place: a bare cancel sets
      // resting=false, so the re-place must clear the ARMING gate (inside(P, micro)),
      // which refuses inside the micro→split band and drops the scalp into a full
      // close, leaving the rung naked for a tick. cancelReplace is a MOVE of a scalp
      // already being HELD: reaching here means the hold gate (P inside split) and
      // the fit gate (recomputed micro under the split) both passed in #scalpMode.
      // gridExit is excluded for free — it never enters microClosePrice, so it moves
      // no micro price and the drift stays 0. Both prices are toFixed(tick), so after
      // the move the recompute equals the resting price → drift 0 → fires once per
      // knob turn, never churns.
      const tick = parseInt(obj.param?.['field-tickSize'], 10) || 0;
      const tickVal = tick > 0 ? Math.pow(10, -tick) : 1;
      const drift = Math.abs(parseFloat(micro.price) - parseFloat(close.price));
      if (
        drift >= tickVal / 2 &&
        parseFloat(micro.quantity) > 0 &&
        !this.#belowMin(micro.quantity, micro.price)
      ) {
        return {
          status: null,
          method: 'cancelReplace',
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
            orderId: close.orderId,
          },
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
  // actually filled MINUS what this close slot has ALREADY sold/bought back across
  // EVERY order that rested on it (slotQty = the live order's fill + fills banked
  // from replaced predecessors — a cancel-replace or a micro↔full-close swap leaves
  // the earlier fill in filledQty; counting only the live executedQty would re-sell
  // it and oversell the rung), floored to stepSize. Zero left → the oscillation is
  // de-facto complete (caller banks it).
  #gridClose(obj, entry, close, closeSide) {
    const p = obj.param || {};
    const microProfit = p['field-microProfit'] ?? 0.1;
    const commission = p['field-commission'] ?? 0;
    const tick = parseInt(p['field-tickSize'], 10) || 0;
    const step = parseInt(p['field-stepSize'], 10) || 0;
    const strategy = closeSide === 'SELL' ? 'long' : 'short';

    const price = microClosePrice(entry.price, microProfit, commission, tick, strategy);
    const execQty = new Decimal(entry.executedQty || entry.quantity || 0);
    const already = new Decimal(slotQty(close));
    const quantity = Decimal.max(execQty.minus(already), 0)
      .toDecimalPlaces(step, Decimal.ROUND_DOWN)
      .toFixed(step);
    return { quantity, price };
  }

  // Quantity/price of the TAIL, or null when it must not be placed. The tail is
  // the whole-position close of rungs 0..D-1 — the carrying rung is excluded,
  // its volume is the micro's. Priced exactly like the real exit (rebalanceClose
  // over the ACTUAL fills, bank folded in), so micro + tail always cover the
  // position at the prices the cycle actually needs. Refuses when: no live micro
  // on D (the tail accompanies the scalp, alone the classic close does the job),
  // the slot is busy or the user's (manual), ANOTHER live non-micro close still
  // rests (placing on top of it would oversell the position), fill data is
  // missing (old config), or the remainder is below exchange minimums.
  //
  // Price floor/ceiling: the cycle can't finish before the live micro fills
  // anyway, so if the micro's price is already more favorable than the raw
  // rebalanceClose price, the tail is placed AT the micro's price instead —
  // free profit on the bigger 0..D-1 volume, using a price the micro already
  // proved safe (it carries its own margin). Also callable while the tail
  // itself already rests (role === 'tail' on this slot) to recompute what it
  // SHOULD be right now — the caller diffs that against the live order and
  // cancelReplaces on drift, the same way the micro follows the profit knob.
  #tailClose(obj, i, D, strategy, closeSide) {
    const entrySide = strategy === 'long' ? 'BUY' : 'SELL';

    const md = obj[closeSide]?.[D];
    const microLive =
      md?.role === 'micro' &&
      md.orderId != null &&
      (md.status === state.NEW || md.status === state.PARTIALLY_FILLED);
    if (!microLive) return null;

    const slot = obj[closeSide]?.[i];
    if (!slot || slot.manual) return null;
    // Refuse over a micro (never ours to touch) or a terminal FILLED close (the
    // caller's own FILLED branch owns that). A role-less resting close is fair
    // game — it is exactly the leftover classic close the ladder deepened past.
    if (slot.role === 'micro' || slot.status === state.FILLED) return null;

    const otherLive = (obj[closeSide] || []).some(
      (c, k) =>
        k !== D &&
        k !== i &&
        c &&
        c.orderId != null &&
        c.role !== 'micro' &&
        !c.manual &&
        (c.status === state.NEW || c.status === state.PARTIALLY_FILLED)
    );
    if (otherLive) return null;

    const entries = [];
    for (let k = 0; k < D; k++) {
      const e = obj[entrySide][k];
      if (!e || e.status !== state.FILLED) continue;
      if (e.executedQty === undefined || e.cummulativeQuoteQty === undefined) return null;
      entries.push(e);
    }
    if (entries.length === 0) return null;

    // What the non-micro closes already sold reduces the tail; the micro's own
    // fills belong to the carrying rung's slice, not to this remainder.
    const closes = (obj[closeSide] || []).filter(
      (c) => c && c.role !== 'micro' && (Number(c?.executedQty) || 0) > 0
    );

    const p = obj.param || {};
    const fees = (parseFloat(p['field-profit']) || 0) + (parseFloat(p['field-commission']) || 0);
    const res = rebalanceClose(entries, closes, strategy, fees, Number(obj.gridRealized) || 0);
    if (!res) return null;

    const stepSize = parseInt(p['field-stepSize'], 10) || 0;
    const tickSize = parseInt(p['field-tickSize'], 10) || 0;
    const quantity = new Decimal(res.quantity)
      .toDecimalPlaces(stepSize, Decimal.ROUND_DOWN)
      .toFixed(stepSize);

    let priceVal = new Decimal(res.price);
    const microPrice = new Decimal(md.price);
    const microBetter =
      strategy === 'long' ? microPrice.gt(priceVal) : microPrice.lt(priceVal);
    if (microBetter) priceVal = microPrice;
    const price = priceVal.toFixed(tickSize);

    if (parseFloat(quantity) <= 0 || this.#belowMin(quantity, price)) return null;

    return { quantity, price };
  }

  // Read-only mirror of the scalp decision, for the table. Every number here comes
  // out of the SAME private helpers the engine trades on (#gridStartIndex,
  // #fullClose, #splitPrice, #gridClose), so the UI cannot disagree with the robot
  // and the client computes nothing. Places and pulls nothing.
  //
  // The gate is reported as its two independent halves, because they fail for
  // different reasons and are fixed with different knobs:
  //   fits   — is there ROOM under the split for the micro? A settings question:
  //            no room → raise Grid exit % or lower Micro profit %. Silent
  //            otherwise: the engine simply never places a scalp and the table
  //            looks like plain DCA, which is exactly what confused everyone.
  //   inZone — is the LIVE PRICE on the entry side of the split? A market question:
  //            out of zone → nothing is wrong, the scalp just waits (or yields).
  // armed = enabled AND both → this is the tick the micro rests on the book.
  // Prices/quantities are strings at the pair's tick/step precision, ready to print.
  view(obj, strategy) {
    const p = obj?.param || {};
    const entrySide = strategy === 'short' ? 'SELL' : 'BUY';
    const closeSide = strategy === 'short' ? 'BUY' : 'SELL';
    if (!Array.isArray(obj?.[entrySide]) || !Array.isArray(obj?.[closeSide])) return null;

    const g = this.#gridStartIndex(obj);
    const D = deepestFilledIndex(obj[entrySide]);
    const P = parseFloat(this.price);

    const out = {
      enabled: p['field-hybrid'] === 'on' || p['field-hybrid'] === true,
      arm: Number.isFinite(g) ? g + 1 : null, // 1-based — the order number the UI shows
      deepest: D >= 0 ? D + 1 : null,
      price: Number.isFinite(P) ? String(this.price) : null,
      banked: Number(obj.gridRealized) || 0,
      close: null,
      micro: null,
      split: null,
      fits: false,
      // The Grid exit % that WOULD fit, when the current one does not (null = no
      // percent fits, or nothing to compute it from). The UI prints it, and the
      // auto-exit switch turns the knob to it.
      needExit: null,
      inZone: false,
      armed: false,
      resting: false,
    };

    if (D < 0) return out; // nothing held → no pause, no scalp

    out.close = this.#fullClose(obj, D, strategy);

    // Above the arm the pause belongs to plain DCA: there is no micro to describe.
    if (D < g) return out;

    const close = obj[closeSide][D] || {};
    const micro = this.#gridClose(obj, obj[entrySide][D], close, closeSide);
    const split = this.#splitPrice(obj, D, strategy);
    const tick = parseInt(p['field-tickSize'], 10) || 0;
    const below = (x) => (strategy === 'short' ? x > split : x < split);

    out.resting =
      close.role === 'micro' &&
      (close.status === state.NEW || close.status === state.PARTIALLY_FILLED);

    // Nothing left on the rung (a close already took its volume, or the cycle is
    // over) → there is no micro to describe, and a "× 0.000" badge would be a lie.
    if (parseFloat(micro.quantity) <= 0) return out;

    // A resting micro sits on the book at the price it was PLACED at — not the
    // recompute, which tracks the CURRENT Micro profit % and drifts away the moment
    // that knob is turned under a live order (lower it for an easier fill and the
    // badge would show a price the exchange never held). Show what is actually
    // there; the engine never re-prices a resting micro, it only polls it. The
    // fit/arm logic below stays on the recompute the engine gates on, so the badge
    // reads "real" while the decision stays consistent with #scalpMode.
    out.micro =
      out.resting && close.price != null
        ? { ...micro, price: new Decimal(close.price).toFixed(tick) }
        : micro;

    if (split == null) return out; // unknown price or fill data → the engine stays classic

    out.split = new Decimal(split).toFixed(tick);
    out.fits = below(parseFloat(micro.price));
    out.inZone = Number.isFinite(P) && below(P);

    if (!out.fits) {
      out.needExit = this.requiredGridExit(obj, D, strategy, micro.price);
    }

    // The gate is asymmetric (see #scalpMode), so the table has to be too, or it will
    // promise a scalp in the band between the micro and the split — where a resting
    // one is held, but a new one is never armed.
    const line = out.resting ? split : parseFloat(micro.price);
    out.armed =
      out.enabled &&
      out.fits &&
      Number.isFinite(P) &&
      (strategy === 'short' ? P > line : P < line);
    return out;
  }
}

module.exports = {
  Job,
  Status,
  rebalancedClose,
  deepestFilledIndex,
  slotQty,
  slotQuote,
  entryFillPrice,
  gridLegProfit,
  rearmGridLeg,
  bankGridLeg,
  hybridDirty,
  hybridSwitch,
};
