const fs = require('fs/promises');
const path = require('path');

// Ордер «живой» = размещён на бирже и не дошёл до финального статуса.
const LIVE_STATES = new Set(['NEW', 'PARTIALLY_FILLED']);

// Архивы вида {timestamp}-SYMBOL-exchange.json пишет autoRestart — не сканируем.
const ARCHIVE_RE = /^\d+-/;

/**
 * Сканирует каталог data/ на конфиги с живыми ордерами (NEW/PARTIALLY_FILLED
 * с orderId). Такие ордера висят на бирже, но после рестарта сервера цикл по
 * ним не ходит, а write-lock Save не действует — файл с живыми orderId можно
 * молча перезаписать (ANALYSIS.md п.1.5).
 *
 * @param {string} dataDir - абсолютный путь к каталогу data/.
 * @returns {Promise<Array<{symbol:string, file:string, liveOrders:number}>>}
 */
async function scanLiveCycles(dataDir) {
  let files;
  try {
    files = await fs.readdir(dataDir);
  } catch {
    return []; // каталога нет — нечего восстанавливать
  }

  const found = [];

  for (const file of files) {
    if (!file.endsWith('.json') || ARCHIVE_RE.test(file)) continue;

    try {
      const data = JSON.parse(await fs.readFile(path.join(dataDir, file), 'utf8'));

      // Завершённый цикл (Status.DONE) живым не считается: финальный
      // cancelOpenOrders уже снял страховочные ордера на бирже. В старых
      // файлах их статусы могли остаться NEW (до фикса markOpenAsCanceled) —
      // не поднимать по ним ложный ATTENTION.
      if (data.status === 3 /* Status.DONE */) continue;

      const orders = [...(data.BUY || []), ...(data.SELL || [])];
      const live = orders.filter(
        (o) => o && o.orderId != null && LIVE_STATES.has(o.status)
      );

      if (live.length > 0) {
        // symbol из поля pair либо из имени файла SYMBOL-exchange.json
        const symbol = String(data.pair || file.split('-')[0]).toUpperCase();
        found.push({ symbol, file, liveOrders: live.length });
      }
    } catch {
      // битый/недочитанный файл не должен валить старт сервера
    }
  }

  return found;
}

module.exports = { scanLiveCycles, LIVE_STATES };
