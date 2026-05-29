export class ConsoleLog {
  constructor() {
    this.content = document.getElementById('console-content');
    this.filtersEl = document.getElementById('console-filters');
    if (!this.content) return;

    this.entries = [];
    this.filter = null;
    this.symbols = new Set();

    this.#renderFilters();
    this.#connect();
  }

  #connect() {
    const es = new EventSource('/api/logs');
    es.onmessage = (e) => {
      try { this.#add(JSON.parse(e.data)); } catch {}
    };
  }

  #add(entry) {
    entry.symbol = this.#parseSymbol(entry.msg);

    this.entries.push(entry);
    if (this.entries.length > 200) this.entries.shift();

    if (entry.symbol && !this.symbols.has(entry.symbol)) {
      this.symbols.add(entry.symbol);
      this.#renderFilters();
    }

    if (!this.filter || this.filter === entry.symbol) {
      this.#appendEl(entry);
    }
  }

  #parseSymbol(msg) {
    const m = msg.match(/\b[A-Z]{3,5}(USDT|BTC|ETH|BNB|BUSD)\b/);
    return m ? m[0] : null;
  }

  #setFilter(symbol) {
    this.filter = symbol;
    this.#renderFilters();
    this.content.innerHTML = '';
    let list;
    if (symbol === '__sys__') {
      list = this.entries.filter(e => e.symbol === null);
    } else if (symbol) {
      list = this.entries.filter(e => e.symbol === symbol);
    } else {
      list = this.entries;
    }
    list.forEach(e => this.#appendEl(e));
  }

  #renderFilters() {
    if (!this.filtersEl) return;
    this.filtersEl.innerHTML = '';
    this.#addFilterBtn('ALL', null);
    this.#addFilterBtn('SYS', '__sys__');
    this.symbols.forEach(sym => this.#addFilterBtn(sym, sym));
  }

  #addFilterBtn(label, value) {
    const btn = document.createElement('button');
    const isActive = this.filter === value || (value === '__sys__' && this.filter === '__sys__');
    btn.className = 'console__filter' + (isActive ? ' console__filter--active' : '');
    btn.textContent = label;
    btn.addEventListener('click', () => this.#setFilter(value));
    this.filtersEl.appendChild(btn);
  }

  #appendEl({ t, msg }) {
    const el = document.createElement('div');
    el.className = 'console__line';
    el.textContent = `${this.#fmt(t)} ${msg}`;
    this.content.appendChild(el);

    const { scrollTop, scrollHeight, clientHeight } = this.content;
    if (scrollHeight - scrollTop - clientHeight < 60) {
      this.content.scrollTop = scrollHeight;
    }
  }

  #fmt(ts) {
    const d = new Date(ts);
    return `[${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}]`;
  }
}
