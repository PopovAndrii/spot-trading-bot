const WebSocket = require('ws');
const JsonTimerSender = require('../modules/jsonTimerSender.js');
const { pair, statusPair } = require('./pair.js');

class WebSocketRouter {
  constructor(server) {
    this.wss = new WebSocket.Server({ server });
    this.clients = new Map();
    this.timerSenders = new Map();

    this.setup();
  }

  setup() {
    this.wss.on('connection', (ws) => {
      let currentSymbol = null;
      console.log('🟢 WebSocket connected');

      ws.on('message', (msg) => {
        let data;
        try {
          data = JSON.parse(msg);
        } catch (err) {
          return this.safeSend(ws, { error: 'www JSON error' });
        }

        if (data.type === 'subscribe') {
          currentSymbol = data.symbol.toUpperCase();

          if (!this.clients.has(currentSymbol)) {
            this.clients.set(currentSymbol, new Set());
          }
          this.clients.get(currentSymbol).add(ws);

          if (!this.timerSenders.has(currentSymbol)) {
            const ts = new JsonTimerSender(this.wss, data.strategy);
            this.timerSenders.set(currentSymbol, ts);

            // add symbol at ones
            pair.addSymbol({
              symbol: currentSymbol, // @TODO remove
              status: statusPair.NEW,
              base: data.base,
              quote: data.quote,
            });

            ts.on('price', (price) => {
              for (const client of this.clients.get(currentSymbol) || []) {
                this.safeSend(client, {
                  event: 'updatePrice',
                  data: price,
                });
              }
            });

            ts.on('stopped', (symbol) => {
              pair.updateSymbol({ symbol, status: statusPair.STOP });

              for (const client of this.clients.get(symbol) || []) {
                this.safeSend(client, {
                  event: 'updateTableData',
                  data: 0,
                });
              }
            });

            ts.on('restarted', (data) => {
              console.log(`🔄 Cycle restarted for ${data.symbol} at price ${data.price}`);

              for (const client of this.clients.get(data.symbol) || []) {
                this.safeSend(client, {
                  event: 'cycleRestarted',
                  data: {
                    symbol: data.symbol,
                    price: data.price,
                    message: 'New + cycle started'
                  }
                });
              }
            });
          }

          const ts = this.timerSenders.get(currentSymbol);
          const status = ts.getSpotStatus(currentSymbol);
          this.safeSend(ws, { event: 'spotStatus', data: status });
        }

        if (data.type === 'start' && currentSymbol) {
          const ts = this.timerSenders.get(currentSymbol);

          ts.start(currentSymbol, data.strategy, {
            autoRestart: data.autoRestart || false
          });

          pair.updateSymbol({ symbol: currentSymbol, status: statusPair.START });

          for (const client of this.clients.get(currentSymbol) || []) {
            this.safeSend(client, {
              event: 'updateTableData',
              data: 1,
            });
          }
        }

        if (data.type === 'restartSync' && currentSymbol) {
          for (const client of this.clients.get(currentSymbol) || []) {
            if (client !== ws) {
              this.safeSend(client, { event: 'restartSync', data: data.value });
            }
          }
        }

        if (data.type === 'stop' && currentSymbol) {
          const ts = this.timerSenders.get(currentSymbol);
          ts.stop();

          pair.updateSymbol({ symbol: currentSymbol, status: statusPair.STOP });

          for (const client of this.clients.get(currentSymbol) || []) {
            this.safeSend(client, {
              event: 'updateTableData',
              data: 0,
            });
          }
        }
      });

      ws.on('error', (err) => console.error('WS error:', err));

      ws.on('close', () => {
        if (currentSymbol && this.clients.has(currentSymbol)) {
          this.clients.get(currentSymbol).delete(ws);

          if (this.clients.get(currentSymbol).size === 0) {
            this.clients.delete(currentSymbol);
            console.log(`🔌 no clients for ${currentSymbol}, stream still active`);
          }
        }
      });
    });
  }

  safeSend(ws, data) {
    try {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify(data));
      }
    } catch (err) {
      console.warn('❌Err Sending:', err.message);
    }
  }
}

module.exports = WebSocketRouter;
