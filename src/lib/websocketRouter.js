const WebSocket = require('ws');
const JsonTimerSender = require('../modules/jsonTimerSender.js');
const { strategyConflict } = JsonTimerSender; // the module IS the class; helpers hang off it
const { pair, statusPair } = require('./pair.js');
const { UserStreamAPI } = require('./UserStreamApi.js');

const MESSAGE_TYPES = new Set([
  'subscribe',
  'watchPrice',
  'start',
  'restartSync',
  'stop',
  'cancelOrder',
  'replaceOrder',
]);
const SYMBOL_RE = /^[A-Z0-9]{3,20}$/;
const STRATEGIES = new Set(['short', 'long']);

class WebSocketRouter {
  constructor() {
    // noServer: the HTTP server's 'upgrade' event is handled in bin/www, which
    // authorizes the session BEFORE handing the socket to handleUpgrade().
    this.wss = new WebSocket.Server({ noServer: true });
    this.clients = new Map();
    this.timerSenders = new Map();

    this.setup();
    this.startHeartbeat();
  }

  // zombie sockets
  startHeartbeat() {
    this.heartbeat = setInterval(() => {
      this.wss.clients.forEach((ws) => {
        if (ws.isAlive === false) return ws.terminate();
        ws.isAlive = false;
        ws.ping();
      });
    }, 30000);
  }

  // Called from bin/www after the session has been validated on the upgrade
  // request. Completes the WS handshake and emits 'connection'.
  handleUpgrade(req, socket, head) {
    this.wss.handleUpgrade(req, socket, head, (ws) => {
      this.wss.emit('connection', ws, req);
    });
  }

  setup() {
    this.wss.on('connection', (ws) => {
      let currentSymbol = null;
      console.log('🟢 WebSocket connected');

      ws.isAlive = true;
      ws.on('pong', () => {
        ws.isAlive = true;
      });

      ws.on('message', async (msg) => {
        let data;
        try {
          data = JSON.parse(msg);
        } catch (err) {
          return this.safeSend(ws, { error: 'www JSON error' });
        }

        try {
          if (!data || typeof data !== 'object' || !MESSAGE_TYPES.has(data.type)) {
            return this.safeSend(ws, { error: 'unknown message type' });
          }

          if (data.type === 'subscribe') {
            const symbol = typeof data.symbol === 'string' ? data.symbol.toUpperCase() : '';

            if (!SYMBOL_RE.test(symbol)) {
              return this.safeSend(ws, { error: 'invalid symbol' });
            }

            if (data.strategy != null && !STRATEGIES.has(data.strategy)) {
              return this.safeSend(ws, { error: 'invalid strategy' });
            }

            if (currentSymbol && currentSymbol !== symbol) {
              this.clients.get(currentSymbol)?.delete(ws);
            }

            currentSymbol = symbol;

            if (!this.clients.has(currentSymbol)) {
              this.clients.set(currentSymbol, new Set());
            }
            this.clients.get(currentSymbol).add(ws);

            if (!this.timerSenders.has(currentSymbol)) {
              const ts = new JsonTimerSender(this.wss, data.strategy);
              this.timerSenders.set(currentSymbol, ts);

              const sym = currentSymbol;

              // add symbol at ones
              pair.addSymbol({
                symbol: sym, // @TODO remove
                status: statusPair.NEW,
                base: data.base,
                quote: data.quote,
              });

              ts.on('price', (price) => {
                for (const client of this.clients.get(sym) || []) {
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

                // still-watching clients → keep the idle price ticking
                if ((this.clients.get(symbol)?.size || 0) > 0) {
                  this.timerSenders.get(symbol)?.watchPrice(symbol);
                }

                this.#maybeCleanup(symbol);
              });

              ts.on('tableData', (tableData) => {
                for (const client of this.clients.get(sym) || []) {
                  this.safeSend(client, { event: 'tableData', data: tableData });
                }
              });

              ts.on('streamState', (state) => {
                for (const client of this.clients.get(state.symbol) || []) {
                  this.safeSend(client, {
                    event: 'notification',
                    data: {
                      message: state.message,
                      type: state.up ? 'success' : 'warning',
                    },
                  });
                }
              });

              ts.on('recovery', (data) => {
                for (const client of this.clients.get(data.symbol) || []) {
                  this.safeSend(client, {
                    event: 'notification',
                    data: { message: data.text, type: 'warning', persist: true },
                  });
                }
              });

              // Reminder about a stuck manual slot: a self-dismissing
              // warning toast (no persist), like a normal notification. The text is
              // computed in jsonTimerSender (#remindManualStuck, read-only).
              ts.on('manualStuck', (data) => {
                for (const client of this.clients.get(data.symbol) || []) {
                  this.safeSend(client, {
                    event: 'notification',
                    data: { message: data.text, type: 'warning' },
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
                      message: 'New + cycle started',
                    },
                  });
                }
              });
            }

            const ts = this.timerSenders.get(currentSymbol);
            const status = ts.getSpotStatus(currentSymbol);
            this.safeSend(ws, { event: 'spotStatus', data: status });

            if (pair.needsAttention(currentSymbol)) {
              this.safeSend(ws, {
                event: 'notification',
                data: {
                  message:
                    `⚠️ ${currentSymbol}: server was restarted while orders were live. ` +
                    'Cycle is NOT running — press Start to resume, or cancel orders. Save is locked.',
                  type: 'warning',
                },
              });
            }
          }

          if (data.type === 'watchPrice' && currentSymbol) {
            // Long/Short picked → open the public price stream so the UI shows a
            // live price before Start. No trading side effects (see watchPrice()).
            this.timerSenders.get(currentSymbol)?.watchPrice(currentSymbol);
          }

          if (data.type === 'start' && currentSymbol) {
            if (!STRATEGIES.has(data.strategy)) {
              return this.safeSend(ws, { error: 'invalid strategy' });
            }

            const ts = this.timerSenders.get(currentSymbol);

            // The saved grid decides which side this pair trades — never the toggle
            // in the browser. Disagreement means the engine would trade one strategy
            // over the other's table; refuse the start instead. See strategyConflict.
            const conflict = strategyConflict(
              await ts.savedStrategy(currentSymbol),
              data.strategy
            );

            if (conflict) {
              return this.safeSend(ws, {
                event: 'notification',
                data: {
                  message: `⚠️ ${currentSymbol}: ${conflict}`,
                  type: 'warning',
                  persist: true,
                },
              });
            }

            ts.start(currentSymbol, data.strategy, {
              autoRestart: data.autoRestart === true,
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

          if (data.type === 'cancelOrder' && currentSymbol) {
            // Expert Mode gate, server-enforced: manual order
            // ops require the client to assert expert:true. Defense-in-depth for a
            // single-user app — guards against a stray/replayed/buggy emission, not
            // a hostile client (already authenticated).
            if (data.expert !== true) {
              return this.safeSend(ws, { error: 'expert mode required' });
            }
            const ts = this.timerSenders.get(currentSymbol);
            if (!ts) {
              return this.safeSend(ws, { error: 'no active cycle' });
            }
            ts.cancelManualOrder({
              side: data.side,
              index: Number(data.index),
              orderId: data.orderId,
            })
              .then((result) =>
                // echo side/index so the client can release the held ✕ on failure
                this.safeSend(ws, {
                  event: 'cancelOrderResult',
                  data: { ...result, side: data.side, index: Number(data.index) },
                })
              )
              .catch((err) => {
                console.error('❌ cancelOrder WS:', err);
                this.safeSend(ws, { error: 'cancel failed' });
              });
          }

          if (data.type === 'replaceOrder' && currentSymbol) {
            // Expert Mode gate, server-enforced — see cancelOrder.
            if (data.expert !== true) {
              return this.safeSend(ws, { error: 'expert mode required' });
            }
            const ts = this.timerSenders.get(currentSymbol);
            if (!ts) {
              return this.safeSend(ws, { error: 'no active cycle' });
            }
            ts.replaceManualOrder({
              side: data.side,
              index: Number(data.index),
              price: data.price,
            })
              .then((result) => this.safeSend(ws, { event: 'replaceOrderResult', data: result }))
              .catch((err) => {
                console.error('❌ replaceOrder WS:', err);
                this.safeSend(ws, { error: 'replace failed' });
              });
          }

          if (data.type === 'stop' && currentSymbol) {
            const ts = this.timerSenders.get(currentSymbol);
            ts.stop();
            // keep the idle price ticking (parity with pre-Start Long/Short)
            ts.watchPrice(currentSymbol);

            pair.updateSymbol({ symbol: currentSymbol, status: statusPair.STOP });

            for (const client of this.clients.get(currentSymbol) || []) {
              this.safeSend(client, {
                event: 'updateTableData',
                data: 0,
              });
            }
          }
        } catch (err) {
          console.error('❌ WS message handler error:', err);
          this.safeSend(ws, { error: 'internal error' });
        }
      });

      ws.on('error', (err) => console.error('WS error:', err));

      ws.on('close', () => {
        if (currentSymbol && this.clients.has(currentSymbol)) {
          this.clients.get(currentSymbol).delete(ws);

          if (this.clients.get(currentSymbol).size === 0) {
            this.clients.delete(currentSymbol);
            console.log(`🔌 no clients for ${currentSymbol}, stream still active`);
            this.#maybeCleanup(currentSymbol);
          }
        }
      });
    });
  }

  #maybeCleanup(symbol) {
    const ts = this.timerSenders.get(symbol);
    if (!ts) return;

    const hasClients = (this.clients.get(symbol)?.size || 0) > 0;
    if (hasClients || ts.getSpotStatus(symbol)) return;

    ts.removeAllListeners();
    this.timerSenders.delete(symbol);
    console.log(`🧹 timerSender ${symbol} removed (no clients, not running)`);
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

  shutdown() {
    clearInterval(this.heartbeat);

    this.timerSenders.forEach((ts, symbol) => {
      if (ts.getSpotStatus(symbol)) ts.stop();
    });

    if (UserStreamAPI.hasInstance()) {
      UserStreamAPI.removeInstance();
    }

    this.wss.clients.forEach((ws) => ws.close());
  }
}

module.exports = WebSocketRouter;
