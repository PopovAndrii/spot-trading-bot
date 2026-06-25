const fs = require('fs/promises');
const path = require('path');

// An order is "live" = placed on the exchange and not yet at a final status.
const LIVE_STATES = new Set(['NEW', 'PARTIALLY_FILLED']);

// Archives like {timestamp}-SYMBOL-exchange.json are written by autoRestart — skip.
const ARCHIVE_RE = /^\d+-/;

/**
 * Scans the data/ directory for configs with live orders (NEW/PARTIALLY_FILLED
 * with an orderId). Such orders hang on the exchange, but after a server restart
 * the cycle doesn't walk them and the Save write-lock isn't in effect — a file
 * with live orderIds could be silently overwritten (ANALYSIS.md item 1.5).
 *
 * @param {string} dataDir - absolute path to the data/ directory.
 * @returns {Promise<Array<{symbol:string, file:string, liveOrders:number}>>}
 */
async function scanLiveCycles(dataDir) {
  let files;
  try {
    files = await fs.readdir(dataDir);
  } catch {
    return []; // no directory — nothing to recover
  }

  const found = [];

  for (const file of files) {
    if (!file.endsWith('.json') || ARCHIVE_RE.test(file)) continue;

    try {
      const data = JSON.parse(await fs.readFile(path.join(dataDir, file), 'utf8'));

      // A finished cycle (Status.DONE) doesn't count as live: the final
      // cancelOpenOrders already pulled the safety orders on the exchange. In old
      // files their statuses might have stayed NEW (before the markOpenAsCanceled
      // fix) — don't raise a false ATTENTION for them.
      if (data.status === 3 /* Status.DONE */) continue;

      const orders = [...(data.BUY || []), ...(data.SELL || [])];
      const live = orders.filter(
        (o) => o && o.orderId != null && LIVE_STATES.has(o.status)
      );

      if (live.length > 0) {
        // symbol from the pair field or from the file name SYMBOL-exchange.json
        const symbol = String(data.pair || file.split('-')[0]).toUpperCase();
        found.push({ symbol, file, liveOrders: live.length });
      }
    } catch {
      // a corrupt/partially-read file must not crash server startup
    }
  }

  return found;
}

module.exports = { scanLiveCycles, LIVE_STATES };
