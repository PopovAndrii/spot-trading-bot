import { Theme } from './ui/Theme.js';

new Theme();

new UiElements.Select();

const select = document.getElementById('selectCurrency');
select?.addEventListener('ui-select-change', (e) => {
  const value = e.detail?.val;

  const [symbol, queryString] = value.split('?');

  const btn = document.getElementById('sendCurrency');

  if (value || symbol) {
    btn.classList.remove('disabled');
    btn.removeAttribute('aria-disabled');
    btn.href = `/spotbot/${value}`;
    btn.innerText = symbol;
  } else {
    btn.classList.add('disabled');
    btn.setAttribute('aria-disabled', 'true');
    btn.href = `/#`;
    btn.innerHTML = `<svg class="icon">
                      <use href="/sprite.svg#bun"></use>
                    </svg>Select currency!`;
  }
});

const link = document.getElementById('sendCurrency');
link.addEventListener('click', function (e) {
  if (this.getAttribute('aria-disabled') === 'true') {
    e.preventDefault();
  }
});
