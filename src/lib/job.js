const Status = Object.freeze({
  REDY: 0, // 0 - can deletad. never started
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

class Job {
  constructor(test = false) {
    this.test = test;
  }

  long = (obj, i, el) => {
    if (this.test === true) return { status: 'pass', method: false, side: null, id: i, data: {} };

    if (el.status === state.FILLED && obj['SELL'][i].status === state.CANCELED) {
      return { status: 'pass', method: false, side: null, id: i, data: {} };
    }

    if (el.status === state.FILLED && obj['SELL'][i].status === state.PARTIALLY_FILLED) {
      return {
        status: state.PARTIALLY_FILLED,
        method: 'getOrder',
        side: 'SELL',
        id: i,
        data: {
          symbol: el.symbol,
          orderId: obj['SELL'][i].orderId,
        },
      };
    }

    if (obj['SELL'][i].status !== state.FILLED) {
      switch (el.status) {
        case state.FILLED:
          if (i > 0) {
            if (obj['SELL'][i - 1].status !== state.CANCELED) {
              return {
                status: null,
                method: 'cancelOrder',
                side: 'SELL',
                id: i - 1,
                data: {
                  symbol: el.symbol,
                  orderId: obj['SELL'][i - 1].orderId,
                },
              };
            }
          }

          if (obj['SELL'][i].status === null) {
            return {
              status: null,
              method: 'newOrder',
              side: 'SELL',
              id: i,
              data: {
                symbol: el.symbol,
                side: 'SELL',
                type: 'LIMIT',
                timeInForce: 'GTC',
                quantity: obj['SELL'][i].quantity,
                price: obj['SELL'][i].price,
              },
            };
          } else if (
            obj['SELL'][i].status === state.NEW ||
            obj['SELL'][i].status === state.PARTIALLY_FILLED
          ) {
            return {
              status: state.NEW ? state.NEW : state.PARTIALLY_FILLED,
              method: 'getOrder',
              side: 'SELL',
              id: i,
              data: {
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
            symbol: el.symbol,
            orderId: obj['SELL'][i].orderId,
          },
        };
      }

      if (obj['SELL'][i].status === state.FILLED) {
        return {
          status: 'final',
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

  short = (obj, i, el) => {
    if (this.test === true) return { status: 'pass', method: false, side: null, id: i, data: {} };

    if (el.status === state.FILLED && obj['BUY'][i].status === state.CANCELED) {
      return { status: 'pass', method: false, side: null, id: i, data: {} };
    }

    if (el.status === state.FILLED && obj['BUY'][i].status === state.PARTIALLY_FILLED) {
      return {
        status: state.PARTIALLY_FILLED,
        method: 'getOrder',
        side: 'BUY',
        id: i,
        data: {
          symbol: el.symbol,
          orderId: obj['BUY'][i].orderId,
        },
      };
    }

    if (obj['BUY'][i].status !== state.FILLED) {
      switch (el.status) {
        case state.FILLED:
          if (i > 0) {
            if (obj['BUY'][i - 1].status !== state.CANCELED) {
              return {
                status: null,
                method: 'cancelOrder',
                side: 'BUY',
                id: i - 1,
                data: {
                  symbol: el.symbol,
                  orderId: obj['BUY'][i - 1].orderId,
                },
              };
            }
          }

          if (obj['BUY'][i].status === null) {
            return {
              status: null,
              method: 'newOrder',
              side: 'BUY',
              id: i,
              data: {
                symbol: el.symbol,
                side: 'BUY',
                type: 'LIMIT',
                timeInForce: 'GTC',
                quantity: obj['BUY'][i].quantity,
                price: obj['BUY'][i].price,
              },
            };
          } else if (
            obj['BUY'][i].status === state.NEW ||
            obj['BUY'][i].status === state.PARTIALLY_FILLED
          ) {
            return {
              status: state.NEW ? state.NEW : state.PARTIALLY_FILLED,
              method: 'getOrder',
              side: 'BUY',
              id: i,
              data: {
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
            symbol: el.symbol,
            orderId: obj['BUY'][i].orderId,
          },
        };
      }

      if (obj['BUY'][i].status === state.FILLED) {
        return {
          status: 'final',
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

  longDynamic = (obj, i, el, delta = {}, sailPrice) => {
    if (this.test === true)
      return { status: 'pass', method: false, side: null, id: i, data: delta };

    if (el.status === state.FILLED && obj['SELL'][i].status === state.CANCELED) {
      return { status: 'pass', method: false, side: null, id: i, data: {} };
    }

    // ордер BUY заверщен и ордер SELL частично исполнен
    if (el.status === state.FILLED && obj['SELL'][i].status === state.PARTIALLY_FILLED) {
      return {
        status: state.PARTIALLY_FILLED,
        method: 'getOrder',
        side: 'SELL',
        id: i,
        data: {
          symbol: el.symbol,
          orderId: obj['SELL'][i].orderId,
        },
      };
    }

    const THRESHOLD = { buy: -0.0005, sell: 0.0005 };

    // // сигнал падения for BUY
    // if (delta.ofsetPrice < 0 && delta.ofsetPrice <= THRESHOLD.buy) {
    //   return;
    // }

    // // сигнал роста for SELL
    // if (delta.ofsetPrice > 0 && delta.ofsetPrice >= THRESHOLD.sell) {
    //   return;
    // }

    if (obj['SELL'][i].status !== state.FILLED) {
      switch (el.status) {
        case state.FILLED:
          if (i > 0) {
            if (obj['SELL'][i - 1].status !== state.CANCELED) {
              return {
                status: null,
                method: 'cancelOrder',
                side: 'SELL',
                id: i - 1,
                data: {
                  symbol: el.symbol,
                  orderId: obj['SELL'][i - 1].orderId,
                },
              };
            }
          }

          if (obj['SELL'][i].status === null) {
            if (delta.ofsetPrice > 0 && delta.ofsetPrice >= THRESHOLD.sell) {
              if (delta.streamPrice > sailPrice) {
                return {
                  status: null,
                  method: 'newOrder',
                  side: 'SELL',
                  id: i,
                  data: {
                    symbol: el.symbol,
                    side: 'SELL',
                    type: 'LIMIT',
                    timeInForce: 'GTC',
                    quantity: obj['SELL'][i].quantity,
                    price: obj['SELL'][i].price,
                  },
                };
              } else {
                return { status: 'pass', method: false, side: null, id: i, data: {} };
              }
            } else {
              return { status: 'pass', method: false, side: null, id: i, data: {} };
            }
          } else if (
            obj['SELL'][i].status === state.NEW ||
            obj['SELL'][i].status === state.PARTIALLY_FILLED
          ) {
            return {
              status: state.NEW ? state.NEW : state.PARTIALLY_FILLED,
              method: 'getOrder',
              side: 'SELL',
              id: i,
              data: {
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
              symbol: el.symbol,
              orderId: el.orderId,
            },
          };

        default:
          // First Order
          if (i == 0) {
            return {
              status: null,
              method: 'newOrder',
              side: 'BUY',
              id: i,
              data: {
                symbol: el.symbol,
                side: 'BUY',
                type: 'LIMIT',
                timeInForce: 'GTC',
                quantity: el.quantity,
                price: el.price,
              },
            };
          } else {
            // price drop signal for BUY
            if (delta.ofsetPrice < 0 && delta.ofsetPrice <= THRESHOLD.buy) {
              // взять расчетную цену и текущую и поставить лимитный ордер
              if (delta.streamPrice < el.price) {
                return {
                  status: null,
                  method: 'newOrder',
                  side: 'BUY',
                  id: i,
                  data: {
                    symbol: el.symbol,
                    side: 'BUY',
                    type: 'LIMIT',
                    timeInForce: 'GTC',
                    quantity: el.quantity,
                    price: delta.streamPrice,
                  },
                };
              } else {
                return { status: 'pass', method: false, side: null, id: i, data: {} };
              }
            } else {
              return { status: 'pass', method: false, side: null, id: i, data: {} };
            }
          }
      }
    } else {
      if (obj['SELL'][i].status === state.NEW) {
        return {
          status: state.NEW,
          method: 'getOrder',
          side: 'SELL',
          id: i,
          data: {
            symbol: el.symbol,
            orderId: obj['SELL'][i].orderId,
          },
        };
      }

      if (obj['SELL'][i].status === state.FILLED) {
        return {
          status: 'final',
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

module.exports = { Job, Status };
