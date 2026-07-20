const test = require('node:test');
const assert = require('node:assert/strict');

// The public price stream MUST come from the exchange the orders live on. It was
// hardcoded to mainnet while BINANCE_MODE=test placed every order on testnet — two
// order books, two prices. The hybrid scalp reads this stream to decide whether the
// price sits inside the pause zone, so it was gating a micro priced off TESTNET
// fills against a MAINNET tick: on a fast move mainnet leads, the engine sees the
// price leave the zone and pulls the micro, while the testnet market has not even
// reached it yet. The scalp could arm and cancel for hours without ever filling —
// and the price in the UI header was from the wrong exchange too, which is why it
// all looked plausible.
//
// streamAPI caches the WebSocket class at require time, so the URL is asserted
// through a fake socket rather than by opening one.

const load = (mode) => {
  const prev = {
    mode: process.env.BINANCE_MODE,
    node: process.env.NODE_ENV,
    key: process.env.API_KEY,
    secret: process.env.API_SECRET,
  };
  process.env.BINANCE_MODE = mode;
  process.env.NODE_ENV = 'production'; // isTestnet() falls back to NODE_ENV when unset
  // isTestnet()'s safe fallback: "real" without real keys is still testnet. The test
  // asks about the URL, not the keys, so give it keys to ask the question at all.
  process.env.API_KEY = 'k';
  process.env.API_SECRET = 's';

  const urls = [];
  const wsPath = require.resolve('ws');
  const streamPath = require.resolve('../lib/streamAPI');
  const realWs = require.cache[wsPath];

  require.cache[wsPath] = {
    id: wsPath,
    filename: wsPath,
    loaded: true,
    exports: class FakeSocket {
      constructor(url) {
        urls.push(url);
      }

      on() {}
      close() {}
    },
  };
  delete require.cache[streamPath];

  const { StreamAPI } = require('../lib/streamAPI');
  StreamAPI.getInstance('BNBUSDT').start();

  // restore the module registry for every other test in the run
  if (realWs) require.cache[wsPath] = realWs;
  else delete require.cache[wsPath];
  delete require.cache[streamPath];
  process.env.BINANCE_MODE = prev.mode;
  process.env.NODE_ENV = prev.node;
  process.env.API_KEY = prev.key;
  process.env.API_SECRET = prev.secret;

  return urls[0];
};

test('stream: testnet orders get the testnet price feed', () => {
  assert.equal(load('test'), 'wss://stream.testnet.binance.vision/ws/bnbusdt@ticker');
});

test('stream: real orders get the real price feed', () => {
  assert.equal(load('real'), 'wss://stream.binance.com:9443/ws/bnbusdt@ticker');
});
