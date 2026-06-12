// Footer: live clock + server online/offline status + network indicator (testnet/real).
export class FooterStatus {
  constructor() {
    this.dot = document.getElementById('ping-dot');
    this.timeEl = document.getElementById('ping-time');
    this.netEl = document.getElementById('net-label');
    this.noInternetEl = document.getElementById('no-internet');
    this.versionEl = document.getElementById('app-version');
    if (!this.dot || !this.timeEl) return;

    this.#loadVersion();

    this.offset = 0;
    this.online = false;

    this.#setInternet(navigator.onLine);
    window.addEventListener('online', () => this.#setInternet(true));
    window.addEventListener('offline', () => this.#setInternet(false));

    setInterval(() => this.#tickClock(), 1000);
    setInterval(() => this.#ping(), 5000);
    this.#ping();
  }

  // Сборка не меняется в рамте процесса — тянем один раз. Формат: v1.1.0 · 2d6115a* · 14:32
  // (звёздочка = незакоммиченные изменения; время — когда сервер поднят).
  async #loadVersion() {
    if (!this.versionEl) return;
    try {
      const res = await fetch('/api/version');
      if (!res.ok) return;
      const { version, branch, commit, dirty, startedAt } = await res.json();

      const t = new Date(startedAt);
      const hhmm = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
      const rev = `${branch ? branch + '@' : ''}${commit}${dirty ? '*' : ''}`;
      this.versionEl.textContent = `v${version} · ${rev} · ${hhmm}`;
      this.versionEl.title = `version ${version} · ${branch ? 'branch ' + branch + ' · ' : ''}commit ${commit}${dirty ? ' (dirty)' : ''} · started ${t.toLocaleString()}`;
    } catch {
      /* футер без версии не критичен */
    }
  }

  async #ping() {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 4000);
      const res = await fetch('/api/ping', { signal: ctrl.signal });
      clearTimeout(t);
      if (!res.ok) throw new Error('bad status');

      const data = await res.json();
      this.offset = data.time - Date.now();
      this.#setOnline(true);
      this.#setNetwork(data.network, data.fallback);
    } catch {
      this.#setOnline(false);
    }
  }

  #tickClock() {
    const now = new Date(Date.now() + this.offset);
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    this.timeEl.textContent = `${hh}:${mm}:${ss}`;
  }

  #setOnline(state) {
    this.online = state;
    this.dot.classList.toggle('ping-dot--on', state);
    this.dot.classList.toggle('ping-dot--off', !state);
    this.dot.title = state ? 'Server online' : 'Server offline';
  }

  #setInternet(state) {
    if (!this.noInternetEl) return;
    this.noInternetEl.hidden = state;
  }

  #setNetwork(network, fallback = false) {
    if (!this.netEl || !network) return;
    // fallback: REAL, but we’re running on TESTNET without keys — explicitly showing
    this.netEl.textContent = fallback
      ? 'REAL → TESTNET (no keys)'
      : network === 'real' ? 'REAL' : 'TESTNET';
    this.netEl.title = fallback
      ? 'REAL is selected, but REAL keys are not specified — running on TESTNET'
      : '';
    this.netEl.classList.toggle('net-label--real', network === 'real' && !fallback);
    this.netEl.classList.toggle('net-label--testnet', network !== 'real');
    this.netEl.classList.toggle('net-label--fallback', fallback);
  }
}
