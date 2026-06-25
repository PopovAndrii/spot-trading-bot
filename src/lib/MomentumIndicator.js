class MomentumIndicator {
  constructor(period = 60, weights = null) {
    this.period = period;
    this.momentum = 0;

    // Default weights or user-provided ones
    this.weights = weights || {
      price: 0.4,
      volume: 0.2,
      trend: 0.3,
      volatility: 0.1,
    };

    // Validate the sum of weights
    const sum = Object.values(this.weights).reduce((a, b) => a + b);
    if (Math.abs(sum - 1.0) > 0.01) {
      console.warn(`⚠️ Sum of weights = ${sum}, recommended = 1.0`);
    }
  }

  calculate(candles) {
    const recent = candles.slice(-this.period);

    if (recent.length < this.period) {
      throw new Error(`Need at least ${this.period} candles`);
    }

    // Components
    const priceScore = this.calculatePriceScore(recent);
    const volumeScore = this.calculateVolumeScore(recent);
    const trendScore = this.calculateTrendScore(recent);
    const volatilityScore = this.calculateVolatilityScore(recent);

    // Weighted combination with the configured weights
    this.momentum = 0;
    this.momentum += priceScore * this.weights.price; // - price
    this.momentum += volumeScore * this.weights.volume; // - volume
    this.momentum += trendScore * this.weights.trend; // - trend
    this.momentum += volatilityScore * this.weights.volatility; // - volatility

    // Normalize via tanh
    this.momentum = Math.tanh(this.momentum * 2);

    return {
      momentum: parseFloat(this.momentum.toFixed(4)),
      components: {
        price: priceScore.toFixed(3),
        volume: volumeScore.toFixed(3),
        trend: trendScore.toFixed(3),
        volatility: volatilityScore.toFixed(3),
      },
      weights: this.weights,
      signal: this.#getSignal(this.momentum),
    };
  }

  /**
   *
   * @param {*} startPrice
   * @param {*} endPrice
   * @param {*} currentPrice
   * @returns -1 to +1
   */
  calculateByPrices(startPrice, endPrice, currentPrice = null) {
    // If the current price isn't passed, use endPrice
    const current = currentPrice !== null ? currentPrice : endPrice;

    // Check that currentPrice is between start and end
    const min = Math.min(startPrice, endPrice);
    const max = Math.max(startPrice, endPrice);

    if (current < min || current > max) {
      console.warn(`⚠️ ${currentPrice} should be between ${startPrice} and ${endPrice}`);
    }

    // Total range
    const totalRange = endPrice - startPrice;

    // Where the current price sits within that range
    const currentPosition = current - startPrice;

    // Progress from 0 to 1 (linear scale)
    let momentum;
    if (totalRange === 0) {
      momentum = 0; // prices are equal
    } else if (totalRange > 0) {
      // Rising: from 0 to +1
      momentum = currentPosition / totalRange;
    } else {
      // Falling: from 0 to -1
      momentum = currentPosition / totalRange;
    }

    return parseFloat(momentum.toFixed(4));
  }

  getMomentum() {
    return parseFloat(this.momentum);
  }

  calculatePriceScore(candles) {
    const startPrice = parseFloat(candles[0][1]);
    const endPrice = parseFloat(candles[candles.length - 1][4]);
    return ((endPrice - startPrice) / startPrice) * 10;
  }

  calculateVolumeScore(candles) {
    const volumes = candles.map((c) => parseFloat(c[5]));
    const avgVolume = volumes.reduce((a, b) => a + b) / volumes.length;

    // Volume of the last 10% of candles
    const recentVolumes = volumes.slice(-Math.floor(volumes.length * 0.1));
    const recentAvg = recentVolumes.reduce((a, b) => a + b) / recentVolumes.length;

    return recentAvg / avgVolume - 1; // Deviation from the mean
  }

  calculateTrendScore(candles) {
    let score = 0;

    for (let i = 0; i < candles.length; i++) {
      const open = parseFloat(candles[i][1]);
      const close = parseFloat(candles[i][4]);
      const weight = (i + 1) / candles.length; // more weight on the latest

      if (close > open) {
        score += weight;
      } else if (close < open) {
        score -= weight;
      }
    }

    return (score / candles.length) * 2;
  }

  calculateVolatilityScore(candles) {
    let totalTR = 0;

    for (let i = 1; i < candles.length; i++) {
      const high = parseFloat(candles[i][2]);
      const low = parseFloat(candles[i][3]);
      const prevClose = parseFloat(candles[i - 1][4]);

      const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
      totalTR += tr;
    }

    const avgTR = totalTR / (candles.length - 1);
    const currentPrice = parseFloat(candles[candles.length - 1][4]);

    return (avgTR / currentPrice) * 10; // normalization
  }

  #getSignal(momentum) {
    const abs = Math.abs(momentum);
    const direction = momentum > 0 ? 'UP' : 'DOWN';

    if (abs > 0.98) return `EXTREME >0.98 ${direction}`;
    if (abs > 0.8) return `VERY STRONG ${direction}`;
    if (abs > 0.5) return `STRONG ${direction}`;
    if (abs > 0.3) return `MODERATE ${direction}`;
    if (abs > 0.1) return `WEAK ${direction}`;
    return 'NEUTRAL';
  }

  /**
   *
   * @param {*} count
   * @param {*} startPrice
   * @param {*} trend 0.01 = +1% grow
   * @returns
   */
  generateTestCandles(count = 100, startPrice = 29000, trend = 0) {
    const candles = [];
    let currentPrice = startPrice;
    let timestamp = Date.now() - count * 60000;

    for (let i = 0; i < count; i++) {
      // If trend is set, add it to the random change
      // trend: 0.005 = +0.5% rise, -0.005 = -0.5% fall, 0 = random
      const randomChange = (Math.random() - 0.5) * 0.01;
      const change = randomChange + trend;
      const volatility = Math.random() * 0.003;

      const open = currentPrice;
      const close = currentPrice * (1 + change);
      const high = Math.max(open, close) * (1 + volatility);
      const low = Math.min(open, close) * (1 - volatility);
      const volume = 100 + Math.random() * 100;

      candles.push([
        timestamp,
        open.toFixed(2),
        high.toFixed(2),
        low.toFixed(2),
        close.toFixed(2),
        volume.toFixed(2),
        timestamp + 59999,
        (volume * currentPrice).toFixed(2),
        Math.floor(800 + Math.random() * 400),
        (volume * 0.5).toFixed(2),
        (volume * currentPrice * 0.5).toFixed(2),
        '0',
      ]);

      currentPrice = close;
      timestamp += 60000;
    }

    return candles;
  }
}

module.exports = { MomentumIndicator };
