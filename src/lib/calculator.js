// CommonJS, like the rest of the backend (ANALYSIS item 14): this file used to be
// the only ESM module and worked only thanks to require(esm) in Node ≥22.
class Calculator {
  // The grid is built by a factory, not the constructor: `new Calculator()` now
  // returns a normal instance (instanceof works); the entry point is the static
  // build(). Previously the constructor returned an array (return this.factory()),
  // so `new Calculator()` yielded a non-Calculator — a classic antipattern.
  static build(constructorData, strategy = 'long') {
    return new Calculator(constructorData).factory(strategy);
  }

  constructor(constructorData) {
    const params = this.parseNumbers(constructorData);

    // BTCUSDT
    const defaultData = {
      'field-currency': 0.10794235, //368.5,
      'field-deposit': 560, // 1.074 430$
      'field-orderSize': 125, // 0.028
      'field-profit': 0.1,
      'field-commission': 0.20,
      'field-strategyList': '',
      'field-fibonachiStep': 0.2, // fibonachi
      'field-martingail': 49,
      'field-indent': 0.0,
      'field-trackPrice': 0.15, // does not participate in the construction
      'field-activeOrders': 3, // does not participate in the construction
      'field-requestFrequency': 500, // does not participate in the construction
      'field-stepSize': null,
      'field-tickSize': null,
    };
    this.data = Object.assign(defaultData, params);
    // this.data = defaultData;
    // console.log(this.data)
  }

  factory = (strategy) => {
    return strategy == 'long' ? this.long() : this.short();
  };

  parseNumbers = (obj) => {
    return Object.fromEntries(
      Object.entries(obj).map(([key, value]) => [key, isNaN(value) ? value : Number(value)])
    );
  };

  long = () => {
    let mainObj = [];
    let balanceTotal = this.data['field-deposit'];

    let prevStep = 0;
    let currentStep = this.data['field-fibonachiStep'];

    let totalSell = 0.0;
    let spentTotal = 0.0;

    let targetOrderAmount = this.data['field-orderSize'] * this.data['field-currency'];
    const precision = Math.pow(10, this.data['field-stepSize']);

    // first knee price at indent% below current price
    let buyPrice = this.data['field-currency'] * ((100 - this.data['field-indent']) / 100);

    for (let i = 0; i < 100; ++i) {
      if (i > 0) {
        let nextStep;

        if (this.data['strategyList'] === 'fibonacci') {
          nextStep = this.#getNextStepFibonacci(prevStep, currentStep);
        } else {
          nextStep = this.#getNextStepProgressive(prevStep, currentStep);
        }

        prevStep = currentStep;
        currentStep = nextStep;

        // geometric decay: each knee is nextStep% below the previous knee price
        buyPrice = buyPrice * ((100 - nextStep) / 100);
        targetOrderAmount = targetOrderAmount * ((100 + this.data['field-martingail']) / 100);
      }

      const minPrice = Math.pow(0.1, this.data['field-tickSize']);
      if (buyPrice <= minPrice) break;

      const overlapRange = (1 - buyPrice / this.data['field-currency']) * 100;

      let buy = targetOrderAmount / buyPrice;
      buy = Math.floor(buy * precision) / precision;

      if (buy === 0) break;

      let actualSpent = buy * buyPrice;

      if (balanceTotal < actualSpent) break;

      spentTotal += actualSpent;
      totalSell += buy;
      balanceTotal -= actualSpent;

      let sellCurrency = ((spentTotal / totalSell) * (100 + this.data['field-profit'] + this.data['field-commission'])) / 100;

      // Spent in quote currency (money = price × qty); quote precision = price tickSize
      const spentQuote = actualSpent.toFixed(this.data['field-tickSize']);

      mainObj.push({
        overlapRange: overlapRange.toFixed(2),
        buyCurrency: buyPrice.toFixed(this.data['field-tickSize']),
        buy: buy.toFixed(this.data['field-stepSize']),
        totalSell: totalSell.toFixed(this.data['field-stepSize']),
        sellCurrency: sellCurrency.toFixed(this.data['field-tickSize']),
        didBuy: spentQuote,
        calcBalance: balanceTotal.toFixed(this.data['field-tickSize']),
      });
    }
    return mainObj;
  };

  #getNextStepProgressive(prevStep, currentStep) {
    return currentStep + this.data['field-fibonachiStep'];
  }

  #getNextStepFibonacci(prevStep, currentStep) {
    if (prevStep === 0 && currentStep === 0) {
      return 0.1;
    }
    return prevStep + currentStep;
  }

  short = () => {
    const mainObj = [];

    let currentBalance = this.data['field-deposit'];
    const initialDeposit = this.data['field-deposit'];

    let prevStep = 0;
    let currentStep = this.data['field-fibonachiStep'];

    let sellTotalCoins = 0.0;
    let spentTotalMoney = 0.0;

    let currentOrderSell = this.data['field-orderSize'];
    const precision = Math.pow(10, this.data['field-stepSize']);

    // first knee sell price at indent% above current price
    let sellPrice = this.data['field-currency'] * ((100 + this.data['field-indent']) / 100);

    for (let i = 0; i < 100; ++i) {
      if (i > 0) {
        let nextStep;

        if (this.data['strategyList'] === 'fibonacci') {
          nextStep = this.#getNextStepFibonacci(prevStep, currentStep);
        } else {
          nextStep = this.#getNextStepProgressive(prevStep, currentStep);
        }

        prevStep = currentStep;
        currentStep = nextStep;

        // geometric growth: each knee is nextStep% above the previous knee price
        sellPrice = sellPrice * ((100 + nextStep) / 100);
        currentOrderSell = currentOrderSell * ((100 + this.data['field-martingail']) / 100);
        currentOrderSell = Math.floor(currentOrderSell * precision) / precision;
      }

      if (currentOrderSell === 0) break;
      if (currentBalance < currentOrderSell) break;

      currentBalance -= currentOrderSell;
      spentTotalMoney += currentOrderSell;

      const overlapRange = (sellPrice / this.data['field-currency'] - 1) * 100;

      sellTotalCoins += currentOrderSell / sellPrice;

      let buyPrice = ((spentTotalMoney / sellTotalCoins) * (100 - (this.data['field-profit'] + this.data['field-commission']))) / 100;

      // Spent in quote currency (money = qty × price); quote precision = price tickSize
      const spentQuote = (currentOrderSell * sellPrice).toFixed(this.data['field-tickSize']);

      mainObj.push({
        overlapRange: overlapRange.toFixed(2),
        buyCurrency: buyPrice.toFixed(this.data['field-tickSize']),
        buy: (initialDeposit - currentBalance).toFixed(this.data['field-stepSize']),
        totalSell: currentOrderSell.toFixed(this.data['field-stepSize']),
        sellCurrency: sellPrice.toFixed(this.data['field-tickSize']),
        didBuy: spentQuote,
        calcBalance: currentBalance.toFixed(this.data['field-stepSize']),
      });
    }

    return mainObj;
  };
}

module.exports = { Calculator };
