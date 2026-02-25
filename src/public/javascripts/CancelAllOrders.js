export class CancelAllOrders {
  constructor(notifications) {
    this.listenerStatus = true;

    this.notifications = notifications;

    const orders = document.getElementById('cancel-all-orders');
    orders.addEventListener('click', () => {
      if (this.getListenerStatus()) {
        this.cancel(base + quote);
      } else {
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
        this.notifications.showNotification(`Order ${currency} canceled`, 'success');
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
