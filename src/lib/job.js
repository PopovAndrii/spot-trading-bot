const { rebalanceClose } = require('./rebalanceClose');

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

// Stage 3c: quantity/price of the closing order, accounting for what was actually
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
  const stepPow = 10 ** stepSize;

  return {
    // floor the quantity — so we don't try to close more than we actually hold
    quantity: (Math.floor(res.quantity * stepPow) / stepPow).toFixed(stepSize),
    price: res.price.toFixed(tickSize),
  };
}

class Job {
  constructor(test = false) {
    this.test = test;
    // Exchange limits for reconciling the orphan leftover. Passed in from
    // jsonTimerSender at cycle start (exchangeInfo). 0 = unknown (test or a
    // failed request) → #belowMin never triggers, behavior stays as before.
    this.minQty = 0;
    this.minNotional = 0;
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
}

module.exports = { Job, Status, rebalancedClose, deepestFilledIndex };
