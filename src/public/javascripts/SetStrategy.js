import { syncSpinBoxButtons } from './ui/spinboxSync.js';

export class SetStrategy {
  constructor(notifications) {
    this.notifications = notifications;

    this.#getStaticText();

    const strategyGroup = document.querySelector('.UIbg');

    strategyGroup.addEventListener('ui-button-group-change', (e) => {
      const { id, value } = e.detail;

      this.notifications.showNotification(`The strategy chosen is: <b>${id}</b>`, 'success', 15000);

      const url = new URL(window.location.href);
      const base = url.searchParams.get('base');
      const quote = url.searchParams.get('quote');
      this.strategyName = id;
      this.#getStrategyData(base, quote);
    });

    this.#indentFromPrice();
  }

  getStrategy() {
    if (this.strategyName) return this.strategyName;
    const checked = document.querySelector('input[name="strategy"]:checked');
    return checked ? checked.value : null;
  }

  #indentFromPrice() {
    document.querySelector('#field-indent').addEventListener('input', () => {
      const indent = document.querySelector('#field-indent');
      const tickSize = document.querySelector('#field-tickSize').value;
      const currency = document.querySelector('#field-currency').value;
      const strategy = document.querySelector('#field-strategy').value;

      const resultPrice =
        strategy == 'long'
          ? currency * (1 - indent.value / 100)
          : currency * (1 + indent.value / 100);

      const parent = indent.closest('.UIsp');
      parent.querySelector('.UIsp-label').innerHTML =
        `${this.text.fieldLabel} ${resultPrice.toFixed(tickSize)}`;
    });
  }

  async #getStrategyData(base, quote) {
    try {
      const response = await fetch(
        `/spotbot/${base + quote}?symbol=${base + quote}&base=${base}&quote=${quote}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: this.strategyName }),
        }
      );

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      this.#setSettings(data.symbol);
    } catch (err) {
      console.error('Error:', err);
    }
  }

  #setSettings(data = {}) {
    const defaultData = {
      'field-currency': data['price'],
      'field-strategy': this.strategyName,
      'field-deposit': data['balance'], //1.074 0.00417, // 430$
      'field-orderSize': data['minNotional'], // 0.028, // >= 10$
      'info-minQuoteAsset': '(min: ' + data['minQuoteAsset'] + ' ' + data['quoteAsset'] + ')',
      'field-profit': 0.4, // %
      'field-commission': 0.20, // %
      'field-fibonachiStep': 0.6,
      'field-martingail': 68, // %
      'field-indent': 0.1, // %
      'field-activeOrders': 3,
      'field-requestFrequency': 1500, // ms
      'field-stepSize': data['stepSize'],
      'field-tickSize': data['tickSize'],
    };

    const orderSizeLabel = document.querySelector('#field-orderSize');
    const parent = orderSizeLabel.closest('.UIsp');
    parent.querySelector('.UIsp-label').innerHTML =
      `${this.text.fieldSizeLabel} ${defaultData['info-minQuoteAsset']}`;

    const all = document.querySelectorAll('[id^="field-"]');
    all.forEach((el) => {
      document.getElementById(el.id).value = defaultData[el.id];
    });

    syncSpinBoxButtons();
  }

  #getStaticText() {
    const fieldSizeLabel = document.querySelector('#field-orderSize');
    const parentFieldSizeLabel = fieldSizeLabel.closest('.UIsp');

    const fieldLabel = document.querySelector('#field-indent');
    const parentFieldLabel = fieldLabel.closest('.UIsp');
    // parentFieldLabel.querySelector('.UIsp-label').innerHTML = resultPrice.toFixed(tickSize);

    this.text = {
      fieldSizeLabel: parentFieldSizeLabel.querySelector('.UIsp-label').innerHTML,
      fieldLabel: parentFieldLabel.querySelector('.UIsp-label').innerHTML,
    };
  }
}
