const https = require('https');

// Telegram trade notifier. Disabled (a no-op) unless both TELEGRAM_BOT_TOKEN and
// TELEGRAM_CHAT_ID are present in the environment — so existing installs behave
// exactly as before until the user opts in via src/.env.
//
// Fire-and-forget: send() never throws and never blocks the trading loop. A
// failed send is logged to the console and swallowed — a notification outage must
// not affect trading.

function enabled() {
  // node --test sets NODE_TEST_CONTEXT in every test process; the container env
  // carries the REAL bot token (.env is container-wide), so without this guard
  // engine-driving tests spam the live chat with fake trade notices.
  if (process.env.NODE_TEST_CONTEXT) return false;
  return Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
}

function send(text) {
  if (!enabled()) return;

  const payload = JSON.stringify({
    chat_id: process.env.TELEGRAM_CHAT_ID,
    text: String(text),
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  });

  const req = https.request(
    {
      hostname: 'api.telegram.org',
      path: `/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
      timeout: 10000,
    },
    (res) => {
      res.resume(); // drain the response so the socket can be reused/closed
    }
  );

  req.on('error', (err) => console.warn('🟡 telegram send failed:', err.message));
  req.on('timeout', () => req.destroy());
  req.write(payload);
  req.end();
}

// Per-symbol line buffers for batched cycle notices. The trading loop pushes one
// line per order event during a single #jobIterator pass, then flushes once — so a
// tick that touches several rungs of BNBUSDT sends ONE message with a shared header
// instead of one message per order. Keyed by symbol because the module is shared
// across all running pairs (each JsonTimerSender is its own instance, but they all
// require this same module). One-off notices (Start/Stop/Restart/Done) keep using
// send() directly and are not batched.
const buffers = new Map();

// Telegram hard limit is 4096 chars per message; keep a margin for the header.
const MAX_LEN = 3800;

// Begin (or reset) a symbol's buffer for one cycle pass. Cheap no-op when disabled.
function open(symbol) {
  if (!enabled()) return;
  buffers.set(symbol, []);
}

// Queue one line for the symbol's current batch. No-op if open() was skipped.
function push(symbol, line) {
  const buf = buffers.get(symbol);
  if (buf) buf.push(String(line));
}

// Emit the symbol's batch as a single framed message, then clear the buffer.
// Silent when the buffer is empty (the common case: most ticks change nothing).
function flush(symbol) {
  const buf = buffers.get(symbol);
  buffers.delete(symbol);
  if (!buf || buf.length === 0) return;

  // Leading space so the batch header lines up with the single messages, which
  // start on a status icon of about that width.
  const header = ` ${symbol}`;

  // Split into chunks so a very busy tick never exceeds Telegram's limit.
  let chunk = [];
  let len = 0;
  const sendChunk = () => {
    if (chunk.length === 0) return;
    send([header, ...chunk].join('\n'));
    chunk = [];
    len = 0;
  };
  for (const line of buf) {
    if (len + line.length + 1 > MAX_LEN) sendChunk();
    chunk.push(line);
    len += line.length + 1;
  }
  sendChunk();
}

module.exports = { send, enabled, open, push, flush };
