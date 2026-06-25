// Session inactivity guard: a countdown indicator + auto-logout.
// On user activity it extends the rolling session with a ping to the server.
export class SessionGuard {
  constructor() {
    this.maxAgeMs = null;
    this.lastActivity = Date.now();
    this.lastPing = 0;
    this.pingThrottleMs = 5 * 60 * 1000; // no more than once every 5 minutes
    this.warnBeforeMs = 5 * 60 * 1000; // highlight 5 minutes before the end
    this.indicator = document.getElementById('session-timer');

    this.#init();
  }

  async #init() {
    let info;
    try {
      const res = await fetch('/api/session', { headers: { Accept: 'application/json' } });
      if (!res.ok) return; // not authorized / redirect to /login
      info = await res.json();
    } catch {
      return;
    }

    if (!info.enabled || !info.maxAge) return; // login disabled

    this.maxAgeMs = info.maxAge;

    const onActivity = () => this.#registerActivity();
    ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'click'].forEach((ev) =>
      window.addEventListener(ev, onActivity, { passive: true })
    );

    setInterval(() => this.#tick(), 1000);
    this.#tick();
  }

  #registerActivity() {
    this.lastActivity = Date.now();

    if (Date.now() - this.lastPing > this.pingThrottleMs) {
      this.lastPing = Date.now();
      fetch('/api/session/ping').catch(() => {});
    }
  }

  #tick() {
    const remaining = this.maxAgeMs - (Date.now() - this.lastActivity);

    if (remaining <= 0) {
      window.location.href = '/login/logout';
      return;
    }

    if (this.indicator) {
      const totalSec = Math.floor(remaining / 1000);
      const mm = String(Math.floor(totalSec / 60)).padStart(2, '0');
      const ss = String(totalSec % 60).padStart(2, '0');
      this.indicator.hidden = false;
      this.indicator.textContent = `${mm}:${ss}`;
      this.indicator.classList.toggle('session-timer--warn', remaining <= this.warnBeforeMs);
    }
  }
}
