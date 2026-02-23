export class LoadInfo {
  constructor(notifications) {
    this.notifications = notifications;

    this.loadPersonalInfo();
  }

  async loadPersonalInfo() {
    try {
      const res = await fetch(`/info/account-info`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      const data = await res.json();

      if (data.success) {
        this.fillCurrency(data);
        this.commissionRates(data);
        this.updateTime(data);
        this.notifications.showNotification('Balance loaded.', 'success', 10000);
      } else {
        this.notifications.showNotification(data.message, 'danger', 10000);
      }
    } catch (err) {
      console.error('❌ loadPersonalInfo():', err);
      this.notifications.showNotification(
        err.message,
        'danger',
        10000
      );
      return null;
    }
  }

  fillCurrency(data) {
    data.message['balances'].forEach((el, index) => {
      const row = `<tr>
          <th>${index + 1}</th>
          <td>${el.asset}</td>
          <td>${el.free}</td>
          <td>${el.locked}ss</td>
        </tr>`;

      document.querySelector('#info-currency tbody').innerHTML += row;
    });
  }

  commissionRates(data) {
    const row = `<tr>
        <td>maker:</td>
          <td>${data.message.commissionRates.maker}</td>
        </tr>
        <tr>
          <td>taker:</td>
          <td>${data.message.commissionRates.taker}</td>
        </tr>
        <tr>
          <td>buyer:</td>
          <td>${data.message.commissionRates.buyer}</td>
        </tr>
        <tr>
          <td>seller:</td>
          <td>${data.message.commissionRates.seller}</td>
      </tr>`;

    document.querySelector('#info-commission tbody').innerHTML += row;
  }

  updateTime(data) {
    document.querySelector('#info-time').innerHTML += new Date(
      data.message.updateTime
    ).toLocaleString();
  }
}
