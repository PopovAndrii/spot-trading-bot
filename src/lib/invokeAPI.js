const { Spot } = require('@binance/connector');

class InvokeApi {
  constructor(obj = {}) {
    this.client = new Spot(process.env.API_KEY, process.env.API_SECRET);
    this.data = obj.data;
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

  async cancelOpenOrders() {
    try {
      const res = await this.client.cancelOpenOrders(this.data.symbol);

      console.log('✅ cancelOpenOrders():', res.data);

      return res.data;
    } catch (error) {
      if (error.response) {
        console.error('❌ error.response.data cancelOpenOrders():', error.response.data);
      } else {
        console.error('❌ message cancelOpenOrders():', error.message);
      }

      return null;
    }
  }
}

module.exports = { InvokeApi };
