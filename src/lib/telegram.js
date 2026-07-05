const https = require('https');

// Telegram trade notifier. Disabled (a no-op) unless both TELEGRAM_BOT_TOKEN and
// TELEGRAM_CHAT_ID are present in the environment — so existing installs behave
// exactly as before until the user opts in via src/.env.
//
// Fire-and-forget: send() never throws and never blocks the trading loop. A
// failed send is logged to the console and swallowed — a notification outage must
// not affect trading.

function enabled() {
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

module.exports = { send, enabled };
