const express = require('express');
const router = express.Router();
const fs = require('fs/promises');
const path = require('path');

const { Spot } = require('@binance/connector');
const { Calculator } = require('../lib/calculator');

const client = new Spot(process.env.API_KEY, process.env.API_SECRET);

const { ensureAuthenticated } = require('./login');
router.use(ensureAuthenticated);

router.get('/', function (req, res, next) {
  res.render('spotbot', { title: 'Express', currency: 'req.params1' });
});

router.get('/:currency', async function (req, res, next) {
  // @TODO rename currency to symbol
  const currency = req.params.currency;
  var bace = '';
  var quote = '';
  var formatInfo = {};

  const decimalCount = (e, s = '.') => {
    var str = parseFloat(e).toString().split(s)[1] || '';
    return str.length;
  };

  try {
    const exchangeInfo = await client.exchangeInfo({ symbol: currency });
    const filters = exchangeInfo.data.symbols[0].filters;

    bace = exchangeInfo.data.symbols[0].baseAsset;
    quote = exchangeInfo.data.symbols[0].quoteAsset;

    const priceFilter = filters.find((f) => f.filterType === 'PRICE_FILTER');
    const lotSizeFilter = filters.find((f) => f.filterType === 'LOT_SIZE');

    formatInfo = {
      tickSize: decimalCount(priceFilter['tickSize']),
      stepSize: decimalCount(lotSizeFilter['stepSize']),
    };
  } catch (error) {
    console.error('Err /:currency', error.message);
  }

  res.render('spotbot', {
    title: `${bace}/${quote}`,
    currency: bace + quote,
    bace,
    quote,
    formatInfo,
  });
});

// get calc table data
router.post('/table/:symbol', async (req, res, next) => {
  const symbol = req.body.message;
  const exchangeName = 'binance';

  const filePath = path.join(__dirname, '../data', `${symbol}-${exchangeName}.json`);

  try {
    const data = await fs.readFile(filePath, 'utf8');
    res.json({ data: JSON.parse(data) });
  } catch (err) {
    if (err.code === 'ENOENT') {
      const msg = '🟡 File not found. ';
      console.warn(msg);
      res.status(404).json({ data: {}, message: msg });
    } else {
      const msg = '🔴 Error reading file. ';
      console.error(msg, err);
      res.status(500).json({ data: {}, message: msg });
    }
  }
});

// button short/long
router.post('/:symbol', function (req, res, next) {
  const asset = req.body.message == 'short' ? req.query.bace : req.query.quote;

  const exchangeInfo = client.exchangeInfo({ symbol: req.query.symbol }); // not secure
  const tickerPrice = client.tickerPrice(req.query.symbol); // not secure
  const account = client.account({ omitZeroBalances: true });
  Promise.all([account, tickerPrice, exchangeInfo])
    .then(([account, tickerPrice, exchangeInfo]) => {
      const priceFilter = exchangeInfo.data.symbols[0].filters.find(
        (f) => f.filterType === 'PRICE_FILTER'
      );
      const lotSizeFilter = exchangeInfo.data.symbols[0].filters.find(
        (f) => f.filterType === 'LOT_SIZE'
      );
      const minNotional = exchangeInfo.data.symbols[0].filters.find(
        (f) => f.filterType === 'NOTIONAL'
      );

      const decimalCount = (e, s = '.') => {
        var str = parseFloat(e).toString().split(s)[1] || '';
        return str.length;
      };

      const roundToStep = (value, step) => {
        const precision = Math.floor(-Math.log10(step));
        return Number((Math.floor(value / step) * step).toFixed(precision));
      };

      res.json({
        symbol: {
          symbol: exchangeInfo.data.symbols[0].symbol,
          baseAsset: exchangeInfo.data.symbols[0].baseAsset,
          quoteAsset: exchangeInfo.data.symbols[0].quoteAsset,
          tickSize: decimalCount(priceFilter['tickSize']), // точность цены (кол-во знаков после запятой в цене)
          stepSize: decimalCount(lotSizeFilter['stepSize']), // точность количества (кол-во знаков после запятой в объёме, quantity)
          balance: roundToStep(
            account.data['balances'].filter((result) => result['asset'] == asset)[0]['free'],
            priceFilter['tickSize']
          ),
          minQuoteAsset: roundToStep(minNotional['minNotional'], priceFilter['tickSize']), // минимальная ставка quote валюты
          minNotional: roundToStep(
            Number(minNotional['minNotional']) / Number(tickerPrice.data.price),
            lotSizeFilter['stepSize']
          ), // минимальная ставка bace валюты
          price: tickerPrice.data.price,
        },
      });
    })
    .catch((error) => {
      res.status(500).json({ error: error.message });
    });
});

router.post('/calculator/save', async (req, res, next) => {
  try {
    const symbol = req.body.message.pair;

    const exchangeName = 'binance';
    const jsonString = JSON.stringify(req.body.message, null, 2);

    const filePath = path.join(__dirname, '../data', `${symbol}-${exchangeName}.json`);

    await fs.writeFile(filePath, jsonString, 'utf8');

    res.json({ message: 'Order settings table saved' });
  } catch (err) {
    console.error('Error saving file:', err);
    res.status(500).json({ message: 'Error saving file' });
  }
});

router.post('/cancel/allorders', async (req, res, next) => {
  try {
    const symbol = req.body.message;

    const cancelOrder = await client.cancelOpenOrders(symbol);
    res.json({ message: cancelOrder.data });
  } catch (err) {
    if (err.response) {
      console.error('Error Binance API:', err.response.data);
    } else {
      console.error('Error cancel order:', err.message);
    }
  }
});

router.post('/calculator/result', function (req, res, next) {
  const { message, settings } = req.body;

  const calc = new Calculator(settings, message);

  Promise.all([calc])
    .then(([calc]) => {
      res.json({
        calculator: calc,
      });
    })
    .catch((error) => {
      res.status(500).json({ error: error.message });
    });
});

module.exports = router;
