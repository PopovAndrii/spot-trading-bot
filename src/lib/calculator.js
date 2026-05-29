export class Calculator {
  constructor(constructorData, strategy = 'long') {
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

    return this.factory(strategy);
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
    let overlapRange = 0.0;

    let prevStep = 0;
    let currentStep = this.data['field-fibonachiStep'];

    let totalSell = 0.0;
    let spentTotal = 0.0;

    // Variable for mathematical (ideal) order volume
    let targetOrderAmount = this.data['field-orderSize'] * this.data['field-currency'];

    // Limit the cycle (eg max 100 knees) to avoid freezing
    for (let i = 0; i < 100; ++i) {
      if (i === 0) {
        overlapRange = this.data['field-indent'];
      } else {
        let nextStep;

        if (this.data['strategyList'] === 'fibonacci') {
          nextStep = this.#getNextStepFibonacci(prevStep, currentStep);
        } else {
          nextStep = this.#getNextStepProgressive(prevStep, currentStep);
        }

        overlapRange += nextStep;

        // Updated the status of the steps for the next iteration
        prevStep = currentStep;
        currentStep = nextStep;

        targetOrderAmount = targetOrderAmount * ((100 + this.data['field-martingail']) / 100);
      }

      let buyPrice = this.data['field-currency'] * ((100 - overlapRange) / 100);
      if (buyPrice <= 0) break;

      let buy = targetOrderAmount / buyPrice;
      const precision = Math.pow(10, this.data['field-stepSize']);
      buy = Math.floor(buy * precision) / precision; // Round down to stay on balance

      // Actual funds spent (may differ from targetOrderAmount)
      let actualSpent = buy * buyPrice;

      // Check: is the remaining deposit sufficient for this particular order?
      if (balanceTotal < actualSpent) break;

      spentTotal += actualSpent;
      totalSell += buy;
      balanceTotal -= actualSpent;

      // Calculating the selling price taking into account profit and commission (0.2%)
      let sellCurrency = ((spentTotal / totalSell) * (100 + this.data['field-profit'] + this.data['field-commission'])) / 100;

      mainObj.push({
        overlapRange: overlapRange.toFixed(2),
        buyCurrency: buyPrice.toFixed(this.data['field-tickSize']),
        buy: buy.toFixed(this.data['field-stepSize']),
        totalSell: totalSell.toFixed(this.data['field-stepSize']),
        sellCurrency: sellCurrency.toFixed(this.data['field-tickSize']),
        didBuy: actualSpent.toFixed(2),
        calcBalance: balanceTotal.toFixed(2),
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

    let overlapRange = 0.0;
    let prevStep = 0;
    let currentStep = this.data['field-fibonachiStep'];

    let sellTotalCoins = 0.0;
    let spentTotalMoney = 0.0;

    let currentOrderSell = this.data['field-orderSize'];

    for (let i = 0; currentBalance >= currentOrderSell; ++i) {
      if (i === 0) {
        overlapRange = this.data['field-indent'];
      } else {
        let nextStep;

        if (this.data['strategyList'] === 'fibonacci') {
          nextStep = this.#getNextStepFibonacci(prevStep, currentStep);
        } else {
          nextStep = this.#getNextStepProgressive(prevStep, currentStep);
        }

        overlapRange += nextStep;
        prevStep = currentStep;
        currentStep = nextStep;

        currentOrderSell = currentOrderSell * ((100 + this.data['field-martingail']) / 100);
      }

      // Checking for remaining coins
      if (currentBalance < currentOrderSell) break;

      currentBalance -= currentOrderSell;

      spentTotalMoney += currentOrderSell;

      let sellPrice = this.data['field-currency'] * ((100 + overlapRange) / 100);

      sellTotalCoins += currentOrderSell / sellPrice;

      let buyPrice = ((spentTotalMoney / sellTotalCoins) * (100 - (this.data['field-profit'] + this.data['field-commission']))) / 100;

      const spentSELL = (currentOrderSell * sellPrice).toFixed(2);
      const spentBUY = currentOrderSell.toFixed(this.data['field-stepSize'])

      const modelDataRow = {
        overlapRange: overlapRange.toFixed(2),
        buyCurrency: buyPrice.toFixed(this.data['field-tickSize']),
        buy: (initialDeposit - currentBalance).toFixed(this.data['field-stepSize']),
        totalSell: currentOrderSell.toFixed(this.data['field-stepSize']),
        sellCurrency: sellPrice.toFixed(this.data['field-tickSize']),
        didBuy: `${spentBUY} | ${spentSELL}`,
        calcBalance: currentBalance.toFixed(this.data['field-stepSize']),
      };

      mainObj.push(modelDataRow);

      if (i >= 99) break;
    }

    return mainObj;
  };
}
