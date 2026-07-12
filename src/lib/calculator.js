// CommonJS, like the rest of the backend: this file used to be
// the only ESM module and worked only thanks to require(esm) in Node ≥22.
const Decimal = require('decimal.js');

// Hybrid grid micro take-profit price: an entry price marked up (long close =
// SELL) or down (short close = BUY) by microProfit + commission. Single source of
// truth — used by the Calculator rows (for display) and by the Job at placement
// time (from the real fill). entryPrice is a number/string; returns a tick-rounded
// string.
function microClosePrice(entryPrice, microProfit, commission, tick, strategy) {
  const total = new Decimal(microProfit).plus(commission);
  const factor =
    strategy === 'short' ? new Decimal(100).minus(total) : new Decimal(100).plus(total);
  return new Decimal(entryPrice).times(factor).div(100).toFixed(tick);
}

// Hybrid v2 exit threshold T_F: where the frontier rung stops micro-recycling and
// the whole position is closed with ONE averaged order. Interpolates between the
// two neighboring averaged-close prices — S_{F-1} (position without the frontier
// rung) and S_F (position including it): T = S_{F-1} + pct/100 × (S_F − S_{F-1}).
// pct comes from field-gridExit; 50 (the default) is the midpoint from the spec,
// 0 sticks to S_{F-1}, 100 to S_F. Pure interpolation — direction-agnostic, so
// long (S_F below S_{F-1}) and short (mirrored) use the same formula. Invalid pct
// falls back to 50. Returns a number (comparison only — no tick rounding here).
function gridExitThreshold(sPrev, sF, pct) {
  // pct == null / '' guarded explicitly: Number(null) and Number('') are 0
  // (finite), which would silently turn a missing field — or an old config
  // restored into an empty SpinBox — into "exit at S_{F-1}" instead of the default.
  const p = pct == null || pct === '' ? NaN : Number(pct);
  const share = new Decimal(Number.isFinite(p) ? p : 50).div(100);
  const prev = new Decimal(sPrev);
  return prev.plus(new Decimal(sF).minus(prev).times(share)).toNumber();
}

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
      'field-currency': 0.10794235, // 368.5,
      'field-deposit': 560, // 1.074 430$
      'field-orderSize': 125, // 0.028
      'field-profit': 0.1,
      'field-commission': 0.2,
      'field-strategyList': '',
      'field-fibonachiStep': 0.2, // fibonachi
      'field-martingail': 49,
      'field-indent': 0.0,
      // Hybrid DCA/GRID: when 'on', each rung also gets its OWN micro take-profit
      // (own entry price marked up by microProfit + commission) so a grid leg can
      // bank an oscillation independently of the DCA averaged close. Off = the
      // classic single-averaged-close behavior, output byte-for-byte unchanged.
      'field-hybrid': 'off',
      'field-microProfit': 0.1, // % net profit for a grid micro-order (on top of commission)
      'field-gridExit': 50, // % between S_{F-1} and S_F where grid mode yields to the exit close
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

  // Hybrid enabled? Turns on the per-rung micro take-profit field. Accepts 'on',
  // boolean true, or 1 — parseNumbers() coerces a boolean true to 1, so we match
  // that too. Kept intentionally lax so a stray value never crashes the grid.
  #hybridOn() {
    const h = this.data['field-hybrid'];
    return h === 'on' || h === true || h === 1;
  }

  long = () => {
    const mainObj = [];
    const step = this.data['field-stepSize'];
    const tick = this.data['field-tickSize'];
    const currency = new Decimal(this.data['field-currency']);
    const hybrid = this.#hybridOn();
    const microProfit = new Decimal(this.data['field-microProfit'] ?? 0);
    const commission = new Decimal(this.data['field-commission']);

    let balanceTotal = new Decimal(this.data['field-deposit']);

    let prevStep = 0;
    let currentStep = this.data['field-fibonachiStep'];

    let totalSell = new Decimal(0);
    let spentTotal = new Decimal(0);

    let targetOrderAmount = new Decimal(this.data['field-orderSize']).times(currency);

    // first knee price at indent% below current price
    let buyPrice = currency.times(new Decimal(100).minus(this.data['field-indent'])).div(100);

    const minPrice = new Decimal('0.1').pow(tick);

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
        buyPrice = buyPrice.times(new Decimal(100).minus(nextStep)).div(100);
        targetOrderAmount = targetOrderAmount
          .times(new Decimal(100).plus(this.data['field-martingail']))
          .div(100);
      }

      if (buyPrice.lte(minPrice)) break;

      const overlapRange = new Decimal(1).minus(buyPrice.div(currency)).times(100);

      // floor the base quantity to stepSize decimals (never buy more than a step allows)
      const buy = targetOrderAmount.div(buyPrice).toDecimalPlaces(step, Decimal.ROUND_DOWN);

      if (buy.isZero()) break;

      const actualSpent = buy.times(buyPrice);

      if (balanceTotal.lt(actualSpent)) break;

      spentTotal = spentTotal.plus(actualSpent);
      totalSell = totalSell.plus(buy);
      balanceTotal = balanceTotal.minus(actualSpent);

      const sellCurrency = spentTotal
        .div(totalSell)
        .times(new Decimal(100).plus(this.data['field-profit']).plus(this.data['field-commission']))
        .div(100);

      // Spent in quote currency (money = price × qty); quote precision = price tickSize
      const spentQuote = actualSpent.toFixed(tick);

      // The actual placed entry price (rounded to tick) — the exchange fills the
      // BUY here, so the micro take-profit must be measured from this, not the
      // full-precision internal value, or the banked profit drifts by a rounding tick.
      const entryPrice = buyPrice.toFixed(tick);

      const row = {
        overlapRange: overlapRange.toFixed(2),
        buyCurrency: entryPrice,
        buy: buy.toFixed(step),
        totalSell: totalSell.toFixed(step),
        sellCurrency: sellCurrency.toFixed(tick),
        didBuy: spentQuote,
        calcBalance: balanceTotal.toFixed(tick),
      };

      if (hybrid) {
        // Grid micro take-profit for THIS rung: its own entry price marked up by
        // microProfit + commission. The DCA path ignores it; job's hybrid path uses
        // it for rungs at/below the activation level, so each leg banks its own bounce.
        row.microSellCurrency = microClosePrice(entryPrice, microProfit, commission, tick, 'long');
      }

      mainObj.push(row);
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
    const step = this.data['field-stepSize'];
    const tick = this.data['field-tickSize'];
    const currency = new Decimal(this.data['field-currency']);
    const hybrid = this.#hybridOn();
    const microProfit = new Decimal(this.data['field-microProfit'] ?? 0);
    const commission = new Decimal(this.data['field-commission']);

    let currentBalance = new Decimal(this.data['field-deposit']);
    const initialDeposit = new Decimal(this.data['field-deposit']);

    let prevStep = 0;
    let currentStep = this.data['field-fibonachiStep'];

    let sellTotalCoins = new Decimal(0);
    let spentTotalMoney = new Decimal(0);

    let currentOrderSell = new Decimal(this.data['field-orderSize']);

    // first knee sell price at indent% above current price
    let sellPrice = currency.times(new Decimal(100).plus(this.data['field-indent'])).div(100);

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
        sellPrice = sellPrice.times(new Decimal(100).plus(nextStep)).div(100);
        currentOrderSell = currentOrderSell
          .times(new Decimal(100).plus(this.data['field-martingail']))
          .div(100)
          .toDecimalPlaces(step, Decimal.ROUND_DOWN);
      }

      if (currentOrderSell.isZero()) break;
      if (currentBalance.lt(currentOrderSell)) break;

      currentBalance = currentBalance.minus(currentOrderSell);
      spentTotalMoney = spentTotalMoney.plus(currentOrderSell);

      const overlapRange = sellPrice.div(currency).minus(1).times(100);

      sellTotalCoins = sellTotalCoins.plus(currentOrderSell.div(sellPrice));

      const buyPrice = spentTotalMoney
        .div(sellTotalCoins)
        .times(
          new Decimal(100).minus(
            new Decimal(this.data['field-profit']).plus(this.data['field-commission'])
          )
        )
        .div(100);

      // Spent in quote currency (money = qty × price); quote precision = price tickSize
      const spentQuote = currentOrderSell.times(sellPrice).toFixed(tick);

      // The actual placed entry price (rounded to tick) — the exchange fills the
      // SELL here, so measure the micro buy-back from this rounded value.
      const entryPrice = sellPrice.toFixed(tick);

      const row = {
        overlapRange: overlapRange.toFixed(2),
        buyCurrency: buyPrice.toFixed(tick),
        buy: initialDeposit.minus(currentBalance).toFixed(step),
        totalSell: currentOrderSell.toFixed(step),
        sellCurrency: entryPrice,
        didBuy: spentQuote,
        calcBalance: currentBalance.toFixed(step),
      };

      if (hybrid) {
        // Mirror of long: grid micro take-profit is a BUY-back at THIS rung's own
        // sell entry price marked down by microProfit + commission.
        row.microBuyCurrency = microClosePrice(entryPrice, microProfit, commission, tick, 'short');
      }

      mainObj.push(row);
    }

    return mainObj;
  };
}

module.exports = { Calculator, microClosePrice, gridExitThreshold };
