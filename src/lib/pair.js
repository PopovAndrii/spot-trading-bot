const statusPair = Object.freeze({
  NEW: 0,
  START: 1,
  STOP: 2,
  // Сервер рестартовал, а в конфиге остались живые ордера (NEW/PARTIALLY_FILLED
  // с orderId): цикл по ним НЕ идёт, Save заблокирован до явного Start (resume)
  // или отмены ордеров (ANALYSIS.md п.1.5).
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
      // повторный subscribe не должен затирать статус (например ATTENTION,
      // выставленный recovery-сканом до первого подключения клиента)
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
  // live order-state file (req 15). Unknown symbol → not running.
  isRunning(symbol) {
    return this.symbols.get(symbol)?.status === statusPair.START;
  }

  // Символ помечен recovery-сканом: живые ордера без работающего цикла.
  needsAttention(symbol) {
    return this.symbols.get(symbol)?.status === statusPair.ATTENTION;
  }
}

const pair = new Pair();

module.exports = { pair, statusPair };
