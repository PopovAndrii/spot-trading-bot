export class LoadDataCalculator {
  constructor(notifications, colors = {}) {
    this.listenerStatus = true;

    this.notifications = notifications;

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

    this.orderType = colors;
  }

  setListenerStatus(status = false) {
    this.listenerStatus = status == false ? true : false;
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
        console.log(e.detail)
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
    this.defaultData = {
      'field-currency': null,
      'field-deposit': null,
      'field-orderSize': null,
      'field-profit': null,
      'field-commission': null,
      'field-fibonachiStep': null,
      'field-martingail': null,
      'field-indent': null,
      'field-requestFrequency': null,
      'field-stepSize': null,
      'field-tickSize': null,
    };

    const all = document.querySelectorAll('[id^="field-"]');
    all.forEach((el) => {
      this.defaultData[el.id] = document.getElementById(el.id).value;
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

  #getParam() {
    const obj = {};

    document.querySelectorAll('[id^="field-"]').forEach((el) => {
      obj[el.id] = el.value;
    });

    return obj;
  }

  async settingsSave() {
    orders.param = this.#getParam();

    try {
      const res = await fetch(`/spotbot/calculator/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: orders }),
      });

      const data = await res.json();
      console.log('settingsSave():', data.message);
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
