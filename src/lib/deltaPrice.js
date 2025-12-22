class DeltaPrice {
  constructor(arr = [], test = true) {
    this.data = test == true ? this.#testData() : arr;
  }

  #cleanPrice() {
    return this.data.map((candle) => parseFloat(candle[4]));
  }

  /**
   * Calculates the average price for an array
   * @param {*} prices
   * @returns string
   */
  averagePrice(prices = []) {
    return (prices.reduce((sum, p) => sum + p, 0) / prices.length).toFixed(5);
  }

  /**
   * Calculates the relative magnitude of price increase or decrease depending on time.
   * Range -1 to 1   (0.01, -0.90)
   * @param {[]} prices
   * @returns string
   */
  ofsetPrice(prices = []) {
    const startPrice = prices[0];
    const endPrice = prices[prices.length - 1];

    return ((endPrice - startPrice) / startPrice).toFixed(5);
  }

  calculate(streamPrice) {
    const prices = this.#cleanPrice();

    const averagePrice = this.averagePrice(prices);

    const ofsetPrice = ofsetPrice(prices);

    // parseFloat() for Int
    return {
      streamPrice: parseFloat(streamPrice),
      averagePrice: parseFloat(averagePrice),
      ofsetPrice: parseFloat(ofsetPrice),
    };
  }

  #testData() {
    return [
      [
        1499040000000, // Open time
        '0.01634790', // Open price
        '0.80000000', // High price
        '0.01575800', // Low price
        '0.01577100', // Close price (last trade price)
        '148976.10000000', // Volume (base asset, например BNB)
        1499644799999, // Close time
        '2434.19055334', // Quote asset volume (например USDT)
        308, // Number of trades
        '1756.87000000', // Taker buy base asset volume
        '28.46690465', // Taker buy quote asset volume
        '1204.81339232', // Ignore (это поле всегда будет равно 0 для klines)
      ],
      [
        1499040000000, // Open time
        '0.01634790', // Open price
        '0.80000000', // High price
        '0.01575900', // Low price
        '0.01577100', // Close price (last trade price)
        '148976.10000000', // Volume (base asset, например BNB)
        1499644799999, // Close time
        '2434.19055334', // Quote asset volume (например USDT)
        308, // Number of trades
        '1756.87000000', // Taker buy base asset volume
        '28.46690465', // Taker buy quote asset volume
        '1204.81339232', // Ignore (это поле всегда будет равно 0 для klines)
      ],
      [
        1499040000000, // Open time
        '0.01634790', // Open price
        '0.80000000', // High price
        '0.01576000', // Low price
        '0.01577100', // Close price (last trade price)
        '148976.10000000', // Volume (base asset, например BNB)
        1499644799999, // Close time
        '2434.19055334', // Quote asset volume (например USDT)
        308, // Number of trades
        '1756.87000000', // Taker buy base asset volume
        '28.46690465', // Taker buy quote asset volume
        '1204.81339232', // Ignore (это поле всегда будет равно 0 для klines)
      ],
    ];
  }
}

module.exports = { DeltaPrice };
