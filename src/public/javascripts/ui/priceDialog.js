// Price editor dialog (Item 10). Like confirmDialog, but hosts a ui-elements
// SpinBox so the user can dial a new price with +/- and Apply. Lives OUTSIDE the
// live orders table, so the per-tick table re-render can't reset the in-progress
// value (the reason the inline-in-row SpinBox was abandoned). Resolves to the
// entered price string, or null if dismissed (Escape / backdrop / Cancel).
export function priceDialog({
  title = 'Re-place order',
  message = '',
  price = '',
  originalPrice = '',
  step = '0.01',
  decimals = 2,
  confirmLabel = 'Re-place',
  cancelLabel = 'Cancel',
} = {}) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'UIconfirm-overlay';
    overlay.innerHTML = `
      <div class="UIconfirm" role="dialog" aria-modal="true" aria-label="${title}">
        <div class="UIconfirm__title">${title}</div>
        ${message ? `<div class="UIconfirm__msg">${message}</div>` : ''}
        <div class="UIconfirm__field">
          ${originalPrice ? `<span class="UIconfirm__orig" title="starting price">${originalPrice}</span>` : ''}
          <span class="UIsp lg round" data-step="${step}" data-min="0" data-max="100000000" data-decimals="${decimals}" role="spinbutton" tabindex="0" aria-label="New price">
            <button class="UIsp__btn" type="button" aria-label="Decrease value">−</button>
            <input class="UIsp__input" type="text" value="${price}" inputmode="decimal">
            <button class="UIsp__btn" type="button" aria-label="Increase value">+</button>
          </span>
        </div>
        <div class="UIconfirm__actions">
          <button type="button" class="UIb sm" data-confirm="no">${cancelLabel}</button>
          <button type="button" class="UIb sm primary" data-confirm="yes">${confirmLabel}</button>
        </div>
      </div>`;

    const input = overlay.querySelector('.UIsp__input');

    const close = (result) => {
      document.removeEventListener('keydown', onKey);
      overlay.remove();
      resolve(result);
    };
    const apply = () => close(input ? input.value : null);
    const onClick = (e) => {
      if (e.target === overlay) return close(null); // backdrop
      const btn = e.target.closest('[data-confirm]');
      if (!btn) return; // SpinBox +/- and input clicks stay inside the dialog
      if (btn.dataset.confirm === 'yes') apply();
      else close(null);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') close(null);
      else if (e.key === 'Enter') apply();
    };

    overlay.addEventListener('click', onClick);
    document.addEventListener('keydown', onKey);
    document.body.appendChild(overlay);

    // wire the ui-elements SpinBox inside the freshly inserted dialog so +/-
    // and keyboard work; scan() skips already-bound nodes elsewhere.
    window.UiElements?.getSpinBoxManager?.().scan();
    input?.focus();
    input?.select();
  });
}
