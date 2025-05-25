export class SetStrategy {
  constructor() {
    document.querySelectorAll('#settings-strategy > input').forEach(el => {
      el.addEventListener('click', (e) => {
          const url = new URL(window.location.href);
          const bace = url.searchParams.get("base");
          const quote = url.searchParams.get("quote");
          this.strategyName = e.target.id;
          this.test(bace, quote);
      });
    });
  }

  test(bace, quote) {
    // @TODO ${bace}${quote} replece = unique id 
    fetch(`/spotbot/${bace}${quote}?symbol=${currency}&bace=${bace}&quote=${quote}` , {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // body: JSON.stringify({ message: strategyName }) // параметр на сервер
    })
    .then(response => response.json())
    .then(data => {
      this.setSettings(data.symbol)
      // document.querySelector('#settings-balance').innerText = data.symbol.balance
    })
    .catch(err => console.error('Ошибка:', err));
  }

  setSettings(data = {}) {
    const defaultData = {
          'field-currency': data['price'],
          'field-strategy': this.strategyName,
          'field-deposit': data['balance'], //1.074 0.00417, // 430$
          'field-orderSize': data['minNotional'], // 0.028, // >= 10$
          'info-minQuoteAsset': '(min: ' + data['minQuoteAsset'] + ' ' + data['quoteAsset'] + ')',
          'field-profit': 0.2, // %
          'field-fibonachiStep': 0.50,
          'field-martingail': 60, // %
          'field-indent': 0.1, // %
          'field-trackPrice': 0.3, // % следить за ценой 
          'field-staticStep': 0, // %
          'field-requestFrequency': 800, // ms
          'field-stepSize': data['stepSize'], // знаков после запятой в quantity
          'field-tickSize': data['tickSize'], // знаков после запятой в цене
      }
    // const fill = Object.assign(defaultData, params);

    const info = document.querySelector('[id^="info-"]');
    info.innerText = defaultData['info-minQuoteAsset'];
    
    const all = document.querySelectorAll('[id^="field-"]');
    all.forEach(el => {
        document.getElementById(el.id).value = defaultData[el.id];
    });
  }
}