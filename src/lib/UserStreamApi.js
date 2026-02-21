const EventEmitter = require('events');
const WebSocket = require('ws');

class UserStreamAPI extends EventEmitter {
  static instance = null;

  constructor(client, wssURL = null) {
    super();

    if (UserStreamAPI.instance) {
      console.log('❕ UserStreamAPI already exists, returning it ❕');
      return UserStreamAPI.instance;
    }

    this.client = client;
    this.ws = null;
    this.wssURL = wssURL ? wssURL : `wss://stream.binance.com:9443/ws/`;
    this.listenKey = null;
    this.keepAliveTimer = null;
    this.heartbeatTimer = null;
    this.isStarted = false;

    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;

    UserStreamAPI.instance = this;
  }

  async start() {
    if (this.isStarted) {
      console.log('❕ UserStream already started');
      return;
    }

    try {
      // Create listenKey
      console.log('🔄 Creating listenKey...');
      const res = await this.client.createListenKey();
      this.listenKey = res.data.listenKey;
      console.log('🔑 ListenKey created');

      // const url = `wss://stream.binance.com:9443/ws/${this.listenKey}`;
      const url = `${this.wssURL}${this.listenKey}`;
      this.ws = new WebSocket(url);

      this.ws.on('open', () => {
        console.log('🟢 User Stream started');
        this.isStarted = true;
        this.emit('open');
      });

      this.ws.on('message', (data) => {
        const json = JSON.parse(data);

        if (json.e === 'executionReport') {
          this.emit('executionReport', json);
        }

        if (json.e === 'outboundAccountPosition') {
          this.emit('balance', json);
        }
      });

      this.ws.on('close', () => {
        console.log('🔴 User Stream closed');
        this.isStarted = false;
        this.emit('close');

        // Stopping keep-alive on close
        if (this.keepAliveTimer) {
          clearInterval(this.keepAliveTimer);
          this.keepAliveTimer = null;
        }
      });

      this.ws.on('error', (err) => {
        console.error('❌ User Stream error:', err.message);
        this.emit('error', err);

        // Reconnecting on network error
        if (!this.isStarted) {
          this.reconnect();
        }
      });

      // Keep-alive every 30 min
      this.keepAliveTimer = setInterval(
        async () => {
          try {
            console.log('🔄 Keep-alive listenKey...');
            // console.log('signature: ', this.client.renewListenKey.toString());

            await this.client.renewListenKey(this.listenKey);

            console.log('✔️ Keep-alive OK');
          } catch (e) {
            console.error('❌ Keep-alive FAILED:', e.message);
            console.error('❌ Response data:', e.response?.data);
            console.error('❌ Status code:', e.response?.status);

            // If the value is 400, the key is dead and needs to be rebooted.
            if (e.response?.status === 400) {
              console.log('⚠️ ListenKey expired, full reconnect needed');
            }

            this.reconnect();
          }
        },
        5 * 60 * 1000
      );
    } catch (error) {
      console.error('❌ Failed to start UserStream:', error.message);
      this.isStarted = false;
      // throw error;
    }
  }

  reconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('❌ The reconnection attempt limit has been exceeded');
      // this.emit('maxReconnectReached');
      return;
    }

    this.stop();

    // Задержка с увеличением
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    this.reconnectAttempts++;

    console.log(
      `🔄 Reconnecting in ${delay / 1000}s (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`
    );

    setTimeout(() => {
      this.start()
        .then(() => {
          this.reconnectAttempts = 0; // ← Сброс при успехе
        })
        .catch((err) => {
          console.error('❌ Reconnect failed:', err.message);
        });
    }, delay);
  }

  stop() {
    this.isStarted = false;

    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = null;
    }

    if (this.ws) {
      this.ws.removeAllListeners();

      // Check: Close only if connection is open or opening
      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        console.log('⛔ Stopping UserStream...');
        this.ws.close();
      }

      this.ws = null;
    }

    // clouse listenKey (ignore errors 400)
    if (this.listenKey) {
      this.client.closeListenKey({ listenKey: this.listenKey }).catch(() => {
        // Молча игнорируем (ключ уже протух)
      });
      this.listenKey = null;
    }
  }

  isConnected() {
    return this.ws && this.ws.readyState === WebSocket.OPEN;
  }

  /**
   * Example
   * const stream = UserStreamAPI.getInstance(client);
   * await stream.start();
   *
   * const sameStream = UserStreamAPI.getInstance(client);
   * console.log(stream === sameStream); // true
   * @param {*} client
   * @returns
   */
  static getInstance(client) {
    if (!UserStreamAPI.instance) {
      UserStreamAPI.instance = new UserStreamAPI(client);
    }
    return UserStreamAPI.instance;
  }

  static removeInstance() {
    if (UserStreamAPI.instance) {
      console.log('🗑️ Removing UserStream instance...');
      UserStreamAPI.instance.destroy();
      UserStreamAPI.instance = null;
    } else {
      console.log('❕ No UserStream instance to remove');
    }
  }

  static hasInstance() {
    return UserStreamAPI.instance !== null;
  }

  getStats() {
    return {
      isStarted: this.isStarted,
      isConnected: this.isConnected(),
      hasListenKey: !!this.listenKey,
    };
  }

  destroy() {
    console.log('💀 Destroying UserStream instance...');
    this.stop();
    this.removeAllListeners();
    UserStreamAPI.instance = null;
  }
}
module.exports = { UserStreamAPI };
