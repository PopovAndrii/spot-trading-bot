const { Binance } = require('../api/binance');
const binance = new Binance();

module.exports = function serviceInformation(wss) {
    wss.on('connection', (ws) => {
      ws.on('message', async (msg) => {
        let data;
        try {
          data = JSON.parse(msg);
        } catch (err) {
          ws.send(JSON.stringify({ error: 'Неверный JSON' }));
          return;
        }
  
        if (data.type === 'time') {
          const time = await binance.getServerTime();
          ws.send(JSON.stringify({ type: "time", time }));
        }
  
        // if (data.type === 'price' && data.symbol) {
        //   const priceData = await binance.getPrice(data.symbol);
        //   ws.send(JSON.stringify({ type: 'price', ...priceData }));
        // }
      });
  
      ws.send(JSON.stringify({ message: 'WebSocket подключён.' }));
    });
  };