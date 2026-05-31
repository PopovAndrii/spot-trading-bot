import { Theme } from './ui/Theme.js';

new UiElements.Select();
new UiElements.Button();
new Theme();

const btn = document.getElementById('sendCurrency');
let navigateUrl = null;

document.getElementById('selectCurrency')?.addEventListener('ui-select-change', (e) => {
  const { value } = e.detail;
  const symbol = value?.split('?')[0] ?? '';

  navigateUrl = value ? `/spotbot/${value}` : null;
  btn.dataset.value = symbol;
  btn.querySelector('.btn-label').textContent = symbol || 'Select currency!';

  if (value) {
    btn.removeAttribute('aria-disabled');
  } else {
    btn.setAttribute('aria-disabled', 'true');
  }
});

btn?.addEventListener('ui-button-change', () => {
  console.log('test')
  if (navigateUrl) window.location.href = navigateUrl;
});

// Проверка пары ключей (real | test): подписанный запрос делает сервер.
document.querySelectorAll('[data-check]').forEach((button) => {
  button.addEventListener('ui-button-change', async (e) => {
    const env = e.detail.value;
    const status = button.closest('.api-keys__group').querySelector('.api-keys__status');

    button.disabled = true;
    button.classList.remove('success', 'danger');
    if (status) status.textContent = 'checking…';

    try {
      const res = await fetch('/check-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ env }),
      });
      const data = await res.json();

      button.classList.add(data.success ? 'success' : 'danger');
      if (status) {
        status.textContent = data.success
          ? `✅ valid${data.canTrade === false ? ' (canTrade: no)' : ''}`
          : `❌ ${data.message || 'invalid'}`;
      }
    } catch (err) {
      button.classList.add('danger');
      if (status) status.textContent = `❌ ${err.message}`;
    } finally {
      button.disabled = false;
    }
  });
});
