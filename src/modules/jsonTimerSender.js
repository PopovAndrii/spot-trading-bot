const EventEmitter = require('events');
const fs = require('fs/promises');
const path = require('path');
const { Job, Status } = require('../lib/job');
const { InvokeApi } = require('../lib/invokeAPI');
const { StreamAPI } = require('../lib/streamAPI');
const { DeltaPrice } = require('../lib/deltaPrice');
const { MartingaleCalculator } = require('../lib/martingaleCalculator');

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

    this.job = new Job(process.env.STATUS_APP ? true : false); // Test === true
  }

  getSpotStatus(symbol) {
    return this.running[symbol];
  }

  async #runToApi(data = {}) {
    if (typeof data.method !== 'string') {
      console.error('Method not specified or has invalid format');
      return null;
    }

    const apiMethod = new InvokeApi(data);

    if (typeof apiMethod[data.method] === 'function') {
      try {
        const result = await apiMethod[data.method]();
        return result;
      } catch (err) {
        console.error('Call error API:', err);
        return null;
      }
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

    if (this.strategy === 'longDynamic') {
      return { method: 'longDynamic', side: 'BUY' };
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

        if (currentOrder.status === 'final') {
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
          await this.#sleep(200);
          continue;
        } // processed order (api request not needed) or test loop

        const resAPI = await this.#runToApi(currentOrder);

        if (resAPI === null) {
          console.error('Incorrect method');
          continue;
        }

        if (resAPI.status === currentOrder.status) {
          // ["PARTIALLY_FILLED"] or ["NEW"]
          await this.#sleep(200);
          continue; /** no need to write to file */
        }

        const toObj = {
          status: resAPI.status,
          orderId: resAPI.orderId,
        };

        // resAPI.side == "SELL" or "BUY"
        // currentOrder['id'] !== [key] !!!
        Object.assign(obj[resAPI.side][currentOrder['id']], toObj);

        await fs.writeFile(this.#filePath(), JSON.stringify(obj, null, 2));

        await this.#sleep(1000);
      }
    }
  }

  async #dynamicJobIterator(obj = {}, streamPrice) {
    const strategy = this.#strategy();

    if (obj.status == Status.REDY && strategy != null) {
      const history = await this.#runToApi({
        method: 'getHistory',
        symbol: obj.pair,
        interval: '1s',
        limit: '30',
      });
      const deltaPrice = new DeltaPrice(history, false);
      const delta = deltaPrice.calculate(streamPrice);

      const martingaleCalculator = new MartingaleCalculator(obj);
      const avgPrice = martingaleCalculator.calculateAverageEntryPrice();
      const sailPrice = martingaleCalculator.calculateTargetSalePrice(avgPrice);

      for (const [key, val] of obj[strategy.side].entries()) {
        let currentOrder = this.job[strategy.method](obj, key, val, delta, sailPrice);

        if (currentOrder.status === 'final') {
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
          continue;
        } // processed order (api request not needed) or test loop

        const resAPI = await this.#runToApi(currentOrder);

        if (resAPI === null) {
          console.error('Incorrect method');
          continue;
        }

        if (resAPI.status === currentOrder.status) {
          // ["PARTIALLY_FILLED"] or ["NEW"]
          await this.#sleep(200);
          continue; /** no need to write to file */
        }

        const toObj = {
          status: resAPI.status,
          orderId: resAPI.orderId,
        };

        // resAPI.side == "SELL" or "BUY"
        // currentOrder['id'] !== [key] !!!
        Object.assign(obj[resAPI.side][currentOrder['id']], toObj);

        await fs.writeFile(this.#filePath(), JSON.stringify(obj, null, 2));

        await this.#sleep(1000);
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

  async #readLoopDynamic(streamPrice) {
    if (!this.running[this.symbol]) return;

    try {
      const content = await fs.readFile(this.#filePath(), 'utf8');
      const data = JSON.parse(content);

      this.#dynamicJobIterator(data, streamPrice);

      // @TODO remove in UI ->> data['param']['field-requestFrequency'];

      // @TODO calculate in REALTIME table data (depends on current price)
      // update teble on UI
      const message = JSON.stringify({ type: 'data', data });

      this.wss.clients.forEach((client) => {
        if (client.readyState === 1) {
          client.send(message);
        }
      });
    } catch (err) {
      console.error(this.#filePath(), 'Error reading file:', err);
    }
  }

  async start(symbol, strategy) {
    if (!this.running[symbol]) {
      // this.strategy from file settings(back) or strategy from click on button (front)
      this.strategy = this.strategy ? this.strategy : strategy;

      this.stream = new StreamAPI(symbol);
      this.stream.startTracking();

      this.stream.on('message', (data) => {
        this.emit('price', data);
        if (this.strategy == 'longDynamic') {
          console.log('START LONGDYNAMIC', data.c);
          // this.#readLoopDynamic(data, data.c);
        }
      });

      this.running[symbol] = true;

      this.symbol = symbol;

      if (this.strategy != 'longDynamic') {
        this.readLoop();
      }

      console.log('🟢 Start:', symbol, this.strategy);
    }
  }

  #filePath(timestamp = '') {
    return path.join(__dirname, '../data', `${timestamp}${this.symbol}-${this.exchangeName}.json`);
  }

  async stop(symbol) {
    clearTimeout(this.timer);
    this.stream.stopTracking();
    this.timer = null;
    this.running[symbol] = false;

    console.log('🛑 Stop:', symbol);
  }

  #sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

module.exports = JsonTimerSender;
