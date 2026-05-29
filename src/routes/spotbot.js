const express = require('express');
const router = express.Router();
const fs = require('fs/promises');
const path = require('path');

const { InvokeApi } = require('../lib/invokeAPI');
const { Calculator } = require('../lib/calculator');

const API = new InvokeApi();

router.get('/:currency', async function (req, res, next) {
  const currency = req.params.currency; // BNBUSDT

  if (!/^[A-Za-z0-9]{3,20}$/.test(currency)) return next();

  let base = '';
  let quote = '';
  let formatInfo = {};

  const decimalCount = (e, s = '.') => {
    if (!e) return 0;
    const str = parseFloat(e).toString().split(s)[1] || '';
    return str.length;
  };

  const exchangeInfo = await API.exchangeInfo({ symbol: currency });
  const symbolData = exchangeInfo.message.symbols[0] || {};
  const filters = symbolData.filters || [];

  base = symbolData.baseAsset || '';
  quote = symbolData.quoteAsset || '';

  const priceFilter = filters.find((f) => f.filterType === 'PRICE_FILTER');
  const lotSizeFilter = filters.find((f) => f.filterType === 'LOT_SIZE');

  formatInfo = {
    tickSize: decimalCount(priceFilter?.tickSize),
    stepSize: decimalCount(lotSizeFilter?.stepSize),
    depositStep: Math.max(decimalCount(priceFilter?.tickSize), decimalCount(lotSizeFilter?.stepSize)),
  };

  res.render('spotbot', {
    title: `${base}/${quote}`,
    currency: base + quote,
    base,
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
  const { base, quote, symbol } = req.query;
  const { message } = req.body;

  if (!base || !quote || !symbol) {
    return res.status(400).json({ success: false, message: 'base and quote are required' });
  }

  const asset = message === 'short' ? base : quote;

  // We receive data from Binance in parallel
  const [account, tickerPrice, exchangeInfo] = await Promise.all([
    API.getAccount(),
    API.tickerPrice({ symbol }),
    API.exchangeInfo({ symbol }),
  ]);

  const symbolData = exchangeInfo.message.symbols[0] || {};
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
  const balanceEntry = account.message.balances.find((b) => b.asset === asset);
  const balance = balanceEntry ? parseFloat(balanceEntry.free) : 0;

  const ticker = parseFloat(tickerPrice.message.price) || 0;
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
      balance: roundToStep(balance, message === 'short' ? stepSize : tickSize), // free balance
      minQuoteAsset: roundToStep(minNotional, tickSize), // min. rate quote currency
      minNotional: ticker > 0 ? roundToStep(minNotional / ticker, stepSize) : 0, // min. base currency rate
      price: ticker,
    },
  });
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

    const msg = req.body.message;
    if (
      !Array.isArray(msg.BUY) ||
      !Array.isArray(msg.SELL) ||
      typeof msg.param !== 'object' ||
      msg.param === null
    ) {
      return res.status(400).json({ message: 'Invalid data structure: BUY, SELL, param are required' });
    }

    // JSON stringify with check
    let jsonString;
    try {
      jsonString = JSON.stringify(msg, null, 2);
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

router.post('/calculator/restart', async (req, res, next) => {
  try {
    const rawPair = req.body.message?.pair;
    if (!rawPair) {
      return res.status(400).json({ message: 'Pair is required' });
    }

    const symbol = rawPair.replace(/[^a-zA-Z0-9_-]/g, '');

    const filePath = path.join(__dirname, '../data', `${symbol}-binance.json`);

    const content = await fs.readFile(filePath, 'utf8');
    let data = JSON.parse(content);

    const newData = req.body.message;
    // data = { ...data, ...newData };
    // newData.restart = req.body.message.restart === 'true';
    newData.restart = String(req.body.message.restart) === 'true';
    data = Object.assign(data, newData);
    try {
      data = JSON.stringify(data, null, 2);
    } catch (err) {
      console.error('Invalid data for JSON:', err);
      return res.status(400).json({ message: 'Invalid data for JSON' });
    }

    await fs.writeFile(filePath, data, 'utf8');

    const str = newData.restart == "true" ? "on" : "off";

    res.json({ message: `Restart for: ${symbol} is <b>${str}</b>` });
  } catch (err) {
    console.error('Error saving file:', err);
    res.status(500).json({ message: 'Error saving file' });
  }
});

router.post('/cancel/allorders', async (req, res, next) => {
  const rawSymbol = req.body.message;
  if (!rawSymbol) {
    return res.status(500).json({ success: false, message: 'Symbol is required in request body' });
  }

  const symbol = rawSymbol.replace(/[^a-zA-Z0-9_-]/g, '');
  if (!symbol) {
    return res.status(400).json({ success: false, message: 'Invalid symbol' });
  }

  const result = await API.cancelOpenOrders({ symbol });

  if (!result.success) {
    return res.status(500).json(result);
  }

  res.json(result);
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
