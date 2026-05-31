import { syncSpinBoxButtons } from './ui/spinboxSync.js';

export class LoadDataFromFileCalculator {
  constructor(select, notifications, loadDataCalculator, colors) {
    this.selectObjectElement = select;
    this.notifications = notifications;
    this.loadDataCalculator = loadDataCalculator;

    this.orderType = colors;

    document.addEventListener('DOMContentLoaded', () => {
      this.getStateCalculator();
    });

    this.strategyName = null;
  }

  getStrategyName() {
    return this.strategyName ? this.strategyName : null;
  }

  async getStateCalculator() {
    const res = await this.notifications.fetchWithHandling(
      `/spotbot/table/${base + quote}?symbol=${base + quote}&base=${base}&quote=${quote}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: base + quote }),
      },
      { '404-': 'Trading pair settings file not found', '500-': 'Server Error' }
    );

    if (Object.keys(res.data).length === 0) return;
    // console.log(res.data.param['field-strategy']);

    this.strategyName = res.data.param['field-strategy'];

    if (this.strategyName) {
      document.querySelector(`#${this.strategyName}`).checked = true
    }

    if (res.data?.restart) {
      const sw = document.getElementById('settings-calculate-restart');
      const input = sw.querySelector('input');

      if (String(res.data.restart) === 'true') {
        input.checked = true
        input.setAttribute('checked', '')
        sw.setAttribute('aria-checked', 'true');
      } else {
        input.removeAttribute('checked');
        sw.setAttribute('aria-checked', 'false');
        input.checked = false
      }
    }

    this.#fillInData(res.data);
    this.loadDataCalculator.calculate(res.data);
  }

  async #fillInData(obj) {
    const select = document.getElementById('strategyList');
    // set default value on strategi list
    this.loadDataCalculator.ignoreNextSelectChange();
    this.selectObjectElement.setValue(select, obj.param.strategyList)

    if (Object.keys(obj).length === 0) return;

    document.querySelectorAll('[id^="field-"]').forEach((el) => {
      document.getElementById(el.id).value = obj.param[el.id] ? obj.param[el.id] : null;
    });

    syncSpinBoxButtons();

    // table
    obj['BUY'].forEach((el, index) => {
      const row = `<tr>
          <th scope="row">${index + 1}</th>
          <td></td>
          <td>${el.price}</td>
          <td class="${this.orderType[el.status]}">${el.quantity}</td>
          <td class="${this.orderType[obj['SELL'][index].status]}">${obj['SELL'][index].quantity}</td>
          <td>${obj['SELL'][index].price}</td>
          <td></td>
          <td></td>
      </tr>`;
      document.querySelector('#settings-table tbody').innerHTML += row;
    });
  }
}
