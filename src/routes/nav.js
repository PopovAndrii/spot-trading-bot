const express = require('express');
const router = express.Router();

const { pair } = require('../lib/pair');
const logBus = require('../lib/logBus');
const { isTestnet, requestedTestnet } = require('../lib/runMode');

router.get('/symbols', (req, res) => {
  try {
    const symbols = pair.getActiveSymbols();
    res.json(symbols);
  } catch (err) {
    res.status(500).json({ error: 'Failed to get active symbols' });
  }
});

// Condition session
router.get('/session', (req, res) => {
  const enabled = process.env.STATUS_LOGIN !== 'false';
  res.json({ enabled, maxAge: req.session?.cookie?.maxAge ?? null });
});

// ping for session
router.get('/session/ping', (req, res) => {
  res.json({ ok: true, maxAge: req.session?.cookie?.maxAge ?? null });
});

// online status, time server and network (testnet/real)
router.get('/ping', (req, res) => {
  const testnet = isTestnet();
  // fallback=true: real, but due to the lack of real keys, it runs on testnet
  const fallback = !requestedTestnet() && testnet;
  res.json({ time: Date.now(), network: testnet ? 'testnet' : 'real', fallback });
});

// SSE log stream
router.get('/logs', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (e) => {
    if (res.writableEnded) return;
    try { res.write(`data: ${JSON.stringify(e)}\n\n`); } catch { }
  };

  logBus.history().forEach(send);

  const unsub = logBus.subscribe(send);
  req.on('close', unsub);
});

module.exports = router;
