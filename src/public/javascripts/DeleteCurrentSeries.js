export class DeleteCurrentSeries {
  constructor(notifications) {
    this.notifications = notifications;

    new UiElements.Button();

    const btn = document.getElementById('delete-current-series');
    btn?.addEventListener('ui-button-change', (e) => {
      this.delete(e.target.dataset.value);
    });
  }

  // Активна только после Cancel all orders — иначе на паре могут висеть ордера,
  // и удалять файл серии нельзя (бэк всё равно перепроверит биржу и откажет).
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
      const res = await fetch(`/spotbot/series/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: currency }),
      });

      const data = await res.json();

      if (data.success) {
        this.notifications.showNotification(data.message, 'success');
        this.disable();
        // Файл серии удалён на бэке — перечитываем меню навигации (пара уходит)
        // и убираем её вкладку-фильтр из консоли, без перезагрузки страницы.
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
