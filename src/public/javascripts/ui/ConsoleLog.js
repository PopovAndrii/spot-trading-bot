const LS_OPEN = 'console_open';
const LS_FILTER = 'console_filter';

export class ConsoleLog {
  constructor() {
    this.content = document.getElementById('console-content');
    this.filtersEl = document.getElementById('console-filters');
    this.consoleEl = document.getElementById('console');
    this.toggleEl = document.getElementById('console-toggle');
    if (!this.content || !this.consoleEl) return;

    this.entries = [];
    this.filter = localStorage.getItem(LS_FILTER) ?? null;
    this.symbols = new Set();

    this.es = null;
    this.watchdog = null;
    this.lastId = 0; // id of the last shown entry — for replay/dedup after reconnect

    this.#restoreOpen();
    this.#setupToggle();
    this.#renderFilters();
    this.#connect();

    // Pair canceled/deleted (CancelAllOrders) — remove its filter tab and entries
    // from the console, as it leaves the navigation menu.
    window.addEventListener('pair-removed', (e) => this.#removeSymbol(e.detail?.symbol));
  }

  #removeSymbol(symbol) {
    if (!symbol || !this.symbols.has(symbol)) return;
    this.symbols.delete(symbol);
    this.entries = this.entries.filter((e) => e.symbol !== symbol);
    // if the removed symbol's filter is active — go back to ALL; otherwise keep the
    // current one. #setFilter re-renders both the filter buttons and the content.
    this.#setFilter(this.filter === symbol ? null : this.filter);
  }

  #restoreOpen() {
    if (localStorage.getItem(LS_OPEN) === 'true') {
      this.consoleEl.classList.add('console--open');
      document.body.classList.add('console-open');
    }
  }

  #setupToggle() {
    this.toggleEl?.addEventListener('click', (e) => {
      // a click on the git-build info only selects text, doesn't toggle the console
      if (e.target.closest('#app-version')) return;
      const isOpen = this.consoleEl.classList.toggle('console--open');
      // .wrapper's bottom padding (room for the fixed console) used to key off
      // `body:has(.console--open)` — mobile Firefox failed to make room for it
      // (buttons under the table ended up hidden behind the console, a sliver
      // visible), even though desktop Firefox was fine. A body class avoids
      // depending on :has() support entirely.
      document.body.classList.toggle('console-open', isOpen);
      localStorage.setItem(LS_OPEN, isOpen);
    });
  }

  // Liveness: 45s = 3 missed heartbeats (the server sends ping every 15s).
  #WATCHDOG_MS = 45000;

  #connect() {
    // a manual reconnect creates a new EventSource — the browser does NOT send
    // Last-Event-ID (only its own internal reconnect of the same object does).
    // We pass the id ourselves in the query so the server replays only what's new.
    const url = this.lastId ? `/api/logs?lastEventId=${this.lastId}` : '/api/logs';
    const es = new EventSource(url);
    this.es = es;

    es.onmessage = (e) => {
      this.#kickWatchdog();
      try {
        this.#add(JSON.parse(e.data));
      } catch {}
    };

    // the heartbeat shows up as a named event — it carries no data, only confirms
    // the channel is alive and resets the watchdog.
    es.addEventListener('ping', () => this.#kickWatchdog());

    // normal drop: EventSource reconnects on its own while readyState !== CLOSED.
    // If it gave up (CLOSED) — recreate manually.
    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED) this.#reconnect();
    };

    this.#kickWatchdog();
  }

  // A half-open socket (laptop sleep, upstream proxy recycling) goes unnoticed by
  // the browser: readyState stays OPEN, onerror doesn't fire, auto-reconnect doesn't
  // kick in. We guard it ourselves: no log and no ping for longer than WATCHDOG_MS —
  // force-drop and recreate the connection.
  #kickWatchdog() {
    clearTimeout(this.watchdog);
    this.watchdog = setTimeout(() => this.#reconnect(), this.#WATCHDOG_MS);
  }

  #reconnect() {
    clearTimeout(this.watchdog);
    try {
      this.es?.close();
    } catch {}
    this.#connect();
  }

  #add(entry) {
    // a history replay after reconnect may send already-shown entries — dedup by
    // the monotonic id (see lib/logBus). We move lastId forward only, so the next
    // reconnect asks for the continuation, not duplicates.
    if (entry.id != null) {
      if (this.lastId && entry.id <= this.lastId) return;
      this.lastId = entry.id;
    }

    entry.symbol = this.#parseSymbol(entry.msg);

    this.entries.push(entry);
    if (this.entries.length > 200) this.entries.shift();

    if (entry.symbol && !this.symbols.has(entry.symbol)) {
      this.symbols.add(entry.symbol);
      this.#renderFilters();
    }

    const show =
      this.filter === null ||
      this.filter === entry.symbol ||
      (this.filter === '__sys__' && entry.symbol === null);

    if (show) this.#appendEl(entry);
  }

  #parseSymbol(msg) {
    const m = msg.match(/\b[A-Z]{3,5}(USDT|BTC|ETH|BNB|BUSD)\b/);
    return m ? m[0] : null;
  }

  #setFilter(symbol) {
    this.filter = symbol;
    localStorage.setItem(LS_FILTER, symbol ?? '');
    this.#renderFilters();
    this.content.innerHTML = '';
    let list;
    if (symbol === '__sys__') {
      list = this.entries.filter((e) => e.symbol === null);
    } else if (symbol) {
      list = this.entries.filter((e) => e.symbol === symbol);
    } else {
      list = this.entries;
    }
    list.forEach((e) => this.#appendEl(e));
  }

  #renderFilters() {
    if (!this.filtersEl) return;
    this.filtersEl.innerHTML = '';
    this.#addFilterBtn('ALL', null);
    this.#addFilterBtn('SYS', '__sys__');
    this.symbols.forEach((sym) => this.#addFilterBtn(sym, sym));
    this.#addClearBtn();
  }

  #addClearBtn() {
    const btn = document.createElement('button');
    btn.className = 'console__filter console__clear';
    btn.textContent = 'Clear';
    btn.title = 'Clear logs for the current filter';
    btn.addEventListener('click', () => this.#clearCurrent());
    this.filtersEl.appendChild(btn);
  }

  // Deletes only entries that match the active filter; the rest are preserved.
  #clearCurrent() {
    if (this.filter === '__sys__') {
      this.entries = this.entries.filter((e) => e.symbol !== null);
    } else if (this.filter) {
      this.entries = this.entries.filter((e) => e.symbol !== this.filter);
    } else {
      this.entries = []; // ALL — The current filter covers everything
    }
    this.content.innerHTML = '';
  }

  #addFilterBtn(label, value) {
    const btn = document.createElement('button');
    btn.className = 'console__filter' + (this.filter === value ? ' console__filter--active' : '');
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
    return `[${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}]`;
  }
}
