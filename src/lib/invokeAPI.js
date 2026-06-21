const { Spot } = require('@binance/connector');
const { UserStreamAPI } = require('../lib/UserStreamApi');
const { StreamAPI } = require('../lib/streamAPI');
const { isTestnet } = require('./runMode');
const logBus = require('./logBus');

class InvokeApi {
  static instance = null;

  constructor() {
    if (InvokeApi.instance) {
      // console.log('❕ InvokeApi already exists, returning it ❕');
      return InvokeApi.instance;
    }

    // isTestnet() already accounts for a safe fallback (real without keys → testnet).
    const testnet = isTestnet();

    const api_key = testnet ? process.env.API_KEY_TEST : process.env.API_KEY;
    const api_secret = testnet ? process.env.API_SECRET_TEST : process.env.API_SECRET;
    const baseURL = testnet ? 'https://testnet.binance.vision/' : 'https://api.binance.com';

    this.wssUserURL = testnet
      ? 'wss://stream.testnet.binance.vision:9443/ws/'
      : 'wss://stream.binance.com:9443/ws/';

    // Do not throw an exception so the container does not crash: public endpoints (symbols, prices)
    // work without keys, and signed ones will return an error via the methods' try/catch blocks.
    this.configured = Boolean(api_key && api_secret);
    if (!this.configured) {
      console.warn(`🟡 Binance ${testnet ? 'testnet' : 'real'} keys are not set — signed requests will fail, public ones work`);
    }

    this.client = new Spot(api_key || '', api_secret || '', { baseURL: baseURL });

    InvokeApi.instance = this;
  }

  /**
   * Повтор запроса при rate-limit (ANALYSIS п.2): 429 → ждём Retry-After
   * (или растущий дефолт) и пробуем снова, максимум 3 ретрая. 418 (бан IP)
   * НЕ ретраим — продолжать долбить забаненным IP только продлит бан;
   * ошибка уйдёт в try/catch вызвавшего метода как обычно.
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
          Number.isFinite(retryAfter) && retryAfter > 0
            ? retryAfter * 1000
            : 2000 * (attempt + 1);

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

    // local time to web terminal ([HH:MM:SS] в ConsoleLog).
    const msg = `${icon} ${err}`;
    console.log(msg);
    logBus.log(msg);
  }

  getPublicStream(symbol) {
    if (!symbol) return false;
    return new StreamAPI(symbol);
  }

  getUserStream(wssUserURL = null) {
    const url = wssUserURL ? wssUserURL : this.wssUserURL;
    return new UserStreamAPI(this.client, url);
  }

  getClientKey() {
    return this.client;
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
        res.data.price,
        res.data.origQty,
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
        res.data.price,
        res.data.origQty,
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
        res.data.price,
        res.data.origQty,
      ];

      this.getConsoleMsg(`cancelOrder() ${msg.join(' | ')}`);
      return { success: true, message: res.data };
    } catch (err) {
      const message = this.#getCatchMsg(err);

      this.getConsoleMsg(message, false);
      return { success: false, message };
    }
  }

  async openOrders(data) {
    try {
      // REST openOrders(options) ждёт ОБЪЕКТ; строка-symbol игнорировалась и
      // запрос уходил без symbol → возвращались открытые ордера ВСЕГО аккаунта
      // (а не только этой пары). Из-за этого count врал, а проверка перед
      // удалением серии ложно видела «чужие» ордера.
      const res = await this.#withRateLimitRetry(() => this.client.openOrders({ symbol: data.symbol }));

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
      const res = await this.#withRateLimitRetry(() =>
        this.client.cancelOpenOrders(data.symbol)
      );

      if (res.data?.code < 0) {
        this.getConsoleMsg(res.data.msg, false);
        return { success: false, message: res.data.msg };
      }

      this.getConsoleMsg(`cancelOpenOrders() ${data.symbol}`);
      return { success: true, message: res.data.length };
    } catch (err) {
      // -2011 "Unknown order sent": на бирже нечего отменять (ордера уже
      // исполнены/сняты, либо гонка с openOrders). Для "отменить все" это не
      // ошибка, а идемпотентный no-op → success (0 отменено), чтобы вызывающий
      // мог штатно снять recovery-лок и убрать пару из меню.
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
      return { success: false, message };
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

      // Проверка на ошибку в ответе (если API вернуло структуру с ошибкой)
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
        .filter(s => s.status === 'TRADING' && /^[A-Z0-9]+$/.test(s.symbol))
        .map(s => ({ symbol: s.symbol, baseAsset: s.baseAsset, quoteAsset: s.quoteAsset }));

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

    return [
      err.message,
      data?.code,
      data?.msg || data?.message
    ].filter(Boolean).join(' | ');
  }
}

module.exports = { InvokeApi };
