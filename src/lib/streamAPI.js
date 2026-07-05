const EventEmitter = require('events');
const WebSocket = require('ws');

class StreamAPI extends EventEmitter {
  static instances = new Map();

  /**
   * One stream per symbol is obtained via the static getInstance() — the
   * constructor no longer deduplicates (previously `new StreamAPI(sym)` returned
   * a cached instance — an antipattern).
   *
   * const btcStream = StreamAPI.getInstance('BTCUSDT');
   * btcStream.on('message', (data) => console.log('BTC price:', data.c));
   * btcStream.start();
   *
   * const sameBtc = StreamAPI.getInstance('BTCUSDT'); // same object
   * console.log(btcStream === sameBtc); // true
   * @param {*} symbol
   */
  constructor(symbol) {
    super();

    this.symbol = symbol.toLowerCase();
    this.ws = null;
    this.reconnectTimer = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.lastMessageTime = null;
    this.heartbeatTimer = null;
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
      if (this.reconnectAttempts >= this.maxReconnectAttempts) {
        // recovered after a long outage we already signaled via
        // maxReconnectReached — notify the listeners
        this.emit('reconnected');
      }
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
      // EventEmitter throws if emit('error') has no listeners → process crash.
      // Network errors (ETIMEDOUT etc.) come with a 'close' event, which already
      // triggers reconnection, so here it's enough to re-emit only when someone
      // is actually listening for 'error'.
      if (this.listenerCount('error') > 0) {
        this.emit('error', err);
      }
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
      this.ws.on('error', () => {}); // noop — suppress unhandled error on close
      if (this.ws.readyState === 0 /* CONNECTING */) {
        this.ws.terminate();
      } else {
        this.ws.close();
      }
      this.ws = null;
    }
  }

  // ========== HEARTBEAT (connection liveness check) ==========
  startHeartbeat() {
    this.stopHeartbeat(); // Stop the previous one

    this.heartbeatTimer = setInterval(() => {
      if (!this.lastMessageTime) return;

      const timeSinceLastMsg = Date.now() - this.lastMessageTime;

      // If there's no data for 30 seconds → reconnect
      if (timeSinceLastMsg > 30 * 1000) {
        console.warn(
          `⚠️ ${this.symbol}: no data ${Math.round(timeSinceLastMsg / 1000)}s, reconnecting...`
        );
        this.reconnect();
      }
    }, 10 * 1000); // Check every 10 seconds
  }

  stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  // ========== RECONNECTION ==========
  scheduleReconnect() {
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000); // Exponential backoff, capped at 30s
    this.reconnectAttempts++;

    // Never give up: for a trading bot, silently losing the price stream is worse
    // than retrying forever. After maxReconnectAttempts we
    // keep going at the delay cap, but signal a long outage once — listeners notify
    // the UI/log. On a successful 'open', 'reconnected' is emitted.
    if (this.reconnectAttempts === this.maxReconnectAttempts) {
      console.error(`❌ ${this.symbol}: stream down for a long time, keep reconnecting...`);
      this.emit('maxReconnectReached');
    }

    console.log(
      `🔄 ${this.symbol}: reconnection in ${delay / 1000}s (attempt ${this.reconnectAttempts})`
    );

    this.reconnectTimer = setTimeout(() => {
      this.reconnect();
    }, delay);
  }

  reconnect() {
    this.stop();
    this.start();
  }

  // ========== STATUS CHECKS ==========
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
      StreamAPI.instances.set(normalizedSymbol, new StreamAPI(normalizedSymbol));
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
