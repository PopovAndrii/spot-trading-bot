const EventEmitter = require('events');
const WebSocket = require('ws');

class StreamAPI extends EventEmitter {
  constructor(symbol) {
    super();
    this.symbol = symbol.toLowerCase();
    this.ws = null;
  }

  startTracking() {
    const url = `wss://stream.binance.com:9443/ws/${this.symbol}@ticker`;
    this.ws = new WebSocket(url);

    this.ws.on('message', (data) => {
      const json = JSON.parse(data);
      this.emit('message', json);
    });

    this.ws.on('open', () => {
      console.log(`🟢 Start Stream: ${this.symbol}`);
      this.emit('open');
    });

    this.ws.on('close', () => {
      console.log(`🔴 Stop Stream: ${this.symbol}`);
      this.emit('close', true);
    });

    this.ws.on('error', (err) => {
      console.error(`❌ Stream error: ${err.message}`);
      this.emit('error');
    });
  }

  stopTracking() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}
module.exports = { StreamAPI };
