export class LoadDataCalculator {
  constructor(notifications, colors = {}) {
    this.listenerStatus = true;
    this.defaultData = {};
    this.notifications = notifications;
    this._ignoreSelectChange = false;

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
      if (this.getListenerStatus()) {
        this.addRestartStatus(e.detail.value);
      } else {
        this.notifications.showNotification(
          'Save is locked. Press the "Pause" button.',
          'warning',
          10000
        );
      }
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
              <td>${el.buyCurrency}</td>
              <td class="${this.#backlight(obj, 'BUY', index)}">${el.buy}</td>
              <td class="${this.#backlight(obj, 'SELL', index)}">${el.totalSell}</td>
              <td>${el.sellCurrency}</td>
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
    } catch (err) {
      console.error('❌ addRestartStatus(value):', err);
      return null;
    }
  }
}
