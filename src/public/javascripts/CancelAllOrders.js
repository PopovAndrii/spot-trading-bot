export class CancelAllOrders {
  constructor(notifications) {
    this.listenerStatus = true;

    this.notifications = notifications;

    new UiElements.Button();

    const orders = document.getElementById('cancel-all-orders');
    orders?.addEventListener('ui-button-change', (e) => {
      if (this.getListenerStatus()) {
        e.target.disabled = false;
        this.cancel(e.detail.val);
      } else {
        e.target.disabled = true;

        this.notifications.showNotification(
          'Cancel "all order" is locked. <br>Press the "Stop" button.',
          'warning',
          10000
        );
      }
    });
  }

  setListenerStatus(status = false) {
    this.listenerStatus = status == false ? true : false;
  }

  getListenerStatus() {
    return this.listenerStatus;
  }

  async cancel(currency) {
    try {
      const res = await fetch(`/spotbot/cancel/allorders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: currency }),
      });

      const data = await res.json();

      if (data.success) {
        this.notifications.showNotification(`${data.message} active orders cancelled per pair ${currency}`, 'success');
      } else {
        this.notifications.showNotification(data.message, 'danger');
      }
    } catch (err) {
      console.error('❌ cancelAllOrders():', err);
      this.notifications.showNotification(err.message, 'danger');
      return null;
    }
  }
}
