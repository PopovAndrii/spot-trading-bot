const EventEmitter = require('events');
const fs = require('fs/promises');
const path = require('path');
const { Job, Status } = require('../lib/job');
const { InvokeApi } = require('../lib/invokeAPI');
const { StreamAPI } = require('../lib/streamAPI');
const { Calculator } = require('../lib/calculator');
// const { UserStreamAPI } = require('../lib/UserStreamApi');

const activeSymbols = new Set();

class JsonTimerSender extends EventEmitter {
  constructor(wss, strategy = null) {
    super();
    this.wss = wss;
    this.timer = null;
    this.symbol = null;
    this.strategy = strategy;
    this.autoRestart = false;  // ← ДОБАВЬ
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
      let i = 0;

      // never started 0
      for (const [key, val] of obj[strategy.side].entries()) {

        if (obj[strategy.side][key]['status'] === "NEW" || obj[strategy.side][key]['status'] === null) {
          if (i === parseFloat(obj['param']['field-activeOrders'])) {
            return;
          }
          i++;
        }

        let currentOrder = this.job[strategy.method](obj, key, val); // strategy.

        if (currentOrder.status === Status.DONE) {
          const result = await this.#runToApi(currentOrder);

          // this.#applyStatusesToOrders(obj['BUY'], result);
          // this.#applyStatusesToOrders(obj['SELL'], result);

          obj.status = Status.DONE;
          obj.date_modified = new Date().toISOString();

          this.autoRestart = obj.restart == true ? true : false;

          if (this.autoRestart) {
            // write old data
            await fs.writeFile(this.#filePath(`${Date.now()}-`), JSON.stringify(obj, null, 2));

            await this.#sleep(500);
            this.restartCycle(obj);
            await this.#sleep(500);

            return;
          } else {
            // final write
            this.stop();
            await fs.writeFile(this.#filePath(`${Date.now()}-`), JSON.stringify(obj, null, 2));
            return;
          }

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

  async start(symbol, strategy, options = {}) {

    if (!this.running[symbol]) {
      // this.strategy = (this.strategy == null) ? strategy : this.strategy;
      this.strategy = strategy == 'short' ? 'short' : 'long';
      console.log(strategy, "Strategy:", this.strategy)

      this.autoRestart = options.autoRestart || false;

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
      streamAPI.removeAllListeners('message'); // не дублировать слушатель при повторном start на singleton-инстансе
      streamAPI.start();
      streamAPI.on('message', (data) => {
        this.emit('price', data);
      });

      this.running[symbol] = true;

      this.symbol = symbol;

      this.readLoop();

      console.log('🟢 Button Start:', this.symbol, this.strategy, 'Auto restart:', this.autoRestart);
    }
  }

  #filePath(timestamp = '') {
    return path.join(__dirname, '../data', `${timestamp}${this.symbol}-${this.exchangeName}.json`);
  }

  async stop() {
    clearTimeout(this.timer);

    // UserStreamAPI.removeInstance();
    StreamAPI.removeInstance(this.symbol);

    this.timer = null;
    this.running[this.symbol] = false;

    console.log('🛑 Button Stop:', this.symbol);
    this.emit('stopped', this.symbol);
  }

  async restartCycle(obj = {}) {
    try {
      console.log(`🔄 Restarting cycle for ${this.symbol}`);

      // Get current price (and param ??)
      const data = await this.API.bookTicker({ symbol: this.symbol });

      const price = (this.strategy === "long") ? data.message.askPrice : data.message.bidPrice;

      // recalculete
      const settings = {
        ...obj['param'],
        'field-currency': `${price}`,
        'field-indent': "0",
      }

      const calc = new Calculator(settings, this.strategy);

      const tmp = this.#config(calc);
      tmp.param = settings;
      tmp.restart = true;

      // Save to file
      const filePath = path.join(__dirname, '../data', `${this.symbol}-binance.json`);
      await fs.writeFile(filePath, JSON.stringify(tmp, null, 2), 'utf8');

      this.emit('restarted', { symbol: this.symbol, price });

    } catch (err) {
      console.error('❌ Failed to restart cycle:', err);
      this.emit('stopped', this.symbol);
    }
  }

  #config(calcResult = []) {
    const config = {
      id: 'hash-hash',
      status: 0,
      pair: this.symbol,
      param: {},
      date_added: new Date().toISOString(),
      date_modified: null,
      BUY: [],
      SELL: [],
    };

    calcResult.forEach((el, index) => {
      config['BUY'][index] = {
        status: null,
        symbol: this.symbol,
        side: 'BUY',
        type: 'LIMIT',
        quantity: el.buy,
        price: el.buyCurrency,
        timeInForce: 'GTC',
        orderId: null,
      };

      config['SELL'][index] = {
        status: null,
        symbol: this.symbol,
        side: 'SELL',
        type: 'LIMIT',
        quantity: el.totalSell,
        price: el.sellCurrency,
        timeInForce: 'GTC',
        orderId: null,
      };
    })

    return config;
  }

  #sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

module.exports = JsonTimerSender;
