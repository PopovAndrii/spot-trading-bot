export class LoadDataFromFileCalculator {
  constructor() {
    this.orderType = { 
      "null": "",
      "NEW": "table-info", 
      "FILLED": "table-success",
      "PARTIALLY_FILLED": "table-warning",
      "CANCELED": "table-dark"
    }

    document.addEventListener('DOMContentLoaded', () => {
      const url = new URL(window.location.href);
      this.getStateCalculator(url);
    });

  }

  async getStateCalculator(url) {
    const bace = url.searchParams.get("base");
    const quote = url.searchParams.get("quote");
      // Запрос на сервер сразу после загрузки
    try {
      const res = await fetch(`/spotbot/table/${bace}${quote}?symbol=${currency}&bace=${bace}&quote=${quote}` , {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: currency }) // параметр на сервер
      }); // маршрут на сервере
      const data = await res.json();
      this.fillInData(data)
  
    } catch (err) {
      console.error('Error loaded table data:', err);
    }
    
    // setInterval(fetchTableData, 5000);
  }

  async fillInData(data) {
    // inputs
    document.querySelectorAll('[id^="field-"]').forEach(el => {
        document.getElementById(el.id).value = (data.param[el.id]) ? data.param[el.id] : null;
    });

    // table
    data['BUY'].forEach((el, index) => { 
      const row = `<tr>
          <th scope="row">${index + 1}</th>
          <td></td>
          <td>${el.price}</td>
          <td class="${this.orderType[el.status]}">${el.quantity}</td>
          <td class="${this.orderType[data['SELL'][index].status]}">${data['SELL'][index].quantity}</td>
          <td>${data['SELL'][index].price}</td>
          <td></td>
          <td></td>
          <td>stat</td>
      </tr>`;
      document.querySelector('#settings-table tbody').innerHTML += row;
  
    });
  }
}