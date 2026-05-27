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
