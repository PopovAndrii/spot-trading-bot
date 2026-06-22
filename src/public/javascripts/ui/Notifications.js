// Thin adapter over @popovandrii/ui-elements Toast (UMD global `UiElements`).
// Keeps the historical showNotification()/fetchWithHandling() API so existing
// call sites keep working while the bespoke renderer is gone. Migrate call
// sites to the toast manager directly later, then drop this shim.
export class Notifications {
  constructor() {
    this.msgDefault = {
      '404-': '🟡 Not found',
      '500-': '🟥 Server error',
      'net-': '🔌 Network error',
      'err-': '⚠️ some Error',
    };

    // Old container lived bottom-right; keep that. maxVisible defaults to 0
    // (unlimited), matching the previous behaviour.
    this.toast = UiElements.getToastManager({ position: 'bottom-right' });
  }

  async fetchWithHandling(url, options = {}, msg = {}) {
    this.msg = Object.assign(this.msgDefault, msg);

    try {
      const res = await fetch(url, options);

      if (!res.ok) {
        const errData = await res.json().catch(() => ({})); // if !JSON

        switch (res.status) {
          case 404:
            this.showNotification(this.msg['404-'], 'warning', 10000);
            break;
          case 500:
            this.showNotification(this.msg['500-'], 'danger', 10000);
            break;
          default:
            this.showNotification(
              `${this.msg['err-']} (${res.status}): ${errData.message || 'default error'}`
            );
            break;
        }
        return { data: {}, message: '' };
      }

      return await res.json();
    } catch (err) {
      this.showNotification(`${this.msg['net-']}: + ${err}`, 15000);
      return null;
    }
  }

  showNotification(msg, type = '', duration = 5000) {
    const known = ['danger', 'info', 'success', 'primary', 'warning'];
    // Unknown/empty type → neutral 'default' (also absorbs the legacy
    // net-error call that passes a number into the type slot).
    const t = known.includes(type) ? type : 'default';

    // html: true preserves the previous innerHTML rendering (messages use
    // <b>/<br>). Migrate per call site to plain text when switching to the
    // toast manager directly.
    this.toast.show(msg, { type: t, duration, html: true });
  }
}
