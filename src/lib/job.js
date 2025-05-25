const Status = Object.freeze({ 
    REDY: 0, // 0 - can deletad. never started
    STARTED: 1, // 1 - in process. some order done
    STOPPED: 2, // 2 - 
    DONE: 3 // 3 - not done(error etc)
  });

const orderState = Object.freeze({ 
    NEW: "NEW", // Ордер создан, но ещё не исполнен
    CANCELED: "CANCELED", // Ордер был отменён пользователем до исполнения
    PARTIALLY_FILLED: "PARTIALLY_FILLED", // Ордер частично исполнен, но ещё не завершён полностью.
    FILLED: "FILLED", // Ордер полностью исполнен
    PENDING_CANCEL: "PENDING_CANCEL", // Идёт процесс отмены ордера (редко используется)
    REJECTED: "REJECTED", // Ордер был отклонён системой Binance (например, из-за ошибок)
    EXPIRED: "EXPIRED",	// Ордер истёк по времени (например, LIMIT GTC может быть отменён по тайм-ауту или из-за сетевых сбоев)
  });

class Job {
    constructor(test = false){
        this.test = test;
    }

    long = (model, i, el) => {
        let data = {};

        if (this.test === true) return {"status": "pass", "method": false, "side": null, "data": {}, "id": i };

        if (el.status === orderState.FILLED && model['SELL'][i].status === orderState.CANCELED) {
            // уже отмененный ордер. цена пошла вниз. Запрос API не нужен
            return { "status": "pass", "method": false, "side": null, "data": {}, "id": i };
        };

        if (el.status === orderState.FILLED && model['SELL'][i].status === orderState.PARTIALLY_FILLED) {
            return { // продан частично. нужен статус ибо может быть уже отработан. ждать пока исполнится
                "status": orderState.PARTIALLY_FILLED, 
                "method": "getOrder", 
                "side": "SELL", 
                "id": i, 
                "data": {
                    "symbol": el.symbol,
                    "orderId": model['SELL'][i].orderId
                }, 
            };
        };

        if (model['SELL'][i].status !== orderState.FILLED) {

            switch(el.status) {
            case orderState.FILLED: // исполненный
                // "отменить" если есть предидущий ордер продажи. Освободить валюту на продажу.
                if (i > 0) {
                    if ((model['SELL'][i - 1].status !== orderState.CANCELED) 
                        // || (model['BUY'][i - 1].status === orderState.FILLED && model['SELL'][i - 1].status !== null) 
                        // || (model['BUY'][i - 1].status === orderState.FILLED && model['SELL'][i - 1].status !== orderState.PARTIALLY_FILLED) 
                        // && (model['BUY'][i - 1].status === orderState.FILLED && model['SELL'][i].status !== orderState.NEW)
                    ) {
                        return { // отмена предыдущего ордера CANCELED
                            "status": null, 
                            "method": "cancelOrder", 
                            "side": "SELL", 
                            "id": i - 1, 
                            "data": {
                                "symbol": el.symbol,
                                "orderId": model['SELL'][i - 1].orderId,
                            }, 
                        };
                    }
                }

                if (model['SELL'][i].status === null) {
                    return {  // placing an order SELL. This order is final
                        "status": null, 
                        "method": "newOrder", 
                        "side": "SELL", 
                        "id": i, 
                        "data": {
                            "symbol": el.symbol,
                            "side": "SELL",
                            "type" : "LIMIT",
                            "timeInForce": "GTC",
                            "quantity": model['SELL'][i].quantity, 
                            "price": model['SELL'][i].price
                        }, 
                    };
                } else if ((model['SELL'][i].status === orderState.NEW) 
                    || (model['SELL'][i].status === orderState.PARTIALLY_FILLED)) {
                    return { 
                        "status": (orderState.NEW) ? orderState.NEW : orderState.PARTIALLY_FILLED, 
                        "method": "getOrder", 
                        "side": "SELL", 
                        "id": i,
                        "data": {
                            "symbol": el.symbol,
                            "orderId": model['SELL'][i].orderId
                        }, 
                    };
                }

                return { "status": "pass", "method": false, "side": null, "data": {}, "id": i };

            case orderState.NEW: // installed
                return { // check status and update satus
                    "status": orderState.NEW, 
                    "method": "getOrder", 
                    "side": "BUY", 
                    "id": i, 
                    "data": {
                        "symbol": el.symbol,
                        "orderId": el.orderId
                    }, 
                };

            case orderState.PARTIALLY_FILLED: // order placed, partially executed
                return {  // check status and update satus
                    "status": orderState.PARTIALLY_FILLED, 
                    "method": "getOrder", 
                    "side": "BUY", 
                    "id": i,
                    "data": { 
                        "symbol": el.symbol,
                        "orderId": el.orderId
                    }, 
                };

            default:
                return { // установка ордера BUY. Пустой статус
                    "status": null, 
                    "method": "newOrder", 
                    "side": "BUY", 
                    "id": i,
                    "data": {
                        "symbol": el.symbol,
                        "side": "BUY",
                        "type" : "LIMIT",
                        "timeInForce": "GTC",
                        "quantity": el.quantity,
                        "price": el.price
                    }, 
                };
            }

        } else {
            if (model['SELL'][i].status === orderState.NEW) {
                return { // проверка на продажу. этот ордер должен исполнится и конец цикла
                    "status": orderState.NEW, 
                    "method": "getOrder", 
                    "side": "SELL", 
                    "id": i,
                    "data": {
                        "symbol": el.symbol,
                        "orderId": model['SELL'][i].orderId
                    }, 
                };
            }

            if (model['SELL'][i].status === orderState.FILLED) {
                return { // FILLED cycle completed. Cancelling all orders
                    "status": "final", 
                    "method": "cancelOpenOrders", 
                    "side": null, 
                    "id": i, 
                    "data": { 
                        "symbol": el.symbol 
                    } 
                };
            }
        }
    }

    short = (model, i, el) => {
        let data = {};

        if (this.test === true) return {"status": "pass", "method": false, "side": null, "data": data, "id": i };

        if (el.status === "FILLED" && model['BUY'][i].status === "CANCELED") {
            return { "status": "pass", "method": false, "side": null, "data": data, "id": i };
        };

        if (el.status === "FILLED" && model['BUY'][i].status === "PARTIALLY_FILLED") {
            data = {
                "symbol": el.symbol,
                "orderId": model['BUY'][i].orderId
            }
            // проверка на статус. и обновление статуса
            return { "status": "PARTIALLY_FILLED", "method": "getOrder", "side": "BUY", "data": data, "id": i };
        };

        if (model['BUY'][i].status !== "FILLED") {

            switch(el.status){
            case "FILLED": // исполненный
                // "отменить" если есть предидущий ордер продажи. Освободить валюту на продажу.
                if (i > 0) {
                    if (model['SELL'][i - 1].status === "FILLED" && model['BUY'][i - 1].status !== "CANCELED"){
                        data = {
                            "symbol": el.symbol,
                            "orderId": model['BUY'][i - 1].orderId,
                        } // отмена предNдущего ордера CANCELED
                        return { "status": null, "method": "cancelOrder", "side": "BUY", "data": data, "id": i - 1 };
                    }
                }

                if (model['BUY'][i].status === null) {
                    // установка ордера BUY
                    data = {
                        "symbol": el.symbol,
                        "side": "BUY",
                        "type" : "LIMIT",
                        "timeInForce": "GTC",
                        "quantity": model['BUY'][i].quantity, 
                        "price": model['BUY'][i].price
                    }
                    return { "status": null, "method": "newOrder", "side": "BUY", "data": data, "id": i };

                } else if (model['BUY'][i].status === "NEW") {
                    data = {
                        "symbol": el.symbol,
                        "orderId": model['BUY'][i].orderId
                    }
                    return { "status": "NEW", "method": "getOrder", "side": "BUY", "data": data, "id": i };
                }

            case "NEW": // ордер установлен, в очереди
                data = {
                    "symbol": el.symbol,
                    "orderId": el.orderId
                } // проверка на статус. и обновление статуса
                return { "status": "NEW", "method": "getOrder", "side": "SELL", "data": data, "id": i };

            case "PARTIALLY_FILLED": // ордер установлен, исполнен частично
                data = {
                    "symbol": el.symbol,
                    "orderId": el.orderId
                } // проверка на статус. и обновление статуса
                return { "status": "PARTIALLY_FILLED", "method": "getOrder", "side": "SELL", "data": data, "id": i };

            default:
                data = {
                    "symbol": el.symbol,
                    "side": "SELL",
                    "type" : "LIMIT",
                    "timeInForce": "GTC",
                    "quantity": el.quantity, // купить колличество
                    "price": el.price // купить по курсу
                }
                // установка ордера BUY. Пустой статус
                return { "status": null, "method": "newOrder", "side": "SELL", "data": data, "id": i };
            }

        } else {
            if (model['BUY'][i].status === "NEW") {
                data = {
                    "symbol": el.symbol,
                    "orderId": model['BUY'][i].orderId
                }
                // проверка на продажу.
                return { "status": "NEW", "method": "getOrder", "side": "BUY", "data": data, "id": i };
            }

            if (model['BUY'][i].status === "FILLED") {
                // FILLED цикл закончен
                data = { "symbol": el.symbol }
                // отмена всех ордеров
                return { "status": "final", "method": null, "side": null, "data": data, "id": i };
            }
        }
    }

    decimalCount = (e, s = '.') => {
        var str = parseFloat(e).toString().split(s)[1] || ''
        return str.length
    }
    
    stepCount = (e) => {
        const str = parseFloat(e).toString();
    
        if (str.includes('.'))
            return str.split('.')[1].length;
    
        return 0;
        //  return str.split('.')[0];
    }
    
}

module.exports = {Job, Status};