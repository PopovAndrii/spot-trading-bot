const { MomentumIndicator } = require('./MomentumIndicator');

class DynamicMartingail {
  constructor(conf = {}, insufficient = false) {
    this.orderCnt = 1;
    this.coverage = 0;
    this.overlapRange = 0;

    // Price next order
    this.priceNextOrder = 0;

    // Next order quantity
    this.quantityNextOrder = 0;

    // Total Quantity
    this.totalQuantity = 0;

    // Total costs
    this.totalSpent = 0;

    // The price of the last executed order
    this.lastExecutedPrice = 0;

    const defaultConf = {
      profit: 0, // %
      martingaleStep: 0, // %
      fibonachi: 0, // step between orders %
      tickSize: 0,
      stepSize: 0,
      quantity: 0,
      price: 0,
      balance: 0,
    };

    this.conf = Object.assign(defaultConf, conf);

    this.insufficient = null;
    if (insufficient === true) {
      this.#checkOrderBalance();
    }

    this.orderData = null;
  }

  /**
   * Checking the balance for an order that is outside the calculated range.
   * Show how much funds need to be added before the next order.
   *
   * @returns {object}
   */
  getOrderInsufficient() {
    return this.insufficient;
  }

  /**
   * Return current order data
   *
   * @returns {object}
   */
  getOrderData() {
    if (!this.orderData || this.orderCnt === 1) {
      const spent = this.conf.price * this.conf.quantity;
      const free = this.conf.balance - spent;
      const priceSell = this.conf.price * (1 + this.conf.profit / 100);

      return {
        n: 1,
        overlap: Number(this.overlapRange.toFixed(2)),
        priceBuy: Number(this.conf.price),
        quantity: Number(this.conf.quantity),
        quantitySell: Number(this.conf.quantity),
        priceSell: Number(priceSell.toFixed(conf.stepSize)),
        spent: Number(spent.toFixed(conf.stepSize)),
        free: Number(free.toFixed(conf.stepSize)),
      };
    }

    return this.orderData;
  }

  /**
   * Adds details of a new order for execution
   *
   * @param {number} price Order price
   * @param {number} quantity Volume order
   */
  addExecutedOrder(price) {
    // first order. Number n: 0
    if (this.orderCnt == 1) {
      this.priceNextOrder = this.conf.quantity;
      this.totalQuantity = this.conf.quantity;
      this.spent = this.conf.price * this.conf.quantity;
      this.lastExecutedPrice = this.conf.price;
    } else {
      this.spent = price * this.quantityNextOrder;
    }

    this.totalSpent += this.spent;

    this.lastExecutedPrice = price;
    this.orderCnt += 1;
  }

  /**
   * Calculates the current average price and target selling price (Take Profit).
   *
   * @returns {object}
   */
  calculateTakeProfit() {
    if (this.totalQuantity === 0) {
      return null;
    }

    // Average price = Total cost / Total quantity of asset
    const averagePrice = this.totalSpent / this.totalQuantity;

    const free = this.conf.balance - this.totalQuantity * this.orderData.priceSell;
    const balance = this.orderData.quantitySell * this.orderData.priceSell + free;
    const profit = this.orderData.quantitySell * this.orderData.priceSell - this.totalSpent;

    return {
      orderNumber: this.orderCnt - 1, // - 1 @FIX
      averagePrice: Number(averagePrice.toFixed(conf.tickSize)),
      price: Number(this.orderData.priceSell.toFixed(conf.tickSize)),
      quantity: Number(this.orderData.quantitySell.toFixed(conf.stepSize)),
      totalSpent: Number(this.totalSpent.toFixed(conf.tickSize)),
      bidAmount: Number(this.orderData.quantitySell * this.orderData.priceSell).toFixed(
        conf.tickSize
      ),
      free: Number(free.toFixed(conf.tickSize)),
      balance: Number(balance.toFixed(conf.tickSize)),
      profit: Number(profit.toFixed(conf.tickSize)),
    };
  }

  /**
   * Calculates RECOMMENDED parameters for the next order.
   * Empty price for first order
   *
   * @param {*} price the next order is calculated from this price
   * @returns {object}
   */
  calculateCurrentOrderParams(lastExecutedPrice = null) {
    if (lastExecutedPrice === null) {
      // then this is 1 order
      return this.getOrderData();
    }

    this.coverage += this.conf.fibonachi;
    this.overlapRange += this.coverage;

    this.priceNextOrder = lastExecutedPrice * (1 - this.coverage / 100);

    this.quantityNextOrder =
      (this.spent / this.priceNextOrder) * (1 + this.conf.martingaleStep / 100);

    this.totalQuantity += this.quantityNextOrder;

    // console.log(lastExecutedPrice)
    const priceSell = lastExecutedPrice * (1 + this.conf.profit / 100);
    const spent = this.priceNextOrder * this.quantityNextOrder;
    const free = this.conf.balance - this.totalQuantity * priceSell;

    this.orderData = {
      n: this.orderCnt,
      overlap: Number(this.overlapRange.toFixed(2)),
      priceBuy: Number(this.priceNextOrder.toFixed(this.conf.tickSize)),
      quantityBuy: Number(this.quantityNextOrder.toFixed(this.conf.stepSize)),
      quantitySell: Number(this.totalQuantity.toFixed(this.conf.stepSize)),
      priceSell: Number(priceSell.toFixed(this.conf.tickSize)),
      spent: Number(spent.toFixed(this.conf.tickSize)),
      free: Number(free.toFixed(this.conf.stepSize)),
    };

    return this.orderData;
  }

  /**
   * Checking the balance for an order that is outside the calculated range.
   * Show how much funds need to be added before the next order.
   * @returns {object}
   */
  #checkOrderBalance() {
    const result = { orderNumber: null, insufficient: null };

    // if you declare the checkOrderBalance() method twice+
    if (this.insufficient) return null;

    this.addExecutedOrder(this.conf.price);

    let balance = this.conf.balance;

    let next = { price: this.conf.price, quantity: this.conf.quantity };

    while (balance >= 0) {
      next = this.calculateCurrentOrderParams(this.conf.price);

      balance = this.conf.balance - this.totalSpent;

      if (balance < 0) {
        result.orderNumber = this.orderCnt - 1;
        result.insufficient = balance.toFixed(this.conf.tickSize);

        break;
      }

      this.addExecutedOrder(next.priceBuy);
    }

    this.insufficient = result;

    // Next order quantity
    this.orderCnt = 1;
    this.coverage = 0;
    this.overlapRange = 0;
    this.priceNextOrder = 0;
    this.quantityNextOrder = 0;
    this.totalQuantity = 0;
    this.totalSpent = 0;
    this.lastExecutedPrice = 0;
  }
}

let conf = {
  profit: 0.7,
  martingaleStep: 69, // %
  fibonachi: 0.7,
  tickSize: 2,
  stepSize: 3,
  quantity: 0.019,
  price: 688.43,
  balance: 430.83,
};

let next = null;
// cycle initialization
const DM = new DynamicMartingail(conf, true);
console.log(DM.getOrderInsufficient());

// order 0. if it isn't placed, place it
next = DM.calculateCurrentOrderParams();

console.log(`🟢 ${JSON.stringify(next)}\n`);
DM.addExecutedOrder(conf.price); // or next.price after first order

// if order 0 is filled — get its price from the file or config, since it's the start price
next = DM.calculateCurrentOrderParams(conf.price);
console.log(`🟢 ${JSON.stringify(next)}\n`);
// if not filled, break the cycle and listen
DM.addExecutedOrder(next.priceBuy);

// if order 1 is filled — get the saved order-1 price from the file
next = DM.calculateCurrentOrderParams(next.priceBuy - 0.5);
console.log(`🟢 ${JSON.stringify(next)}\n`);
DM.addExecutedOrder(next.priceBuy);

// if order 2 is filled — get the saved order-2 price from the file
next = DM.calculateCurrentOrderParams(next.priceBuy);
console.log(`🟢 ${JSON.stringify(next)}\n`);
DM.addExecutedOrder(next.priceBuy);

next = DM.calculateCurrentOrderParams(next.priceBuy);
// const nextPrice = next.priceBuy - 25;
console.log(`🟢 ${JSON.stringify(next)}\n`);
DM.addExecutedOrder(next.priceBuy);

next = DM.calculateCurrentOrderParams(next.priceBuy);
console.log(`🟢 ${JSON.stringify(next)}\n`);
DM.addExecutedOrder(next.priceBuy);

const targets = DM.calculateTakeProfit();

console.log(`   -------------------------------------`);
console.log(`📈 ${JSON.stringify(targets)}`);

console.log(`\n|======================================|`);
console.log(`|= Balance: ${targets.balance} ====================|`);
console.log(`|= Balance envolved: ${targets.bidAmount} ==========|`);
console.log(`|= Balance free: ${targets.free} =================|`);
console.log(`|= Profit: ${targets.profit} =======================|`);
console.log(`|= Last Bid (q-ty:${targets.quantity} price:${targets.price}) ===|`);
console.log(`|=================end==================|`);

const MI = new MomentumIndicator(60, {
  price: 0.8,
  volume: 0.1,
  trend: 0.05,
  volatility: 0.05,
});

const candles = MI.generateTestCandles(100, 29000, -0.000005);

console.log(MI.calculate(candles));
