const express = require('express');
const router = express.Router();
const fs = require('fs/promises');
const path = require('path');

const { pair, statusPair } = require('../lib/pair');
const logBus = require('../lib/logBus');
const buildInfo = require('../lib/buildInfo');
const { isTestnet, requestedTestnet } = require('../lib/runMode');

// Source of truth for the navigation menu — the current series files on disk
// (SYMBOL-binance.json). A pair is visible in the menu while its file exists; the
// Cancel All Orders button deletes the file — the pair leaves the menu. Manual
// orders on the exchange don't create a file, so they don't appear in the robot's
// menu (unlike an openOrders poll, which would also capture a manual spot buy).
const DATA_DIR = path.join(__dirname, '../data');
const ARCHIVE_RE = /^\d+-/; // {timestamp}-SYMBOL-binance.json — a series archive, not the current one
const SERIES_SUFFIX = '-binance.json';

router.get('/symbols', async (req, res) => {
  try {
    const files = await fs.readdir(DATA_DIR).catch(() => []);
    // the status (running/pause/attention) lives in memory; for pairs not in the
    // map (not subscribed this session, but a file exists on disk) we show pause.
    const inMem = new Map(pair.getActiveSymbols().map((s) => [s.symbol, s]));

    const symbols = [];
    const seen = new Set();
    for (const file of files) {
      if (!file.endsWith(SERIES_SUFFIX) || ARCHIVE_RE.test(file)) continue;
      const symbol = file.slice(0, -SERIES_SUFFIX.length).toUpperCase();
      if (seen.has(symbol)) continue;
      seen.add(symbol);

      const mem = inMem.get(symbol);
      symbols.push({ symbol, status: mem ? mem.status : statusPair.STOP });
    }

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

// Build identifier for the footer (version + commit + dirty + start time).
router.get('/version', (req, res) => {
  res.json(buildInfo);
});

// SSE log stream
router.get('/logs', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // don't buffer SSE on a proxy (if one is added)
  res.flushHeaders();

  // long-lived stream — drop the idle timeout on this response's socket
  req.socket.setTimeout(0);

  // id: lets the client dedup after a reconnect (history replay).
  const send = (e) => {
    if (res.writableEnded) return;
    try {
      res.write(`id: ${e.id}\ndata: ${JSON.stringify(e)}\n\n`);
    } catch {}
  };

  // Replay only what the client hasn't seen yet. The browser sends Last-Event-ID
  // itself on an internal reconnect; on a manual EventSource recreation the client
  // puts it in ?lastEventId. NaN (first connection) → replay the whole history.
  const lastSeen = Number(req.headers['last-event-id'] ?? req.query.lastEventId);
  logBus
    .history()
    .filter((e) => !(lastSeen >= 0) || e.id > lastSeen)
    .forEach(send);

  const unsub = logBus.subscribe(send);

  // heartbeat: named 'ping' event every 15s. Dual role:
  //  1) keeps the connection alive against the idle-timeout (NAT/proxy/browser);
  //  2) the client SEES it (a named event, unlike a comment : ping) and resets the
  //     watchdog — otherwise a half-open socket (sleep, upstream recycling in
  //     nginx-proxy-manager) went unnoticed and the console silently stalled.
  // Without an id: the ping doesn't move Last-Event-ID, so the replay stays correct.
  const heartbeat = setInterval(() => {
    if (res.writableEnded) return;
    try {
      res.write('event: ping\ndata: {}\n\n');
    } catch {}
  }, 15000);

  req.on('close', () => {
    clearInterval(heartbeat);
    unsub();
  });
});

module.exports = router;
