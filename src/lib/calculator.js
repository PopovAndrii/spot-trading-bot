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
    let coverage = 0.0;
    let totalSell = 0.0;
    let spentTotal = 0.0;

    // Variable for mathematical (ideal) order volume
    let targetOrderAmount = this.data['field-orderSize'] * this.data['field-currency'];

    // Limit the cycle (eg max 100 knees) to avoid freezing
    for (let i = 0; i < 100; ++i) {
      if (i == 0) {
        overlapRange = this.data['field-indent'];
        coverage = this.data['field-fibonachiStep'];
      } else {
        overlapRange += coverage;
        coverage += this.data['field-fibonachiStep'];

        // Martingale
        targetOrderAmount = targetOrderAmount * ((100 + this.data['field-martingail']) / 100);
      }

      let buyPrice = this.data['field-currency'] * ((100 - overlapRange) / 100);

      // Calculate the number of coins based on the THEORETICAL amount
      let buy = targetOrderAmount / buyPrice;

      // Round off the number of coins (buy) according to the exchange's stepSize
      // Если stepSize — это количество знаков (например, 2), используем toFixed
      if (this.data['field-stepSize'] > 0) {
        const precision = Math.pow(10, this.data['field-stepSize']);
        buy = Math.floor(buy * precision) / precision; // Round down to stay on balance
      } else {
        buy = Math.round(buy);
      }

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

  short = () => {
    const mainObj = [];

    const balanceTotal = this.data['field-deposit'];

    let overlapRange = this.data['field-indent'];

    let sellCurrency = 0.0;

    let buyCurrency = 0.0;

    let coverage = this.data['field-fibonachiStep'];

    let sellTotal = 0.0;

    let spentTotal = 0.0;

    let sell = this.data['field-orderSize'];

    for (let i = 0; this.data['field-deposit'] > this.data['field-orderSize']; ++i) {
      if (i != 0) {
        overlapRange += coverage;
        coverage += this.data['field-fibonachiStep'];

        sell = sell * ((100 + this.data['field-martingail']) / 100);
      }

      this.data['field-deposit'] -= sell;

      if (this.data['field-deposit'] < 0) break;

      spentTotal += sell;

      sellCurrency = this.data['field-currency'] * ((100 + overlapRange) / 100);

      sellTotal += sell / sellCurrency;

      buyCurrency = ((spentTotal / sellTotal) * (100 - (this.data['field-profit'] + 0.2))) / 100;

      const modelDataRow = {
        overlapRange: overlapRange.toFixed(2),
        buyCurrency: buyCurrency.toFixed(this.data['field-tickSize']),
        buy: (balanceTotal - this.data['field-deposit']).toFixed(this.data['field-stepSize']),
        totalSell: sell.toFixed(this.data['field-stepSize']),
        sellCurrency: sellCurrency.toFixed(this.data['field-tickSize']),
        didBuy: sell.toFixed(this.data['field-stepSize']), // information data
        calcBalance: this.data['field-deposit'].toFixed(this.data['field-stepSize']), // information data
        // "balanceTotal": balanceTotal - this.data["balance"] , // information data
      };

      mainObj.push(modelDataRow);
      // m_vec.append(modelDataRow);
    }

    // console.log(mainObj);
    return mainObj;
  };
}
