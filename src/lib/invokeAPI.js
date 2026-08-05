const { Spot } = require('@binance/connector');
const { UserStreamAPI } = require('../lib/UserStreamApi');
const { StreamAPI } = require('../lib/streamAPI');
const { isTestnet } = require('./runMode');
const logBus = require('./logBus');

class InvokeApi {
  static #instance = null;

  // symbol → { price, qty } decimal counts (from field-tickSize/field-stepSize),
  // registered by the running cycle; used only to format log output.
  #logDecimals = new Map();

  // Single entry point for the client: a singleton without the "constructor
  // returns a different instance" antipattern. Previously `new InvokeApi()`
  // returned an already-existing object — instanceof survived it, but the
  // behavior was non-obvious. Now the constructor always builds a new object,
  // and the shared client is obtained via getInstance() (all callers switched).
  static getInstance() {
    if (!InvokeApi.#instance) InvokeApi.#instance = new InvokeApi();
    return InvokeApi.#instance;
  }

  constructor() {
    // isTestnet() already accounts for a safe fallback (real without keys → testnet).
    const testnet = isTestnet();

    const api_key = testnet ? process.env.API_KEY_TEST : process.env.API_KEY;
    const api_secret = testnet ? process.env.API_SECRET_TEST : process.env.API_SECRET;
    const baseURL = testnet ? 'https://testnet.binance.vision/' : 'https://api.binance.com';

    // Testnet streams live on port 443 (wss://stream.testnet.binance.vision/ws);
    // :9443 is a mainnet-only port — with it the testnet user stream never
    // connected, so executionReport (fill push) silently never arrived.
    this.wssUserURL = testnet
      ? 'wss://stream.testnet.binance.vision/ws/'
      : 'wss://stream.binance.com:9443/ws/';

    // Do not throw an exception so the container does not crash: public endpoints (symbols, prices)
    // work without keys, and signed ones will return an error via the methods' try/catch blocks.
    this.configured = Boolean(api_key && api_secret);
    if (!this.configured) {
      console.warn(
        `🟡 Binance ${testnet ? 'testnet' : 'real'} keys are not set — signed requests will fail, public ones work`
      );
    }

    this.client = new Spot(api_key || '', api_secret || '', { baseURL: baseURL });
  }

  /**
   * Retry a request on rate-limit: 429 → wait Retry-After (or a
   * growing default) and try again, up to 3 retries. 418 (IP ban) is NOT retried —
   * hammering with a banned IP would only extend the ban; the error propagates to
   * the calling method's try/catch as usual.
   */
  async #withRateLimitRetry(fn) {
    const MAX_RETRIES = 3;
    for (let attempt = 0; ; attempt++) {
      try {
        return await fn();
      } catch (err) {
        const status = err.response?.status;
        if (status !== 429 || attempt >= MAX_RETRIES) throw err;

        const retryAfter = Number(err.response?.headers?.['retry-after']);
        const delay =
          Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2000 * (attempt + 1);

        this.getConsoleMsg(
          `429 rate limit — retry in ${delay / 1000}s (${attempt + 1}/${MAX_RETRIES})`,
          false
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  getConsoleMsg(err, status = true) {
    if (!err) return;

    const icon = status ? '✅' : '❌';

    // local time to web terminal ([HH:MM:SS] in ConsoleLog).
    const msg = `${icon} ${err}`;
    console.log(msg);
    logBus.log(msg);
  }

  getPublicStream(symbol) {
    if (!symbol) return false;
    return StreamAPI.getInstance(symbol);
  }

  getUserStream(wssUserURL = null) {
    const url = wssUserURL ? wssUserURL : this.wssUserURL;
    return UserStreamAPI.getInstance(this.client, url);
  }

  getClientKey() {
    return this.client;
  }

  setLogDecimals(symbol, { price, qty } = {}) {
    this.#logDecimals.set(symbol, {
      price: Number.isInteger(price) && price >= 0 ? price : null,
      qty: Number.isInteger(qty) && qty >= 0 ? qty : null,
    });
  }

  // "553.58000000" -> "553.58" using the pair's decimals ("1.00000000" -> "1.00"
  // when tickSize is 2); falls back to trailing-zero trim when decimals are unknown.
  #fmtNum(symbol, value, kind) {
    const dec = this.#logDecimals.get(symbol)?.[kind];
    const n = Number(value);
    if (dec != null && Number.isFinite(n)) return n.toFixed(dec);
    return String(value)
      .replace(/(\.\d*?)0+$/, '$1')
      .replace(/\.$/, '');
  }

  async newOrder(data) {
    try {
      const res = await this.#withRateLimitRetry(() =>
        this.client.newOrder(data.symbol, data.side, data.type, {
          price: data.price,
          quantity: data.quantity,
          timeInForce: data.timeInForce,
        })
      );

      const msg = [
        res.data.symbol,
        res.data.status,
        res.data.side,
        this.#fmtNum(res.data.symbol, res.data.price, 'price'),
        this.#fmtNum(res.data.symbol, res.data.origQty, 'qty'),
      ];

      this.getConsoleMsg(`newOrder(${data.id}) ${msg.join(' | ')}`);
      return { success: true, message: res.data };
    } catch (err) {
      const message = this.#getCatchMsg(err);

      this.getConsoleMsg(message, false);
      return { success: false, message };
    }
  }

  async getOrder(data) {
    try {
      const res = await this.#withRateLimitRetry(() =>
        this.client.getOrder(data.symbol, {
          orderId: data.orderId,
        })
      );

      const msg = [
        data.orderId,
        res.data.symbol,
        res.data.status,
        res.data.side,
        this.#fmtNum(res.data.symbol, res.data.price, 'price'),
        this.#fmtNum(res.data.symbol, res.data.origQty, 'qty'),
      ];

      this.getConsoleMsg(`getOrder(${data.id}) ${msg.join(' | ')}`);
      return { success: true, message: res.data };
    } catch (err) {
      const message = this.#getCatchMsg(err);

      this.getConsoleMsg(message, false);
      return { success: false, message };
    }
  }

  async cancelOrder(data) {
    try {
      const res = await this.#withRateLimitRetry(() =>
        this.client.cancelOrder(data.symbol, {
          orderId: data.orderId,
        })
      );

      const msg = [
        data.orderId,
        res.data.symbol,
        res.data.status,
        res.data.side,
        this.#fmtNum(res.data.symbol, res.data.price, 'price'),
        this.#fmtNum(res.data.symbol, res.data.origQty, 'qty'),
      ];

      this.getConsoleMsg(`cancelOrder() ${msg.join(' | ')}`);
      return { success: true, message: res.data };
    } catch (err) {
      const message = this.#getCatchMsg(err);

      this.getConsoleMsg(message, false);

      // -2011 "Unknown order sent": this order is not open — it filled between two
      // polls, or the user pulled it by hand. Nothing was canceled, so it is not a
      // success; but retrying can never succeed either, and a caller that blindly
      // retries deadlocks. `gone` says WHICH failure it is, so the caller can go ask
      // the exchange what really happened instead of re-cancelling a phantom.
      if (err.response?.data?.code === -2011) {
        return { success: false, gone: true, message };
      }

      return { success: false, message };
    }
  }

  // Atomic move of a resting order to a new price/quantity: cancel + place in one
  // exchange call. STOP_ON_FAILURE means the new order is placed ONLY if the cancel
  // succeeds, and the filters are evaluated BEFORE the cancel — so the outcome is
  // all-or-nothing: either the order moves, or nothing changes and the old one stays
  // resting. A cancel that cancelled nothing (order filled/pulled between poll and
  // move) throws, handled below → caller re-polls next pass. On HTTP 200 both legs
  // succeeded; the order the caller must now track is newOrderResponse.
  async cancelReplace(data) {
    try {
      const res = await this.#withRateLimitRetry(() =>
        this.client.cancelAndReplace(data.symbol, data.side, data.type, 'STOP_ON_FAILURE', {
          cancelOrderId: data.orderId,
          price: data.price,
          quantity: data.quantity,
          timeInForce: data.timeInForce,
        })
      );

      const placed = res.data.newOrderResponse;

      const msg = [
        placed.orderId,
        placed.symbol,
        placed.status,
        placed.side,
        this.#fmtNum(placed.symbol, placed.price, 'price'),
        this.#fmtNum(placed.symbol, placed.origQty, 'qty'),
      ];

      this.getConsoleMsg(`cancelReplace(${data.id}) ${msg.join(' | ')}`);
      return { success: true, message: placed };
    } catch (err) {
      const message = this.#getCatchMsg(err);

      this.getConsoleMsg(message, false);
      return { success: false, message };
    }
  }

  async openOrders(data) {
    try {
      // REST openOrders(options) expects an OBJECT; a string symbol was ignored
      // and the request went without symbol → it returned open orders for the
      // WHOLE account (not just this pair). Because of that count lied, and the
      // pre-delete check for a series falsely saw "foreign" orders.
      const res = await this.#withRateLimitRetry(() =>
        this.client.openOrders({ symbol: data.symbol })
      );

      const msg = { count: res.data.length };

      this.getConsoleMsg(`openOrders(${data.symbol}) ${msg.count} active orders`);
      return { success: true, message: Number(msg.count) };
    } catch (err) {
      const message = this.#getCatchMsg(err);

      this.getConsoleMsg(message, false);
      return { success: false, message };
    }
  }

  async cancelOpenOrders(data) {
    const resultOpenOrders = await this.openOrders(data);

    if (resultOpenOrders.message === 0) {
      return { success: true, message: resultOpenOrders.message };
    }

    try {
      const res = await this.#withRateLimitRetry(() => this.client.cancelOpenOrders(data.symbol));

      if (res.data?.code < 0) {
        this.getConsoleMsg(res.data.msg, false);
        return { success: false, message: res.data.msg };
      }

      this.getConsoleMsg(`cancelOpenOrders() ${data.symbol}`);
      return { success: true, message: res.data.length };
    } catch (err) {
      // -2011 "Unknown order sent": nothing to cancel on the exchange (orders
      // already filled/pulled, or a race with openOrders). For "cancel all" this
      // isn't an error but an idempotent no-op → success (0 canceled), so the
      // caller can normally release the recovery lock and drop the pair from the menu.
      if (err.response?.data?.code === -2011) {
        return { success: true, message: 0 };
      }

      const message = this.#getCatchMsg(err);

      this.getConsoleMsg(message, false);
      return { success: false, message };
    }
  }

  async getAccount() {
    try {
      const res = await this.#withRateLimitRetry(() =>
        this.client.account({ omitZeroBalances: true })
      );

      if (res.data?.code < 0) {
        this.getConsoleMsg(res.data.msg, false);
        return { success: false, message: res.data.msg };
      }

      this.getConsoleMsg('getAccount()');
      return { success: true, message: res.data };
    } catch (err) {
      const message = this.#getCatchMsg(err);

      this.getConsoleMsg(message, false);
      return { success: false, message };
    }
  }

  async exchangeInfo(data) {
    try {
      const res = await this.#withRateLimitRetry(() => this.client.exchangeInfo(data));

      if (res.data?.code < 0) {
        this.getConsoleMsg(res.data.msg, false);
        return { success: false, message: res.data.msg };
      }

      this.getConsoleMsg(`exchangeInfo(${data.symbol})`);
      return { success: true, message: res.data };
    } catch (err) {
      const message = this.#getCatchMsg(err);

      this.getConsoleMsg(message, false);
      return { success: false, message, unavailable: this.#isUnavailable(err) };
    }
  }

  async tickerPrice(data = {}) {
    try {
      const res = await this.#withRateLimitRetry(() => this.client.tickerPrice(data.symbol));

      if (res.data?.code < 0) {
        this.getConsoleMsg(res.data.msg, false);
        return { success: false, message: res.data.msg };
      }

      this.getConsoleMsg('tickerPrice()');
      return { success: true, message: res.data };
    } catch (err) {
      const message = this.#getCatchMsg(err);

      this.getConsoleMsg(message, false);
      return { success: false, message };
    }
  }

  async bookTicker(data = {}) {
    try {
      // if data.symbol empty, Binance return arr for all pairs
      const res = await this.#withRateLimitRetry(() => this.client.bookTicker(data.symbol || ''));

      // Check for an error in the response (if the API returned an error structure)
      if (res.data?.code < 0) {
        this.getConsoleMsg(res.data.msg, false);
        return { success: false, message: res.data.msg };
      }

      this.getConsoleMsg('bookTicker()');

      // return { success: true, message :
      //  {
      //    "symbol": "BTCUSDT",
      //    "bidPrice": "63450.00000000",
      //    "bidQty": "0.54210000",
      //    "askPrice": "63450.01000000",
      //    "askQty": "1.12540000"
      //  }
      // }
      return { success: true, message: res.data };
    } catch (err) {
      const message = this.#getCatchMsg(err);

      this.getConsoleMsg(message, false);
      return { success: false, message };
    }
  }

  async getSpotSymbols() {
    try {
      const res = await this.#withRateLimitRetry(() => this.client.exchangeInfo());

      if (res.data?.code < 0) {
        this.getConsoleMsg(res.data.msg, false);
        return { success: false, message: res.data.msg };
      }

      if (!res.data?.symbols || !Array.isArray(res.data.symbols)) {
        console.warn('No symbols array in exchangeInfo response');
        return { success: true, message: { symbols: [] } };
      }

      const symbols = res.data.symbols
        .filter((s) => s.status === 'TRADING' && /^[A-Z0-9]+$/.test(s.symbol))
        .map((s) => ({ symbol: s.symbol, baseAsset: s.baseAsset, quoteAsset: s.quoteAsset }));

      this.getConsoleMsg(`getSpotSymbols() ${symbols.length} symbols`);
      return { success: true, message: { symbols } };
    } catch (err) {
      const message = this.#getCatchMsg(err);
      this.getConsoleMsg(message, false);
      return { success: false, message };
    }
  }

  #getCatchMsg(err) {
    const data = err.response?.data;

    return [err.message, data?.code, data?.msg || data?.message].filter(Boolean).join(' | ');
  }

  // A rejected request comes back from Binance as a parsed JSON body {code, msg}.
  // Anything else — no response (DNS failure, connection refused, our own
  // timeout), or a gateway/maintenance page (502/503, HTML, plain text) —
  // means the exchange itself is unreachable, not that the request was
  // rejected. The two must read differently to whoever sees the message.
  #isUnavailable(err) {
    const data = err.response?.data;
    return !data || typeof data !== 'object' || data.code === undefined;
  }
}

module.exports = { InvokeApi };
