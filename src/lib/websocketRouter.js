const WebSocket = require('ws');
const JsonTimerSender = require('../modules/jsonTimerSender.js');
const { pair, statusPair } = require('./pair.js');

// Валидация входящих сообщений (ANALYSIS.md п.1.1): авторизованный клиент с
// битым payload не должен ронять процесс вместе с торговыми циклами.
const MESSAGE_TYPES = new Set(['subscribe', 'start', 'restartSync', 'stop']);
const SYMBOL_RE = /^[A-Z0-9]{3,20}$/;
const STRATEGIES = new Set(['short', 'long']);

class WebSocketRouter {
  constructor() {
    // noServer: the HTTP server's 'upgrade' event is handled in bin/www, which
    // authorizes the session BEFORE handing the socket to handleUpgrade() (req 24).
    this.wss = new WebSocket.Server({ noServer: true });
    this.clients = new Map();
    this.timerSenders = new Map();

    this.setup();
    this.startHeartbeat();
  }

  // Зомби-сокеты (закрытый ноутбук, обрыв NAT) не эмитят 'close' и висели бы
  // в комнатах вечно. Стандартный паттерн ws: ping каждые 30 с; кто не ответил
  // pong к следующему тику — terminate (это уже эмитит 'close' → уборка комнат).
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
      ws.on('pong', () => { ws.isAlive = true; });

      ws.on('message', (msg) => {
        let data;
        try {
          data = JSON.parse(msg);
        } catch (err) {
          return this.safeSend(ws, { error: 'www JSON error' });
        }

        // try/catch вокруг всего тела: TypeError из обработчика — это
        // uncaughtException и падение процесса со всеми торговыми циклами
        try {
          if (!data || typeof data !== 'object' || !MESSAGE_TYPES.has(data.type)) {
            return this.safeSend(ws, { error: 'unknown message type' });
          }

          if (data.type === 'subscribe') {
            const symbol =
              typeof data.symbol === 'string' ? data.symbol.toUpperCase() : '';

            if (!SYMBOL_RE.test(symbol)) {
              return this.safeSend(ws, { error: 'invalid symbol' });
            }

            // strategy на subscribe опциональна: фронт шлёт null, пока конфиг
            // пары ещё не загружен (LoadDataFromFileCalculator.getStrategyName)
            if (data.strategy != null && !STRATEGIES.has(data.strategy)) {
              return this.safeSend(ws, { error: 'invalid strategy' });
            }

            // resubscribe на другой символ: отписать сокет от прежней комнаты,
            // иначе он навсегда остаётся в Set старого символа и получает чужие
            // рассылки (раздел 3 ANALYSIS)
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

              // sym — зафиксированный символ этого ts. Обработчики ниже живут
              // на ts, а closure-переменная currentSymbol принадлежит соединению
              // и мутирует при resubscribe — рассылка ушла бы не в ту комнату.
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

                this.#maybeCleanup(symbol);
              });

              // полный конфиг каждый тик readLoop — только подписчикам символа
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

            // recovery-скан пометил символ: живые ордера на бирже без цикла
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

          if (data.type === 'start' && currentSymbol) {
            if (!STRATEGIES.has(data.strategy)) {
              return this.safeSend(ws, { error: 'invalid strategy' });
            }

            const ts = this.timerSenders.get(currentSymbol);

            ts.start(currentSymbol, data.strategy, {
              autoRestart: data.autoRestart === true
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

  // timerSender жил вечно даже без клиентов и без цикла (утечка + слушатели).
  // Убираем, когда некому слушать И цикл не работает; следующий subscribe
  // создаст свежий инстанс, статус пары хранится в pair и переживает уборку.
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

  // Graceful shutdown (ANALYSIS п.12): остановить циклы и стримы, закрыть
  // клиентов. Файлы не трогаем — записи атомарны, recovery-скан пометит
  // живые ордера при следующем старте.
  shutdown() {
    clearInterval(this.heartbeat);

    this.timerSenders.forEach((ts, symbol) => {
      if (ts.getSpotStatus(symbol)) ts.stop();
    });

    this.wss.clients.forEach((ws) => ws.close());
  }
}

module.exports = WebSocketRouter;
