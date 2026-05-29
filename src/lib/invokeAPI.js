const { Spot } = require('@binance/connector');
const { UserStreamAPI } = require('../lib/UserStreamApi');
const { StreamAPI } = require('../lib/streamAPI');
const logBus = require('./logBus');

class InvokeApi {
  static instance = null;

  constructor() {
    if (InvokeApi.instance) {
      // console.log('❕ InvokeApi already exists, returning it ❕');
      return InvokeApi.instance;
    }

    let api_key = process.env.API_KEY;
    let api_secret = process.env.API_SECRET;
    let baseURL = 'https://api.binance.com';

    this.wssUserURL = 'wss://stream.binance.com:9443/ws/';

    if (!api_key || !api_secret) {
      throw new Error('Binance API keys are not set');
    }

    if (process.env.NODE_ENV == 'development') {
      api_key = process.env.API_KEY_TEST;
      api_secret = process.env.API_SECRET_TEST;
      baseURL = 'https://testnet.binance.vision/';

      this.wssUserURL = 'wss://stream.testnet.binance.vision:9443/ws/';
    }

    this.client = new Spot(api_key, api_secret, { baseURL: baseURL });
    this.data = null;
    this.stateErrors = true;

    InvokeApi.instance = this;
  }

  setData(obj = {}) {
    this.data = obj;
  }

  getConsoleMsg(err, status = true) {
    if (!err || !this.stateErrors) return;

    const icon = status ? '✅' : '❌';

    const d = new Date()
    const parts = d.toUTCString().split(' ');
    const formatted = `${parts[0].replace(',', '')} ${parts[2]} ${parts[1]} ${parts[4]}`;

    const msg = `${formatted} ${icon} ${err}`;
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

      const res = await this.client.newOrder(data.symbol, data.side, data.type, {
        price: data.price,
        quantity: data.quantity,
        timeInForce: data.timeInForce,
      });

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
  // @TODO not used!
  async newMarketOrder(data) {
    try {
      const res = await this.client.newOrder(data.symbol, data.side, data.type, {
        quantity: data.quantity,
      });

      console.log('✅ newMarketOrder():', [
        res.data.symbol,
        res.data.status,
        res.data.side,
        res.data.origQty,
        res.data.executedQty,
      ]);

      return res.data;
    } catch (error) {
      if (error.response) {
        console.error('❌ error.response.data newMarketOrder():', error.response.data);
      } else {
        console.error('❌ message newMarketOrder():', error.message);
      }
      return null;
    }
  }
  // @TODO not used!
  async getHistory(data) {
    try {
      const res = await this.client.klines(data.symbol, data.interval || '5s', {
        limit: data.limit || 60,
      });

      // const res = await this.client.klines({
      //   symbol: this.data.symbol,
      //   interval: this.data.interval || '5s',
      //   limit: this.data.limit || 60,
      // });

      // console.log('✅ getHistory():', candles, 'candles');

      return res.data;
    } catch (error) {
      if (error.response) {
        console.error('❌ error.response.data getHistory():', error.response.data);
      } else {
        console.error('❌ message getHistory():', error.message);
      }
      return null;
    }
  }

  async getOrder(data) {
    try {
      const res = await this.client.getOrder(data.symbol, {
        orderId: data.orderId,
      });

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
      const res = await this.client.cancelOrder(data.symbol, {
        orderId: data.orderId,
      });

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

  // @TODO not used!
  async openOrders(data) {
    try {
      const res = await this.client.openOrders(data.symbol);

      const msg = { count: res.data.length };

      this.getConsoleMsg(`openOrders() ${msg.count} active orders`);
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
      const res = await this.client.cancelOpenOrders(data.symbol);

      if (res.data?.code < 0) {
        this.getConsoleMsg(res.data.msg, false);
        return { success: false, message: res.data.msg };
      }

      this.getConsoleMsg(`cancelOpenOrders() ${data.symbol}`);
      return { success: true, message: res.data.length };
    } catch (err) {
      const message = this.#getCatchMsg(err);

      this.getConsoleMsg(message, false);
      return { success: false, message };
    }
  }

  async getAccount() {
    try {
      const res = await this.client.account({ omitZeroBalances: true });

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
      const res = await this.client.exchangeInfo(data);

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
      const res = await this.client.tickerPrice(data.symbol);

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
      const res = await this.client.bookTicker(data.symbol || '');

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
