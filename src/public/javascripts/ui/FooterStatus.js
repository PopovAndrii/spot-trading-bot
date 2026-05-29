// Футер: живые часы + онлайн/офлайн статус сервера + индикация сети (testnet/real).
export class FooterStatus {
  constructor() {
    this.dot = document.getElementById('ping-dot');
    this.timeEl = document.getElementById('ping-time');
    this.netEl = document.getElementById('net-label');
    this.noInternetEl = document.getElementById('no-internet');
    if (!this.dot || !this.timeEl) return;

    this.offset = 0;
    this.online = false;

    this.#setInternet(navigator.onLine);
    window.addEventListener('online', () => this.#setInternet(true));
    window.addEventListener('offline', () => this.#setInternet(false));

    setInterval(() => this.#tickClock(), 1000);
    setInterval(() => this.#ping(), 5000);
    this.#ping();
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
      this.#setNetwork(data.network);
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
    this.dot.title = state ? 'Сервер онлайн' : 'Сервер офлайн';
  }

  #setInternet(state) {
    if (!this.noInternetEl) return;
    this.noInternetEl.hidden = state;
  }

  #setNetwork(network) {
    if (!this.netEl || !network) return;
    this.netEl.textContent = network === 'real' ? 'REAL' : 'TESTNET';
    this.netEl.classList.toggle('net-label--real', network === 'real');
    this.netEl.classList.toggle('net-label--testnet', network !== 'real');
  }
}
