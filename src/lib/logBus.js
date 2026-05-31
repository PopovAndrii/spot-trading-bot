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

module.exports = { log, subscribe, history };
