const statusPair = Object.freeze({
  NEW: 0,
  START: 1,
  STOP: 2,
  // The server restarted while the config still has live orders (NEW/PARTIALLY_FILLED
  // with an orderId): no cycle walks them, Save is locked until an explicit Start
  // (resume) or the orders are canceled.
  ATTENTION: 3,
});

class Pair {
  constructor() {
    this.symbols = new Map();
  }

  addSymbol(obj = {}) {
    if (!obj.symbol) return;
    const existing = this.symbols.get(obj.symbol);
    if (existing) {
      // a repeated subscribe must not overwrite the status (e.g. ATTENTION set by
      // the recovery scan before the client first connected)
      this.symbols.set(obj.symbol, { ...obj, status: existing.status });
      return;
    }
    this.symbols.set(obj.symbol, obj);
  }

  deleteSymbol(symbol) {
    this.symbols.delete(symbol);
  }

  updateSymbol(obj = {}) {
    if (!obj.symbol) return;
    const existing = this.symbols.get(obj.symbol);
    if (existing) {
      this.symbols.set(obj.symbol, { ...existing, ...obj });
    }
  }

  getActiveSymbols() {
    return Array.from(this.symbols.values());
  }

  // Authoritative "is the bot running for this symbol" check, shared between the
  // WS router (which sets START/STOP) and HTTP routes that must not overwrite a
  // live order-state file. Unknown symbol → not running.
  isRunning(symbol) {
    return this.symbols.get(symbol)?.status === statusPair.START;
  }

  // Symbol flagged by the recovery scan: live orders with no running cycle.
  needsAttention(symbol) {
    return this.symbols.get(symbol)?.status === statusPair.ATTENTION;
  }
}

const pair = new Pair();

module.exports = { pair, statusPair };
