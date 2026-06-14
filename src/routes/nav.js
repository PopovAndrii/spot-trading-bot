const express = require('express');
const router = express.Router();
const fs = require('fs/promises');
const path = require('path');

const { pair, statusPair } = require('../lib/pair');
const logBus = require('../lib/logBus');
const buildInfo = require('../lib/buildInfo');
const { isTestnet, requestedTestnet } = require('../lib/runMode');

// Источник правды для меню навигации — файлы текущих серий на диске
// (SYMBOL-binance.json). Пара видна в меню, пока её файл существует; кнопка
// Cancel All Orders удаляет файл — пара уходит из меню. Ручные ордера на бирже
// файла не создают, поэтому в меню робота не попадают (в отличие от опроса
// openOrders, который захватил бы и ручную спот-покупку).
const DATA_DIR = path.join(__dirname, '../data');
const ARCHIVE_RE = /^\d+-/; // {timestamp}-SYMBOL-binance.json — архив серии, не текущая
const SERIES_SUFFIX = '-binance.json';

router.get('/symbols', async (req, res) => {
  try {
    const files = await fs.readdir(DATA_DIR).catch(() => []);
    // статус (running/pause/attention) живёт в памяти; для пар, которых в карте
    // нет (не подписаны в этой сессии, но файл на диске есть), показываем pause.
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

// Идентификатор сборки для футера (version + commit + dirty + время старта).
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

  const send = (e) => {
    if (res.writableEnded) return;
    try { res.write(`data: ${JSON.stringify(e)}\n\n`); } catch { }
  };

  logBus.history().forEach(send);

  const unsub = logBus.subscribe(send);

  // heartbeat: an SSE comment every 15s. Keeps the connection alive so an idle
  // timeout (NAT/proxy/browser) won't drop it. If the socket is dead anyway,
  // write throws / 'close' fires, and the client's EventSource reconnects.
  const heartbeat = setInterval(() => {
    if (res.writableEnded) return;
    try { res.write(`: ping\n\n`); } catch { }
  }, 15000);

  req.on('close', () => {
    clearInterval(heartbeat);
    unsub();
  });
});

module.exports = router;
