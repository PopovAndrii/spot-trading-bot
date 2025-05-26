const fs = require('fs/promises');
const path = require('path');
const { Job, Status } = require('../lib/job');
const { InvokeApi } = require('../lib/invokeAPI');

class JsonTimerSender {
    constructor(wss, interval = 2000) {
      this.wss = wss;
      this.interval = interval;
      this.timer = null;
      this.running = false;
      this.Date = '';
      this.exchangeName = "binance";

      this.job = new Job(false); // test === true
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
          console.error('Ошибка при вызове метода API:', err);
          return null;
        }
      }

      console.error(`Method [${data.method}] does not exist`);
      return null;
    }

    /**
     * Iterates through the entire table of placed orders.
     * @param {Object} obj - Configuration of order data from file or database.
     * @returns {Stop()} - Stop the cycle.
     */
    async #jobItaretor (obj = {}) {
      if (obj.status == Status.REDY) { // never started 0
        for (const [key, val] of obj['BUY'].entries()) {
          let currentOrderData = this.job.long(obj, key, val); // strategy. 

          if (currentOrderData.status === "final") {  // finish

            const result = await this.#runToApi(currentOrderData);

            // this.#applyStatusesToOrders(obj['BUY'], result);
            // this.#applyStatusesToOrders(obj['SELL'], result);
            
            obj['status'] = Status.DONE;
            obj['date_modified'] = new Date().toISOString();


            await fs.writeFile(this.#filePath(`${Date.now()}-`), JSON.stringify(obj, null, 2));

            await this.stop(); // new cycle here
            return;
          }

          if (currentOrderData.status === "pass") {
            console.log(currentOrderData)
            await this.#sleep(200); 
            continue;
          } // processed order (api request not needed) or test loop
          
          const resAPI = await this.#runToApi(currentOrderData); 
                  
          if (resAPI === null ){
            console.error('Incorrect method')
            continue;
          }

          if (resAPI.status === currentOrderData.status) { // ["PARTIALLY_FILLED"] or ["NEW"]
            await this.#sleep(200); 
            continue; /** no need to write to file */ 
          }

          const toObj = {
            "status": resAPI.status,
            "orderId": resAPI.orderId
          }

          // resAPI.side == "SELL" or "BUY" 
          // currentOrderData['id'] !== [key] !!!
          Object.assign(obj[resAPI.side][currentOrderData['id']], toObj);

          // write res to file
          await fs.writeFile(this.#filePath(), JSON.stringify(obj, null, 2));

          await this.#sleep(1000);
        }
      }
    }

    #applyStatusesToOrders(orders, statuses) {
      console.log('applyStatusesToOrders')
      orders.forEach(order => {
        const match = statuses.find(status => status.orderId === order.orderId);
        if (match) { 
          order.status = match.status;
        }
      });
    }

  async readLoop() {
    if (!this.running) return;

    try {
      const content = await fs.readFile(this.#filePath(), 'utf8');
      const data = JSON.parse(content);

      this.#jobItaretor(data);

      // needs for update teble on UI
      const message = JSON.stringify({ type: 'data', data });

      this.wss.clients.forEach(client => {
        if (client.readyState === 1) {
          client.send(message);
        }
      });

    } catch (err) {
      console.error(this.#filePath(), 'Error reading file:', err);
    }

    // @TODO calc orders * time = timeForAllLoop
    this.timer = setTimeout(() => this.readLoop(), 10000); 
  }

    async start(param) {
      // if (!this.running) return; // It's already working
      if (!this.running) {
        this.running = true;
        
        this.Date = ''; // reset path for next order group

        this.symbol = param.symbol;

        this.readLoop();

        console.log('⏳ Start');
      }
    }
  
    #filePath(timestamp = '') {
      return path.join(__dirname, '../data', `${timestamp}${this.symbol}-${this.exchangeName}.json`);
    }

    async stop() {
      this.running = false; 
      clearTimeout(this.timer);
      // this.timer = null;

      console.log('🛑 Stop');
    }

    #sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
  }

  module.exports = JsonTimerSender;   