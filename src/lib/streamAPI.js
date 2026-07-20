const EventEmitter = require('events');
const WebSocket = require('ws');
const { isTestnet } = require('./runMode');

// The public price stream MUST come from the same exchange the orders live on.
// This used to be hardcoded to mainnet while BINANCE_MODE=test put every order on
// testnet — two different order books with two different prices. The hybrid scalp
// reads this stream to decide whether the price is inside the pause zone, so it was
// comparing a MAINNET tick against a micro priced off TESTNET fills: it armed and
// cancelled the scalp on a market its orders were not in, and the micro sat on the
// testnet book at a price the testnet market never traded at. Same for the price in
// the UI header — plausible, and from the wrong exchange.
function streamBase() {
  return isTestnet() ? 'wss://stream.testnet.binance.vision/ws/' : 'wss://stream.binance.com:9443/ws/';
}

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

    const url = `${streamBase()}${this.symbol}@ticker`;
    console.log(`🔄 StreamAPI Connecting ${this.symbol} (${isTestnet() ? 'testnet' : 'real'})...`);

    this.ws = new WebSocket(url);

    this.ws.on('open', () => {
      console.log(`🟢 Start Stream: ${this.symbol}`);
      // The socket is alive right now — start the liveness clock from here, not
      // from whatever a previous connection left behind. Without this reset the
      // watchdog re-fired 10s after every reconnect on the stale timestamp and
      // looped forever.
      this.lastMessageTime = Date.now();
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

    // Liveness comes from the protocol, not from trades. The @ticker stream only
    // pushes when the ticker changes, so an illiquid pair (ETHBTC on testnet) can
    // legitimately stay silent for minutes while the socket is perfectly healthy.
    // Binance pings every 20s regardless; ws answers pong on its own, we only note
    // the time. Same for a server pong.
    this.ws.on('ping', () => {
      this.lastMessageTime = Date.now();
    });

    this.ws.on('pong', () => {
      this.lastMessageTime = Date.now();
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
    this.lastMessageTime = null; // the next connection starts its own clock

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

      // 60s: Binance pings every 20s, so silence this long means two missed pings
      // in a row — the socket really is gone, not just the market standing still.
      if (timeSinceLastMsg > 60 * 1000) {
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
