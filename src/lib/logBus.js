const MAX = 200;
const entries = [];
const clients = new Set();

function log(msg) {
  try {
    const entry = { t: Date.now(), msg: String(msg) };
    entries.push(entry);
    if (entries.length > MAX) entries.shift();
    clients.forEach(fn => { try { fn(entry); } catch {} });
  } catch {}
}

function subscribe(fn) {
  clients.add(fn);
  return () => clients.delete(fn);
}

function history() {
  return [...entries];
}

// Убрать из истории записи отменённой пары, иначе при перезагрузке страницы
// replay history() снова создаст её вкладку-фильтр в консоли интерфейса.
function clearSymbol(symbol) {
  if (!symbol) return;
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].msg.includes(symbol)) entries.splice(i, 1);
  }
}

module.exports = { log, subscribe, history, clearSymbol };
