const statusPair = Object.freeze({
  NEW: 0,
  START: 1,
  STOP: 2,
});

class Pair {
  constructor() {
    this.symbols = new Map();
  }

  addSymbol(obj = {}) {
    if (!obj.symbol) return;
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
}

const pair = new Pair();

module.exports = { pair, statusPair };
