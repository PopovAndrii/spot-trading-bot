const { rebalanceClose } = require('./rebalanceClose');

const Status = Object.freeze({
  READY: 0, // 0 - can deletad. never started
  STARTED: 1, // 1 - in process. some order done
  STOPPED: 2, // 2 -
  DONE: 3, // 3 - not done(error etc)
});

const state = Object.freeze({
  NEW: 'NEW', // Ордер создан, но ещё не исполнен
  CANCELED: 'CANCELED', // Ордер был отменён пользователем до исполнения
  PARTIALLY_FILLED: 'PARTIALLY_FILLED', // Ордер частично исполнен, но ещё не завершён полностью.
  FILLED: 'FILLED', // Ордер полностью исполнен
  PENDING_CANCEL: 'PENDING_CANCEL', // Идёт процесс отмены ордера (редко используется)
  REJECTED: 'REJECTED', // Ордер был отклонён системой Binance (например, из-за ошибок)
  EXPIRED: 'EXPIRED', // Ордер истёк по времени (например, LIMIT GTC может быть отменён по тайм-ауту или из-за сетевых сбоев)
});

// Самый глубокий индекс ордера со статусом FILLED (или -1). Для long это buy,
// для short — sell: индекс, до которого реально набрана позиция. Нужен, чтобы
// не объявить цикл завершённым, пока ниже исполнившегося закрытия остались
// залитые ордера набора (орфан-инвентарь после «слепого» окна).
function deepestFilledIndex(arr) {
  if (!Array.isArray(arr)) return -1;
  for (let j = arr.length - 1; j >= 0; j--) {
    if (arr[j] && arr[j].status === state.FILLED) return j;
  }
  return -1;
}

// Этап 3c: объём/цена закрывающего ордера с учётом реально проданного/выкупленного
// в частично исполненных и отменённых закрытиях за цикл.
// Возвращает { quantity, price } (строки, округлённые по step/tick) либо null —
// тогда вызывающий использует предрасчётные значения из конфига.
function rebalancedClose(obj, i, strategy) {
  const entrySide = strategy === 'long' ? 'BUY' : 'SELL'; // чем набирали позицию
  const closeSide = strategy === 'long' ? 'SELL' : 'BUY'; // чем закрываем

  // Набор позиции: реально исполненные ордера 0..i.
  const entries = [];
  for (let k = 0; k <= i; k++) {
    const e = obj[entrySide][k];
    if (!e || e.status !== state.FILLED) continue;
    if (e.executedQty === undefined || e.cummulativeQuoteQty === undefined) {
      return null; // неполные данные (старый конфиг) → фолбэк на предрасчёт
    }
    entries.push(e);
  }

  // Закрытия, реально что-то закрывшие (частичные/отменённые с исполнением).
  const closes = (obj[closeSide] || []).filter((c) => (Number(c.executedQty) || 0) > 0);
  if (closes.length === 0) return null; // партиалов не было → предрасчёт

  const profit = parseFloat(obj['param']['field-profit']) || 0;
  const commission = parseFloat(obj['param']['field-commission']) || 0;

  const res = rebalanceClose(entries, closes, strategy, profit + commission);
  if (!res) return null; // позиция уже закрыта целиком

  const stepSize = parseInt(obj['param']['field-stepSize'], 10) || 0;
  const tickSize = parseInt(obj['param']['field-tickSize'], 10) || 0;
  const stepPow = 10 ** stepSize;

  return {
    // floor по объёму — чтобы не пытаться закрыть больше, чем реально держим
    quantity: (Math.floor(res.quantity * stepPow) / stepPow).toFixed(stepSize),
    price: res.price.toFixed(tickSize),
  };
}

class Job {
  constructor(test = false) {
    this.test = test;
    // Биржевые лимиты для реконсиляции орфан-остатка. Прокидываются из
    // jsonTimerSender при старте цикла (exchangeInfo). 0 = неизвестны (тест или
    // сбой запроса) → #belowMin не срабатывает, поведение как раньше.
    this.minQty = 0;
    this.minNotional = 0;
  }

  // Остаток меньше биржевых лимитов (LOT_SIZE.minQty / NOTIONAL.minNotional)?
  // Если лимиты неизвестны (0) — считаем, что проходит (не блокируем закрытие).
  #belowMin(qty, price) {
    const q = parseFloat(qty) || 0;
    const p = parseFloat(price) || 0;
    if (this.minQty && q < this.minQty) return true;
    if (this.minNotional && q * p < this.minNotional) return true;
    return false;
  }

  long = (obj, i, el) => {
    if (this.test === true) return { status: 'pass', method: false, side: null, id: i, data: {} };

    // Закрытие всей позиции висит на ОДНОМ sell верхнего исполненного buy-индекса;
    // нижние sell отменяются (CANCELED) или вовсе не выставлялись (null) как
    // устаревшие — для них pass правилен, ПОКА закрытие делегировано вверх, т.е.
    // buy[i+1] тоже FILLED. null здесь — орфан после «слепого» окна: несколько
    // buy залились разом, а sell нижнего индекса исполнился раньше, чем закрытие
    // успело переползти вниз; нижние закрытия так и не выставились. Без higherFilled
    // (верхний sell CANCELED, а buy[i+1] не исполнился) позиция осталась бы без
    // закрытия — тогда переставляем.
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
          if (i > 0) {
            // отменяем нижний sell, только если он реально висит на бирже
            // (orderId есть и статус NEW/PARTIALLY_FILLED). null (никогда не
            // выставлялся — орфан) или уже FILLED/CANCELED — отменять нечего;
            // cancelOrder(orderId:null) иначе зациклил бы проход на ошибке.
            const prevClose = obj['SELL'][i - 1];
            if (
              prevClose.orderId != null &&
              (prevClose.status === state.NEW || prevClose.status === state.PARTIALLY_FILLED)
            ) {
              return {
                status: null,
                method: 'cancelOrder',
                side: 'SELL',
                id: i - 1,
                data: {
                  id: i - 1,
                  symbol: el.symbol,
                  orderId: prevClose.orderId,
                },
              };
            }
          }

          if (obj['SELL'][i].status === null || obj['SELL'][i].status === state.CANCELED) {
            const reb = rebalancedClose(obj, i, 'long'); // null → предрасчёт
            const quantity = reb ? reb.quantity : obj['SELL'][i].quantity;
            const price = reb ? reb.price : obj['SELL'][i].price;

            // Орфан-инвентарь: часть позиции уже продал исполнившийся нижний
            // sell, остаток меньше биржевого минимума — закрытие не выставить.
            // Завершаем цикл и помечаем leftover: итератор уведомит, что мелочь
            // осталась на балансе (решение за пользователем).
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
        // Закрытие на индексе i исполнилось. DONE правомерен ТОЛЬКО если i —
        // самый глубокий залитый buy. Если ниже есть исполненные buy (k>i) —
        // орфан после «слепого» окна (sell проскочил между падением и отскоком):
        // позиция закрыта лишь частично. Не завершаем цикл — pass отдаёт ход
        // нижним индексам, которые доставят закрытие на остаток (guard выше +
        // case FILLED с rebalancedClose).
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

    // Зеркально long: закрытие short висит на ОДНОМ buy верхнего исполненного
    // sell-индекса. pass по нижнему buy (CANCELED или ещё не выставленному null —
    // орфан после слепого окна) допустим только когда закрытие делегировано вверх
    // (sell[i+1] тоже FILLED); иначе переставляем.
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
          if (i > 0) {
            // отменяем нижний buy, только если он реально висит на бирже
            // (orderId + NEW/PARTIALLY_FILLED). null/FILLED/CANCELED — отменять
            // нечего; cancelOrder(orderId:null) иначе зациклил бы проход.
            const prevClose = obj['BUY'][i - 1];
            if (
              prevClose.orderId != null &&
              (prevClose.status === state.NEW || prevClose.status === state.PARTIALLY_FILLED)
            ) {
              return {
                status: null,
                method: 'cancelOrder',
                side: 'BUY',
                id: i - 1,
                data: {
                  symbol: el.symbol,
                  orderId: prevClose.orderId,
                },
              };
            }
          }

          if (obj['BUY'][i].status === null || obj['BUY'][i].status === state.CANCELED) {
            const reb = rebalancedClose(obj, i, 'short'); // null → предрасчёт
            const quantity = reb ? reb.quantity : obj['BUY'][i].quantity;
            const price = reb ? reb.price : obj['BUY'][i].price;

            // Орфан-инвентарь: часть позиции уже выкупил исполнившийся нижний buy,
            // остаток меньше биржевого минимума — закрытие не выставить. Завершаем
            // цикл и помечаем leftover для уведомления.
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
        // Зеркально long: DONE правомерен только если i — самый глубокий залитый
        // sell. Ниже остался исполненный sell (k>i) → орфан, цикл не завершаем.
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
