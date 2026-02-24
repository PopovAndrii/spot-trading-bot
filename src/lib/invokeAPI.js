const { Spot } = require('@binance/connector');
const { UserStreamAPI } = require('../lib/UserStreamApi');
const { StreamAPI } = require('../lib/streamAPI');

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

  getConsoleMsg(err) {
    if (!err || !this.stateErrors) return;

    const d = new Date()
    const parts = d.toUTCString().split(' ');
    const formatted = `${parts[0].replace(',', '')} ${parts[2]} ${parts[1]} ${parts[4]}`;

    return console.log(`${formatted} ${err}`);
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

  async openOrders() {
    try {
      const res = await this.client.openOrders(this.data.symbol);

      console.log('✅ newOrder():');

      return res.data;
    } catch (error) {
      if (error.response) {
        console.error('❌ error.response.data newOrder():', error.response.data);
      } else {
        console.error('❌ message newOrder():', error.message);
      }

      return null;
    }
  }

  async newOrder() {
    try {

      const res = await this.client.newOrder(this.data.symbol, this.data.side, this.data.type, {
        price: this.data.price,
        quantity: this.data.quantity,
        timeInForce: this.data.timeInForce,
      });

      console.log('✅ newOrder():', [
        res.data.symbol,
        res.data.status,
        res.data.side,
        res.data.price,
        res.data.origQty,
      ]);

      return res.data;
    } catch (error) {
      if (error.response) {
        console.error('❌ error.response.data newOrder():', error.response.data);
      } else {
        console.error('❌ message newOrder():', error.message);
      }

      return null;
    }
  }

  async newMarketOrder() {
    try {
      const res = await this.client.newOrder(this.data.symbol, this.data.side, this.data.type, {
        quantity: this.data.quantity,
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

  async getHistory() {
    try {
      const res = await this.client.klines(this.data.symbol, this.data.interval || '5s', {
        limit: this.data.limit || 60,
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

  async getOrder() {
    try {
      const res = await this.client.getOrder(this.data.symbol, {
        orderId: this.data.orderId,
      });

      console.log('✅ getOrder():', [
        res.data.symbol,
        res.data.status,
        res.data.side,
        res.data.price,
        res.data.origQty,
      ]);

      return res.data;
    } catch (error) {
      if (error.response) {
        console.error('❌ error.response.data getOrder():', error.response.data);
      } else {
        console.error('❌ message getOrder():', error.message);
      }

      return null;
    }
  }

  async cancelOrder() {
    try {
      const res = await this.client.cancelOrder(this.data.symbol, {
        orderId: this.data.orderId,
      });

      console.log('✅ cancelOrder():', res.data);

      return res.data;
    } catch (error) {
      if (error.response) {
        console.error('❌ error.response.data cancelOrder():', error.response.data);
      } else {
        console.error('❌ message cancelOrder():', error.message);
      }

      return null;
    }
  }

  async cancelOpenOrders(symbol = '') {
    try {
      const res = await this.client.cancelOpenOrders(symbol);

      if (res.data?.code < 0) {
        this.getConsoleMsg(res.data.msg);
        return { success: false, message: res.data.msg };
      }

      this.getConsoleMsg(`✅ cancelOpenOrders(${symbol})`);
      return { success: true, message: res.data };
    } catch (err) {
      const data = err.response?.data;
      const message = [
        err.message,
        data?.code,
        data?.msg || data?.message
      ].filter(Boolean).join(' | ');

      this.getConsoleMsg(message);
      return { success: false, message };
    }
  }

  async getAccount() {
    try {
      const res = await this.client.account({ omitZeroBalances: true });

      if (res.data?.code < 0) {
        this.getConsoleMsg(res.data.msg);
        return { success: false, message: res.data.msg };
      }

      this.getConsoleMsg('✅ getAccount()');
      return { success: true, message: res.data };
    } catch (err) {
      const data = err.response?.data;
      const message = [
        err.message,
        data?.code,
        data?.msg || data?.message
      ].filter(Boolean).join(' | ');

      this.getConsoleMsg(message);
      return { success: false, message };
    }
  }
}

module.exports = { InvokeApi };
