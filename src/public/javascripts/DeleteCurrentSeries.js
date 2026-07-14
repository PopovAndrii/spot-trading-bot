import { confirmDialog } from './ui/confirmDialog.js';

export class DeleteCurrentSeries {
  constructor(notifications) {
    this.notifications = notifications;

    new UiElements.Button();

    const btn = document.getElementById('delete-current-series');
    btn?.addEventListener('ui-button-change', async (e) => {
      // Deleting the series file is irreversible — guard with a confirm.
      const ok = await confirmDialog({
        title: 'Delete current series?',
        message: `The saved series for ${e.target.dataset.value} will be permanently removed.`,
        confirmLabel: 'Delete',
        danger: true,
      });
      if (!ok) return;

      this.delete(e.target.dataset.value);
    });
  }

  // Enabled only after Cancel all orders — otherwise the pair may have live orders,
  // and the series file can't be deleted (the backend re-checks the exchange and refuses anyway).
  enable() {
    const btn = document.getElementById('delete-current-series');
    if (btn) btn.disabled = false;
  }

  disable() {
    const btn = document.getElementById('delete-current-series');
    if (btn) btn.disabled = true;
  }

  async delete(currency) {
    try {
      const res = await fetch('/spotbot/series/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: currency }),
      });

      const data = await res.json();

      if (data.success) {
        this.notifications.showNotification(data.message, 'success');
        this.disable();
        // The series file was deleted on the backend — re-read the navigation menu
        // (the pair leaves) and remove its filter tab from the console, without a page reload.
        window.fetchActiveSymbols?.();
        window.dispatchEvent(new CustomEvent('pair-removed', { detail: { symbol: currency } }));
      } else {
        this.notifications.showNotification(data.message, 'danger');
      }
    } catch (err) {
      console.error('❌ deleteCurrentSeries():', err);
      this.notifications.showNotification(err.message, 'danger');
      return null;
    }
  }
}
