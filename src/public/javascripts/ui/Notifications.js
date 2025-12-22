export class Notifications {
  constructor() {
    this.msgDefault = {
      '404-': '🟡 Not found',
      '500-': '🟥 Server error',
      'net-': '🔌 Network error',
      'err-': '⚠️ some Error',
    };
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
    const container = document.getElementById('notifications');
    const notification = document.createElement('div');

    notification.className = `notification ${type}`;

    var dateTime = '';
    if (duration === false) {
      dateTime = `<i>${this.#date()}</i>`;
    }

    notification.innerHTML = `${dateTime} ${msg}<button onclick="this.parentElement.remove()">×</button>`;

    container.appendChild(notification);

    if (duration !== false) {
      setTimeout(() => {
        if (notification.parentElement) {
          notification.remove();
        }
      }, duration);
    }
  }

  #date() {
    const now = new Date();

    const day = String(now.getDate()).padStart(2, '0');
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');

    return `${month}.${day} ${hours}:${minutes}:${seconds}`;
  }
}
