import { confirmDialog } from './ui/confirmDialog.js';

export class CancelAllOrders {
  constructor(notifications, deleteCurrentSeries) {
    this.listenerStatus = true;

    this.notifications = notifications;
    this.deleteCurrentSeries = deleteCurrentSeries;

    new UiElements.Button();

    const orders = document.getElementById('cancel-all-orders');
    orders?.addEventListener('ui-button-change', async (e) => {
      if (this.getListenerStatus()) {
        // Cancel-All wipes every active order on the pair — guard with a confirm.
        const ok = await confirmDialog({
          title: 'Cancel ALL orders?',
          message: `Every active order on ${e.target.dataset.value} will be cancelled on the exchange.`,
          confirmLabel: 'Cancel all',
          danger: true,
        });
        if (!ok) return;

        e.target.disabled = false;
        this.cancel(e.target.dataset.value);
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
        this.notifications.showNotification(
          `${data.message} active orders cancelled per pair ${currency}`,
          'success'
        );
        this.deleteCurrentSeries?.enable();
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
