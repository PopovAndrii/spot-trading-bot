const EventEmitter = require('events');
const fs = require('fs/promises');
const path = require('path');
const { Job, Status } = require('../lib/job');
const { InvokeApi } = require('../lib/invokeAPI');
const { StreamAPI } = require('../lib/streamAPI');
// const { UserStreamAPI } = require('../lib/UserStreamApi');

const activeSymbols = new Set();

class JsonTimerSender extends EventEmitter {
  constructor(wss, strategy = null) {
    super();
    this.wss = wss;
    this.timer = null;
    this.symbol = null;
    this.strategy = strategy;
    this.running = [];
    this.exchangeName = 'binance';

    this.API = new InvokeApi();
    this.job = new Job(process.env.STATUS_APP ? false : true); // Test === true
  }

  getSpotStatus(symbol) {
    return this.running[symbol];
  }

  async #runToApi(data = {}) {
    if (typeof data.method !== 'string') {
      console.error('Method not specified or has invalid format');
      return null;
    }

    if (typeof this.API[data.method] === 'function') {
      const result = await this.API[data.method](data.data);
      return result;
    }

    console.error(`Method [${data.method}] does not exist`);
    return null;
  }

  #strategy() {
    if (this.strategy === 'short') {
      return { method: 'short', side: 'SELL' };
    }

    if (this.strategy === 'long') {
      return { method: 'long', side: 'BUY' };
    }

    return null;
  }

  /**
   * Iterates through the entire table of placed orders.
   * @param {Object} obj - Configuration of order data from file or database.
   * @returns {Stop()} - Stop the cycle.
   */
  async #jobItaretor(obj = {}) {
    const strategy = this.#strategy();

    if (obj.status == Status.REDY && strategy != null) {
      // never started 0
      for (const [key, val] of obj[strategy.side].entries()) {
        let currentOrder = this.job[strategy.method](obj, key, val); // strategy.

        if (currentOrder.status === Status.DONE) {
          const result = await this.#runToApi(currentOrder);

          // this.#applyStatusesToOrders(obj['BUY'], result);
          // this.#applyStatusesToOrders(obj['SELL'], result);

          obj['status'] = Status.DONE;
          obj['date_modified'] = new Date().toISOString();

          // final write
          await fs.writeFile(this.#filePath(`${Date.now()}-`), JSON.stringify(obj, null, 2));

          await this.stop(); // new cycle here
          return;
        }

        if (currentOrder.status === 'pass') {
          console.log(currentOrder);
          await this.#sleep(100);
          continue;
        } // processed order (api request not needed) or test loop

        const result = await this.#runToApi(currentOrder);

        if (result === null || result.success === false) {
          continue;
        }

        if (result.message.status === currentOrder.status) {
          // ["PARTIALLY_FILLED"] or ["NEW"]
          await this.#sleep(100);
          continue; /** no need to write to file */
        }

        const toObj = {
          status: result.message.status,
          orderId: result.message.orderId,
        };

        // result.message.side == "SELL" or "BUY"
        // currentOrder['id'] !== [key] !!!
        Object.assign(obj[result.message.side][currentOrder['id']], toObj);

        await fs.writeFile(this.#filePath(), JSON.stringify(obj, null, 2));

        await this.#sleep(500);
      }
    }
  }

  #applyStatusesToOrders(orders, statuses) {
    orders.forEach((order) => {
      const match = statuses.find((status) => status.orderId === order.orderId);
      if (match) {
        order.status = match.status;
      }
    });
  }

  async readLoop() {
    if (!this.running[this.symbol]) return;

    try {
      const content = await fs.readFile(this.#filePath(), 'utf8');
      const data = JSON.parse(content);

      this.#jobItaretor(data);

      this.interval = data['BUY'].length * data['param']['field-requestFrequency'];

      // needs for update teble on UI
      const message = JSON.stringify({ type: 'data', data });

      this.wss.clients.forEach((client) => {
        if (client.readyState === 1) {
          client.send(message);
        }
      });
    } catch (err) {
      console.error(this.#filePath(), 'Error reading file:', err);
    }

    this.timer = setTimeout(() => this.readLoop(), this.interval);
  }

  async start(symbol, strategy) {
    if (!this.running[symbol]) {
      // this.strategy from file settings(back) or strategy from click on button (front)
      this.strategy = this.strategy ? this.strategy : strategy;

      const api = new InvokeApi();

      // const userStream = api.getUserStream();
      // userStream.start();
      // userStream.on('executionReport', (order) => {
      //   console.log(`Execute order Stream`);
      // });
      // userStream.on('balance', (data) => {
      //   console.log(`Balance Stream`);
      // });

      const streamAPI = api.getPublicStream(symbol);
      streamAPI.start();
      streamAPI.on('message', (data) => {
        this.emit('price', data);
      });

      this.running[symbol] = true;

      this.symbol = symbol;

      this.readLoop();

      console.log('🟢 Button Start:', symbol, this.strategy);
    }
  }

  #filePath(timestamp = '') {
    return path.join(__dirname, '../data', `${timestamp}${this.symbol}-${this.exchangeName}.json`);
  }

  async stop(symbol) {
    clearTimeout(this.timer);

    // UserStreamAPI.removeInstance();
    StreamAPI.removeInstance(symbol);

    this.timer = null;
    this.running[symbol] = false;

    console.log('🛑 Button Stop:', symbol);
  }

  #sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

module.exports = JsonTimerSender;
