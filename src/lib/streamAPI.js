const EventEmitter = require('events');
const WebSocket = require('ws');

class StreamAPI extends EventEmitter {
  static instances = new Map();

  /**
   * const btcStream = new StreamAPI('BTCUSDT');
   * btcStream.on('message', (data) => {
   *  console.log('BTC price:', data.c);
   * });
   * btcStream.start();
   *
   * const btcStream2 = new StreamAPI('BTCUSDT');  // same instance!
   * console.log(btcStream === btcStream2);  // true
   * @param {*} symbol
   * @returns
   */
  constructor(symbol) {
    super();

    const normalizedSymbol = symbol.toLowerCase();

    // If an instance of this symbol already exists, return it.
    if (StreamAPI.instances.has(normalizedSymbol)) {
      console.log(`⚠️ StreamAPI for ${normalizedSymbol} already exist`);
      return StreamAPI.instances.get(normalizedSymbol);
    }

    this.symbol = normalizedSymbol;
    this.ws = null;
    this.reconnectTimer = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.lastMessageTime = null;
    this.heartbeatTimer = null;

    StreamAPI.instances.set(normalizedSymbol, this);
  }

  start() {
    // Check: Already running?
    if (this.isConnected()) {
      console.log(`⚠️ Stream for ${this.symbol} already connect`);
      return;
    }

    if (this.isConnecting()) {
      console.log(`⚠️ Stream for ${this.symbol} already connecting...`);
      return;
    }

    const url = `wss://stream.binance.com:9443/ws/${this.symbol}@ticker`;
    console.log(`🔄 StreamAPI Connecting ${this.symbol}...`);

    this.ws = new WebSocket(url);

    this.ws.on('open', () => {
      console.log(`🟢 Start Stream: ${this.symbol}`);
      this.reconnectAttempts = 0; // Reset the counter
      this.startHeartbeat();
      this.emit('open');
    });

    this.ws.on('message', (data) => {
      this.lastMessageTime = Date.now();

      try {
        const json = JSON.parse(data);
        this.emit('message', json);
      } catch (err) {
        console.error(`❌ JSON parse error for ${this.symbol}:`, err.message);
      }
    });

    this.ws.on('close', (code, reason) => {
      console.log(`🔴 Stop Stream: ${this.symbol} (code: ${code})`);
      this.stopHeartbeat();
      this.emit('close', { code, reason: reason.toString() });

      // Automatic reconnection
      this.scheduleReconnect();
    });

    this.ws.on('error', (err) => {
      console.error(`❌ Stream error ${this.symbol}: ${err.message}`);
      this.emit('error', err);
    });
  }

  stop() {
    console.log(`⏹️ Stop stream for ${this.symbol}...`);

    this.stopHeartbeat();

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.on('error', () => {}); // noop — подавить unhandled error при закрытии
      if (this.ws.readyState === 0 /* CONNECTING */) {
        this.ws.terminate();
      } else {
        this.ws.close();
      }
      this.ws = null;
    }
  }

  // ========== HEARTBEAT (проверка живости соединения) ==========
  startHeartbeat() {
    this.stopHeartbeat(); // Остановить предыдущий

    this.heartbeatTimer = setInterval(() => {
      if (!this.lastMessageTime) return;

      const timeSinceLastMsg = Date.now() - this.lastMessageTime;

      // Если 30 секунд нет данных → переподключаемся
      if (timeSinceLastMsg > 30 * 1000) {
        console.warn(
          `⚠️ ${this.symbol}: no data ${Math.round(timeSinceLastMsg / 1000)}s, reconnecting...`
        );
        this.reconnect();
      }
    }, 10 * 1000); // Проверяем каждые 10 секунд
  }

  stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  // ========== ПЕРЕПОДКЛЮЧЕНИЕ ==========
  scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error(`❌ ${this.symbol}: the limit of reconnection attempts has been exceeded`);
      this.emit('maxReconnectReached');
      return;
    }

    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000); // Exponential backoff
    this.reconnectAttempts++;

    console.log(
      `🔄 ${this.symbol}: reconnection in ${delay / 1000}s (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`
    );

    this.reconnectTimer = setTimeout(() => {
      this.reconnect();
    }, delay);
  }

  reconnect() {
    this.stop();
    this.start();
  }

  // ========== ПРОВЕРКИ СТАТУСА ==========
  isConnected() {
    return this.ws && this.ws.readyState === WebSocket.OPEN;
  }

  isConnecting() {
    return this.ws && this.ws.readyState === WebSocket.CONNECTING;
  }

  isDisconnected() {
    return (
      !this.ws ||
      this.ws.readyState === WebSocket.CLOSED ||
      this.ws.readyState === WebSocket.CLOSING
    );
  }

  getStatus() {
    if (!this.ws) return 'NOT_INITIALIZED';

    switch (this.ws.readyState) {
      case WebSocket.CONNECTING:
        return 'CONNECTING';
      case WebSocket.OPEN:
        return 'CONNECTED';
      case WebSocket.CLOSING:
        return 'CLOSING';
      case WebSocket.CLOSED:
        return 'CLOSED';
      default:
        return 'UNKNOWN';
    }
  }

  getStats() {
    return {
      symbol: this.symbol,
      status: this.getStatus(),
      isConnected: this.isConnected(),
      lastMessage: this.lastMessageTime ? new Date(this.lastMessageTime).toISOString() : null,
      reconnectAttempts: this.reconnectAttempts,
      timeSinceLastMessage: this.lastMessageTime ? Date.now() - this.lastMessageTime : null,
    };
  }

  /**
   * const btcStream = StreamAPI.getInstance('BTCUSDT');
   * btcStream.start();
   *
   * const ethStream = StreamAPI.getInstance('ETHUSDT');
   * ethStream.start();
   *
   * const sameBtcStream = StreamAPI.getInstance('BTCUSDT');
   * @param {*} symbol
   * @returns
   */
  static getInstance(symbol) {
    const normalizedSymbol = symbol.toLowerCase();

    if (!StreamAPI.instances.has(normalizedSymbol)) {
      new StreamAPI(normalizedSymbol);
    }

    return StreamAPI.instances.get(normalizedSymbol);
  }

  static getAllInstances() {
    return Array.from(StreamAPI.instances.values());
  }

  static getInstancesStats() {
    return Array.from(StreamAPI.instances.values()).map((instance) => instance.getStats());
  }

  static stopAll() {
    console.log('⏹️ Stop all streams...');
    StreamAPI.instances.forEach((instance) => instance.stop());
  }

  /**
   * StreamAPI.removeInstance('BTCUSDT');
   * @param {*} symbol
   */
  static removeInstance(symbol) {
    const normalizedSymbol = symbol.toLowerCase();
    const instance = StreamAPI.instances.get(normalizedSymbol);

    if (instance) {
      instance.stop();
      StreamAPI.instances.delete(normalizedSymbol);
      console.log(`🗑️ Removed stream for ${normalizedSymbol}`);
    }
  }
}

module.exports = { StreamAPI };
