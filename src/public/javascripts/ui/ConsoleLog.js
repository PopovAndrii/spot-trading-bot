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
    this.lastId = 0; // id последней показанной записи — для replay/дедупа после reconnect

    this.#restoreOpen();
    this.#setupToggle();
    this.#renderFilters();
    this.#connect();

    // Пара отменена/удалена (CancelAllOrders) — убрать её вкладку-фильтр и записи
    // из консоли, как она уходит из меню навигации.
    window.addEventListener('pair-removed', (e) => this.#removeSymbol(e.detail?.symbol));
  }

  #removeSymbol(symbol) {
    if (!symbol || !this.symbols.has(symbol)) return;
    this.symbols.delete(symbol);
    this.entries = this.entries.filter((e) => e.symbol !== symbol);
    // если активен фильтр удалённого символа — вернуться на ALL; иначе сохранить
    // текущий. #setFilter перерисует и кнопки-фильтры, и содержимое.
    this.#setFilter(this.filter === symbol ? null : this.filter);
  }

  #restoreOpen() {
    if (localStorage.getItem(LS_OPEN) === 'true') {
      this.consoleEl.classList.add('console--open');
    }
  }

  #setupToggle() {
    this.toggleEl?.addEventListener('click', (e) => {
      // клик по инфо о git-сборке только выделяет текст, не трогает консоль
      if (e.target.closest('#app-version')) return;
      const isOpen = this.consoleEl.classList.toggle('console--open');
      localStorage.setItem(LS_OPEN, isOpen);
    });
  }

  // Liveness: 45с = 3 пропущенных heartbeat'а (сервер шлёт ping каждые 15с).
  #WATCHDOG_MS = 45000;

  #connect() {
    // ручной reconnect создаёт новый EventSource — браузер НЕ шлёт Last-Event-ID
    // (это делает только его внутренний reconnect того же объекта). Передаём id
    // сами в query, чтобы сервер реплеил лишь новое.
    const url = this.lastId ? `/api/logs?lastEventId=${this.lastId}` : '/api/logs';
    const es = new EventSource(url);
    this.es = es;

    es.onmessage = (e) => {
      this.#kickWatchdog();
      try { this.#add(JSON.parse(e.data)); } catch { }
    };

    // heartbeat виден как именованное событие — данных не несёт, только
    // подтверждает, что канал жив, и сбрасывает watchdog.
    es.addEventListener('ping', () => this.#kickWatchdog());

    // штатный обрыв: EventSource сам переподключается, пока readyState !== CLOSED.
    // Если он сдался (CLOSED) — пересоздаём вручную.
    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED) this.#reconnect();
    };

    this.#kickWatchdog();
  }

  // Полуоткрытый сокет (sleep ноутбука, рециклинг upstream прокси) браузер не
  // замечает: readyState остаётся OPEN, onerror не стреляет, авто-reconnect не
  // запускается. Сторожим сами: нет ни лога, ни ping дольше WATCHDOG_MS —
  // принудительно рвём и пересоздаём соединение.
  #kickWatchdog() {
    clearTimeout(this.watchdog);
    this.watchdog = setTimeout(() => this.#reconnect(), this.#WATCHDOG_MS);
  }

  #reconnect() {
    clearTimeout(this.watchdog);
    try { this.es?.close(); } catch { }
    this.#connect();
  }

  #add(entry) {
    // replay истории после reconnect может прислать уже показанные записи —
    // дедуплицируем по монотонному id (см. lib/logBus). lastId двигаем только
    // вперёд, чтобы следующий reconnect просил продолжение, а не дубли.
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

    const show = this.filter === null ||
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
    this.#addClearBtn();
  }

  #addClearBtn() {
    const btn = document.createElement('button');
    btn.className = 'console__filter console__clear';
    btn.textContent = 'Clear';
    btn.title = 'Очистить логи текущего фильтра';
    btn.addEventListener('click', () => this.#clearCurrent());
    this.filtersEl.appendChild(btn);
  }

  // Deletes only entries that match the active filter; the rest are preserved.
  #clearCurrent() {
    if (this.filter === '__sys__') {
      this.entries = this.entries.filter(e => e.symbol !== null);
    } else if (this.filter) {
      this.entries = this.entries.filter(e => e.symbol !== this.filter);
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
