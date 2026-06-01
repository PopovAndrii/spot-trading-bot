export class LoadDataCalculator {
  constructor(notifications, colors = {}) {
    this.listenerStatus = true;
    this.defaultData = {};
    this.notifications = notifications;
    this._ignoreSelectChange = false;
    this.onRestartChange = null;

    // Change any button settings param
    document.querySelector('#group-spinbox').addEventListener('ui-spinbox-change', (e) => {
      if (this.getListenerStatus()) {
        document.querySelector('#settings-table tbody').innerHTML = '';
        this.getSettings();
        this.strategy = document.getElementById('field-strategy').value;
        this.calculator();
      } else {
        this.notifications.showNotification(
          'Calculator is locked. <br>Press the "Stop" button.',
          'warning',
          3000
        );
      }
    })

    // Change claculate button
    document.querySelector('#settings-calculate').addEventListener('ui-button-change', () => {
      if (this.getListenerStatus()) {
        document.querySelector('#settings-table tbody').innerHTML = '';
        this.getSettings();
        this.strategy = document.getElementById('field-strategy').value;
        this.calculator();
      } else {
        this.notifications.showNotification(
          'Calculator is locked. <br>Press the "Stop" button.',
          'warning',
          10000
        );
      }
    });

    // set algoritm strategy
    const select = document.getElementById('strategyList');
    select?.addEventListener('ui-select-change', (e) => {
      if (this._ignoreSelectChange) {
        this._ignoreSelectChange = false;
        return;
      }

      const hasStrategy = typeof this.strategy === 'string' && this.strategy.length > 0;
      if (!hasStrategy) return;

      if (this.getListenerStatus()) {
        document.querySelector('#settings-table tbody').innerHTML = '';
        this.getSettings();
        this.strategy = document.getElementById('field-strategy').value;
        this.calculator();
      } else {
        this.notifications.showNotification(
          'Calculator is locked. <br>Press the "Stop" button.',
          'warning',
          10000
        );
      }
    });

    this.orderType = colors;
  }

  setListenerStatus(status = false) {
    this.listenerStatus = status == false ? true : false;
  }

  ignoreNextSelectChange() {
    this._ignoreSelectChange = true;
  }

  getListenerStatus() {
    return this.listenerStatus;
  }

  calculate(obj) {
    document.querySelector('#settings-table tbody').innerHTML = '';
    this.getSettings();
    this.strategy = document.getElementById('field-strategy').value;
    this.calculator(obj);
  }

  save() {
    document.getElementById('settings-calculate-save').addEventListener('ui-button-change', () => {
      if (this.getListenerStatus()) {
        this.settingsSave();
      } else {
        this.notifications.showNotification(
          'Save is locked. Press the "Pause" button.',
          'warning',
          10000
        );
      }
    });
  }

  // Chenge button restart
  restart() {
    document.getElementById('settings-calculate-restart').addEventListener('ui-switch-change', (e) => {
      this.addRestartStatus(e.detail.value);
    });
  }

  getSettings() {
    const strategyList = document.querySelector('[id^="strategyList"]');

    const all = [
      ...document.querySelectorAll('[id^="field-"]'),
      strategyList?.querySelector('[name="strategyList"]')
    ].filter(Boolean); // Remove null if element is not found

    all.forEach((el) => {
      const key = el.id || el.getAttribute('name');
      if (key) {
        this.defaultData[key] = el.value;
      }
    });
  }

  #backlight(obj, type, index) {
    if (Object.keys(obj).length === 0) return null;

    return this.orderType[obj[type][index]['status']];
  }

  // Бейдж с РЕАЛЬНЫМ исполнением ордера по смыслу колонки:
  //   kind 'price' → реальная средняя цена (cummulativeQuoteQty / executedQty)
  //   kind 'qty'   → реально исполненный объём (executedQty)
  // Показываем только если ордер реально что-то исполнил (executedQty > 0).
  #fillBadge(obj, type, index, kind) {
    if (!obj || Object.keys(obj).length === 0) return '';
    const o = obj[type]?.[index];
    if (!o) return '';
    const exec = Number(o.executedQty) || 0;
    if (exec <= 0) return '';
    const quote = Number(o.cummulativeQuoteQty) || 0;
    const p = obj.param || {};

    let out;
    if (kind === 'price') {
      const tick = parseInt(p['field-tickSize'], 10);
      const price = quote / exec;
      out = Number.isFinite(tick) ? price.toFixed(tick) : String(price);
    } else {
      const step = parseInt(p['field-stepSize'], 10);
      out = Number.isFinite(step) ? exec.toFixed(step) : String(exec);
    }
    return `<span class="fill-badge" title="real ${kind}">${out}</span>`;
  }

  async calculator(obj = {}) {
    try {
      const res = await fetch(`/spotbot/calculator/result`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: this.strategy, settings: this.defaultData }),
      });

      const data = await res.json();

      orders = {
        id: 'hash-hash',
        status: 0, // 0 - calc(can deletad), 1 - in process, 3 - not done(error etc)
        pair: base + quote,
        param: {},
        date_added: new Date().toISOString(),
        date_modified: null,
        BUY: [],
        SELL: [],
      };

      data['calculator'].forEach((el, index) => {
        const row = `<tr>
              <th class="center">${index + 1}</th>
              <td>${el.overlapRange}</td>
              <td><span class="fill-cell">${el.buyCurrency}${this.#fillBadge(obj, 'BUY', index, 'price')}</span></td>
              <td class="${this.#backlight(obj, 'BUY', index)}"><span class="fill-cell">${el.buy}${this.#fillBadge(obj, 'BUY', index, 'qty')}</span></td>
              <td class="${this.#backlight(obj, 'SELL', index)}"><span class="fill-cell">${el.totalSell}${this.#fillBadge(obj, 'SELL', index, 'qty')}</span></td>
              <td><span class="fill-cell">${el.sellCurrency}${this.#fillBadge(obj, 'SELL', index, 'price')}</span></td>
              <td>${el.didBuy}</td>
              <td>${el.calcBalance}</td>
          </tr>`;
        document.querySelector('#settings-table tbody').innerHTML += row;

        orders['BUY'][index] = {
          status: null,
          symbol: base + quote,
          side: 'BUY',
          type: 'LIMIT',
          quantity: el.buy,
          price: el.buyCurrency,
          timeInForce: 'GTC',
          orderId: null,
        };

        orders['SELL'][index] = {
          status: null,
          symbol: base + quote,
          side: 'SELL',
          type: 'LIMIT',
          quantity: el.totalSell,
          price: el.sellCurrency,
          timeInForce: 'GTC',
          orderId: null,
        };
      });
    } catch (err) {
      console.error('❌ calculator():', err);
      return null;
    }
  }

  async settingsSave() {
    orders.param = this.defaultData;

    try {
      const res = await fetch(`/spotbot/calculator/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: orders }),
      });

      const data = await res.json();
      this.notifications.showNotification(data.message, 'success', 10000);
    } catch (err) {
      console.error('❌ settingsSave():', err);
      return null;
    }
  }

  async addRestartStatus(value) {
    const obj = {
      "pair": base + quote,
      "restart": value
    }

    try {
      const res = await fetch(`/spotbot/calculator/restart`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: obj }),
      });

      const data = await res.json();
      this.notifications.showNotification(data.message, 'success', 10000);
      if (this.onRestartChange) this.onRestartChange(value);
    } catch (err) {
      console.error('❌ addRestartStatus(value):', err);
      return null;
    }
  }
}
