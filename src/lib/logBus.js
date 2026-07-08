const MAX = 200;
const entries = [];
const clients = new Set();

// Monotonic entry id (survives the ring buffer's shift). Needed by the SSE channel:
// the client sends Last-Event-ID on reconnect, the server replays only what's new,
// and the client dedups by id (otherwise logs doubled after every reconnect).
let seq = 0;

function log(msg) {
  try {
    const entry = { id: ++seq, t: Date.now(), msg: String(msg) };
    entries.push(entry);
    if (entries.length > MAX) entries.shift();
    clients.forEach((fn) => {
      try {
        fn(entry);
      } catch {}
    });
  } catch {}
}

function subscribe(fn) {
  clients.add(fn);
  return () => clients.delete(fn);
}

function history() {
  return [...entries];
}

// Remove a canceled pair's entries from history, otherwise on a page reload the
// history() replay recreates its filter tab in the UI console.
function clearSymbol(symbol) {
  if (!symbol) return;
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].msg.includes(symbol)) entries.splice(i, 1);
  }
}

module.exports = { log, subscribe, history, clearSymbol };
