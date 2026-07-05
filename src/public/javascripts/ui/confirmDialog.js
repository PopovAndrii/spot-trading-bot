// Reusable "Are you sure?" confirmation dialog. Returns a Promise that
// resolves to true (confirmed) or false (dismissed). Self-contained: builds an
// overlay, wires keyboard (Enter = confirm, Escape/backdrop = dismiss) and
// removes itself on choice. Buttons reuse ui-elements `UIb` classes for styling
// but are driven by a native click (no Button manager needed here).
export function confirmDialog({
  title = 'Are you sure?',
  message = '',
  confirmLabel = 'Yes',
  cancelLabel = 'Cancel',
  danger = false,
} = {}) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'UIconfirm-overlay';
    overlay.innerHTML = `
      <div class="UIconfirm" role="dialog" aria-modal="true" aria-label="${title}">
        <div class="UIconfirm__title">${title}</div>
        ${message ? `<div class="UIconfirm__msg">${message}</div>` : ''}
        <div class="UIconfirm__actions">
          <button type="button" class="UIb sm" data-confirm="no">${cancelLabel}</button>
          <button type="button" class="UIb sm ${danger ? 'danger' : 'primary'}" data-confirm="yes">${confirmLabel}</button>
        </div>
      </div>`;

    const close = (result) => {
      document.removeEventListener('keydown', onKey);
      overlay.remove();
      resolve(result);
    };
    const onClick = (e) => {
      if (e.target === overlay) return close(false); // backdrop click
      const btn = e.target.closest('[data-confirm]');
      if (btn) close(btn.dataset.confirm === 'yes');
    };
    const onKey = (e) => {
      if (e.key === 'Escape') close(false);
      else if (e.key === 'Enter') close(true);
    };

    overlay.addEventListener('click', onClick);
    document.addEventListener('keydown', onKey);
    document.body.appendChild(overlay);
    overlay.querySelector('[data-confirm="yes"]').focus();
  });
}
