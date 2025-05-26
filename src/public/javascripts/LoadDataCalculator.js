export class LoadDataCalculator {
    constructor() {
      document.querySelector('#settings-calculate').addEventListener('click', () => {
        document.querySelector('#settings-table tbody').innerHTML = '';
        this.getSettings();
        this.strategy = document.getElementById("field-strategy").value;
        this.calculator();
      
      })
    }
    
    save(){
      document.getElementById('settings-calculate-save').addEventListener('click', () => {
        this.settingsSave();
      });
    }

    getSettings() {
      this.defaultData = {
            'field-currency': null,
            'field-deposit': null,
            'field-orderSize': null,
            'field-profit': null,
            'field-fibonachiStep': null,
            'field-martingail': null,
            'field-indent': null,
            'field-trackPrice': null, // в построении не учавствует
            'field-staticStep': null,
            'field-requestFrequency': null, // в построении не учавствует
            'field-stepSize': null,
            'field-tickSize': null,
        }
  
      const all = document.querySelectorAll('[id^="field-"]');
      all.forEach(el => {
        this.defaultData[el.id] = document.getElementById(el.id).value;
      });
    }
  
    async calculator() {
      try {
        const res = await fetch(`/spotbot/calculator/result`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: this.strategy, settings: this.defaultData })
      });
  
        const data = await res.json();
  
        orders = {
          'id': 'hash-hash',
          'status': 0, // 0 - calc(can deletad), 1 - in process, 3 - not done(error etc)
          'pair': currency,
          'param': {

          },
          'date_added': new Date().toISOString(),
          'date_modified': null,
          'BUY': [],
          'SELL': [],
        };
  
        data['calculator'].forEach((el, index) => { 
          const row = `<tr>
              <th scope="row">${index + 1}</th>
              <td>${el.overlapRange}</td>
              <td>${el.buyCurrency}</td>
              <td>${el.buy}</td>
              <td>${el.totalSell}</td>
              <td>${el.sellCurrency}</td>
              <td>${el.didBuy}</td>
              <td>${el.calcBalance}</td>
              <td>stat</td>
          </tr>`;
          document.querySelector('#settings-table tbody').innerHTML += row;
  
          orders['BUY'][index] = {
            status: null,
            symbol: currency, 
            side: 'BUY', 
            type: 'LIMIT', 
            quantity: el.buy,
            price: el.buyCurrency,
            timeInForce: 'GTC',
            orderId: null,
          }
  
          orders['SELL'][index] = {
            status: null,
            symbol: currency, 
            side: 'SELL', 
            type: 'LIMIT', 
            quantity: el.totalSell,
            price: el.sellCurrency,
            timeInForce: 'GTC',
            orderId: null,
          }
  
        });
  
      } catch (err) {
        console.error('❌ calculator():', err);
        return null;
      }
    }
  
    #getParam() {
      const obj = {};

      document.querySelectorAll('[id^="field-"]').forEach(el => {
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
          body: JSON.stringify({ message: orders })
      });
    
        const data = await res.json();
        console.log('Response settingsSave():', data.message);
  
      } catch (err) {
        console.error('❌ settingsSave():', err);
        return null;
      }
    }
  }