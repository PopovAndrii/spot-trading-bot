const express = require('express');
const router = express.Router();
const fs = require('fs/promises');
const path = require('path');

const { InvokeApi } = require('../lib/invokeAPI');
const { Spot } = require('@binance/connector');
const { Calculator } = require('../lib/calculator');

let api_key = process.env.API_KEY;
let api_secret = process.env.API_SECRET;
let baseURL = 'https://api.binance.com';

if (!api_key || !api_secret) {
  throw new Error('Binance API keys are not set');
}

if (process.env.NODE_ENV === 'development') {
  api_key = process.env.API_KEY_TEST;
  api_secret = process.env.API_SECRET_TEST;
  baseURL = 'https://testnet.binance.vision/';
}

const client = new Spot(api_key, api_secret, { baseURL: baseURL });

const apiMethod = new InvokeApi();

router.get('/', function (req, res, next) {
  res.render('spotbot', { title: 'Express', currency: 'req.params1' });
});

router.get('/:currency', async function (req, res, next) {
  const currency = req.params.currency; // BNBUSDT
  let bace = '';
  let quote = '';
  let formatInfo = {};

  const decimalCount = (e, s = '.') => {
    if (!e) return 0;
    const str = parseFloat(e).toString().split(s)[1] || '';
    return str.length;
  };

  try {
    const exchangeInfo = await client.exchangeInfo({ symbol: currency });
    const symbolData = exchangeInfo.data.symbols[0] || {};
    const filters = symbolData.filters || [];

    bace = symbolData.baseAsset || '';
    quote = symbolData.quoteAsset || '';

    const priceFilter = filters.find((f) => f.filterType === 'PRICE_FILTER');
    const lotSizeFilter = filters.find((f) => f.filterType === 'LOT_SIZE');

    formatInfo = {
      tickSize: decimalCount(priceFilter?.tickSize),
      stepSize: decimalCount(lotSizeFilter?.stepSize),
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
  try {
    const rawSymbol = req.body.message;
    if (!rawSymbol) {
      return res.status(400).json({ data: {}, message: 'Symbol is required in request body' });
    }

    // Safely clear a symbol to avoid path traversal
    const symbol = rawSymbol.replace(/[^a-zA-Z0-9_-]/g, '');
    const exchangeName = 'binance';
    const filePath = path.join(__dirname, '../data', `${symbol}-${exchangeName}.json`);

    // Reading a file
    const data = await fs.readFile(filePath, 'utf8');
    let jsonData;
    try {
      jsonData = JSON.parse(data);
    } catch (parseErr) {
      console.error('🔴 JSON parse error:', parseErr);
      return res.status(500).json({ data: {}, message: 'Invalid JSON in file' });
    }

    res.json({ data: jsonData });
  } catch (err) {
    if (err.code === 'ENOENT') {
      const msg = '🟡 File not found.';
      console.warn(msg);
      res.status(404).json({ data: {}, message: msg });
    } else {
      const msg = '🔴 Error reading file.';
      console.error(msg, err);
      res.status(500).json({ data: {}, message: msg });
    }
  }
});

router.post('/:symbol', async function (req, res, next) {
  try {
    // Defining assets safely
    const asset = req.body.message === 'short' ? req.query.bace : req.query.quote;

    // We receive data from Binance in parallel
    const [account, tickerPrice, exchangeInfo] = await Promise.all([
      client.account({ omitZeroBalances: true }),
      client.tickerPrice(req.query.symbol),
      client.exchangeInfo({ symbol: req.query.symbol }),
    ]);

    const symbolData = exchangeInfo.data.symbols[0] || {};
    const filters = symbolData.filters || [];

    // Safely take filters if they don't exist - undefined
    const priceFilter = filters.find((f) => f.filterType === 'PRICE_FILTER');
    const lotSizeFilter = filters.find((f) => f.filterType === 'LOT_SIZE');
    const minNotionalFilter = filters.find((f) => f.filterType === 'NOTIONAL');

    // Function for counting decimal places
    const decimalCount = (value, separator = '.') => {
      if (!value) return 0;
      const str = parseFloat(value).toString().split(separator)[1] || '';
      return str.length;
    };

    // Rounding to the nearest step
    const roundToStep = (value, step) => {
      if (typeof value !== 'number' || isNaN(value) || !step) return 0;
      const precision = Math.floor(-Math.log10(step));
      return Number((Math.floor(value / step) * step).toFixed(precision));
    };

    // Get your balance safely
    const balanceEntry = account.data.balances.find((b) => b.asset === asset);
    const balance = balanceEntry ? parseFloat(balanceEntry.free) : 0;

    const ticker = parseFloat(tickerPrice.data.price) || 0;
    const minNotional = minNotionalFilter ? parseFloat(minNotionalFilter.minNotional) : 0;
    const tickSize = priceFilter ? parseFloat(priceFilter.tickSize) : 0;
    const stepSize = lotSizeFilter ? parseFloat(lotSizeFilter.stepSize) : 0;

    res.json({
      symbol: {
        symbol: symbolData.symbol || req.query.symbol,
        baseAsset: symbolData.baseAsset || '',
        quoteAsset: symbolData.quoteAsset || '',
        tickSize: decimalCount(tickSize), // price accuracy
        stepSize: decimalCount(stepSize), // accuracy of quantity
        balance: roundToStep(balance, tickSize), // free balance
        minQuoteAsset: roundToStep(minNotional, tickSize), // min. rate quote currency
        minNotional: ticker > 0 ? roundToStep(minNotional / ticker, stepSize) : 0, // min. base currency rate
        price: ticker,
      },
    });
  } catch (error) {
    console.error('Spotbot route error:', error);
    res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
});

router.post('/calculator/save', async (req, res, next) => {
  try {
    const rawPair = req.body.message?.pair;
    if (!rawPair) {
      return res.status(400).json({ message: 'Pair is required' });
    }

    // Safely clear a symbol to avoid path traversal
    const symbol = rawPair.replace(/[^a-zA-Z0-9_-]/g, '');
    const exchangeName = 'binance';

    // JSON stringify with check
    let jsonString;
    try {
      jsonString = JSON.stringify(req.body.message, null, 2);
    } catch (err) {
      console.error('🔴 JSON stringify error:', err);
      return res.status(400).json({ message: 'Invalid data for JSON' });
    }

    const filePath = path.join(__dirname, '../data', `${symbol}-${exchangeName}.json`);

    await fs.writeFile(filePath, jsonString, 'utf8');

    res.json({ message: 'Order settings table saved' });
  } catch (err) {
    console.error('Error saving file:', err);
    res.status(500).json({ message: 'Error saving file' });
  }
});

router.post('/cancel/allorders', async (req, res, next) => {
  const symbol = req.body.message;
  if (!symbol) {
    return res.status(500).json({ success: false, message: 'Symbol is required in request body' });
  }

  const result = await apiMethod.cancelOpenOrders(symbol);

  if (!result.success) {
    return res.status(500).json(result);
  }

  res.json({ success: true, data: result.data || result });
});

router.post('/calculator/result', async (req, res, next) => {
  try {
    const { message, settings } = req.body;

    if (!message || !settings) {
      return res.status(400).json({
        error: 'message and settings are required',
      });
    }

    let calc;
    try {
      calc = new Calculator(settings, message);
    } catch (err) {
      console.error('Calculator constructor error:', err);
      return res.status(400).json({
        error: err.message || 'Calculator error',
      });
    }

    res.json({
      calculator: calc,
    });
  } catch (error) {
    console.error('Calculator route error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
