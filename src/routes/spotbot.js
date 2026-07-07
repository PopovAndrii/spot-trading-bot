const express = require('express');
const router = express.Router();
const fs = require('fs/promises');
const path = require('path');

const { InvokeApi } = require('../lib/invokeAPI');
const { Calculator } = require('../lib/calculator');
const { writeFileAtomic } = require('../lib/atomicWrite');
const { pair, statusPair } = require('../lib/pair');
const { archiveIfActive } = require('../lib/cycleArchive');
const { decimalCount, roundToStep } = require('../lib/format');
const logBus = require('../lib/logBus');
const telegram = require('../lib/telegram');

const API = InvokeApi.getInstance();

router.get('/:currency', async function (req, res, next) {
  const currency = req.params.currency; // BNBUSDT

  if (!/^[A-Za-z0-9]{3,20}$/.test(currency)) return next();

  let base = '';
  let quote = '';
  let formatInfo = {};

  const exchangeInfo = await API.exchangeInfo({ symbol: currency });

  if (!exchangeInfo.success) {
    const err = new Error(`Binance API error: ${exchangeInfo.message}`);
    err.status = 502;
    return next(err);
  }
  const symbolData = exchangeInfo.message.symbols?.[0] || {};
  const filters = symbolData.filters || [];

  base = symbolData.baseAsset || '';
  quote = symbolData.quoteAsset || '';

  const priceFilter = filters.find((f) => f.filterType === 'PRICE_FILTER');
  const lotSizeFilter = filters.find((f) => f.filterType === 'LOT_SIZE');

  formatInfo = {
    tickSize: decimalCount(priceFilter?.tickSize),
    stepSize: decimalCount(lotSizeFilter?.stepSize),
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

  const strategy = message; // 'short' | 'long'
  const asset = strategy === 'short' ? base : quote;

  // We receive data from Binance in parallel
  const [account, tickerPrice, exchangeInfo] = await Promise.all([
    API.getAccount(),
    API.tickerPrice({ symbol }),
    API.exchangeInfo({ symbol }),
  ]);

  const failed = [account, tickerPrice, exchangeInfo].find((r) => !r.success);
  if (failed) {
    return res.status(502).json({ success: false, message: failed.message });
  }

  const symbolData = exchangeInfo.message.symbols?.[0] || {};
  const filters = symbolData.filters || [];

  // Safely take filters if they don't exist - undefined
  const priceFilter = filters.find((f) => f.filterType === 'PRICE_FILTER');
  const lotSizeFilter = filters.find((f) => f.filterType === 'LOT_SIZE');
  const minNotionalFilter = filters.find((f) => f.filterType === 'NOTIONAL');

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
      // Balance precision for SpinBox: long → balance in quote (tickSize), short → in base (stepSize)
      balanceFormat: decimalCount(strategy === 'long' ? tickSize : stepSize),
      balance: roundToStep(balance, strategy === 'long' ? tickSize : stepSize), // free balance (round down)
      minQuoteAsset: roundToStep(minNotional, tickSize, 'ceil'), // min. rate quote currency
      minNotional: ticker > 0 ? roundToStep(minNotional / ticker, stepSize, 'ceil') : 0, // min. base currency rate
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

    // Server-side write lock: refuse to overwrite a live order-state
    // file while the bot is running for this symbol. The UI already locks the
    // Save button, but a direct POST (stale tab, reload mid-tick) would
    // bypass it and wipe orderId/status/executedQty. Stop the cycle first.
    if (pair.isRunning(symbol)) {
      return res.status(409).json({ message: 'Cycle is running — press "Stop" before saving' });
    }

    if (pair.needsAttention(symbol)) {
      return res.status(409).json({
        message:
          'Server was restarted with live orders — press "Start" to resume or cancel orders before saving',
      });
    }

    const msg = req.body.message;
    if (
      !Array.isArray(msg.BUY) ||
      !Array.isArray(msg.SELL) ||
      typeof msg.param !== 'object' ||
      msg.param === null
    ) {
      return res
        .status(400)
        .json({ message: 'Invalid data structure: BUY, SELL, param are required' });
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

    const open = await API.openOrders({ symbol });
    if (!open.success) {
      return res.status(502).json({
        message:
          'Cannot verify the exchange has no live orders — try again, or stop the cycle first',
      });
    }
    if (open.message > 0) {
      return res.status(409).json({
        message: `${open.message} live order(s) still resting on the exchange — press "Start" to resume, or cancel them before saving`,
      });
    }

    const archived = await archiveIfActive(filePath);
    if (archived) {
      console.log(`🗄️ Previous cycle archived: ${path.basename(archived)}`);
    }

    await writeFileAtomic(filePath, jsonString, 'utf8');

    res.json({
      message: archived
        ? 'Order settings table saved. Previous cycle archived.'
        : 'Order settings table saved',
    });
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

    await writeFileAtomic(filePath, data, 'utf8');

    const str = newData.restart === true ? 'on' : 'off';

    res.json({ message: `Restart for: ${symbol} is <b>${str}</b>` });
  } catch (err) {
    console.error('Error saving file:', err);
    res.status(500).json({ message: 'Error saving file' });
  }
});

router.post('/calculator/param', async (req, res, next) => {
  try {
    const msg = req.body.message || {};
    const rawPair = msg.pair;
    if (!rawPair) {
      return res.status(400).json({ message: 'Pair is required' });
    }

    const LIMITS = {
      'field-activeOrders': { min: 2, max: 50 },
      'field-requestFrequency': { min: 500, max: 5000 },
    };

    const limit = LIMITS[msg.key];
    if (!limit) {
      return res.status(400).json({ message: 'Invalid param key' });
    }

    const num = Number(msg.value);
    if (!Number.isFinite(num)) {
      return res.status(400).json({ message: 'Invalid param value' });
    }
    const value = Math.min(limit.max, Math.max(limit.min, Math.round(num)));

    const symbol = rawPair.replace(/[^a-zA-Z0-9_-]/g, '');
    const filePath = path.join(__dirname, '../data', `${symbol}-binance.json`);

    const content = await fs.readFile(filePath, 'utf8');
    const data = JSON.parse(content);

    if (!data.param || typeof data.param !== 'object') {
      data.param = {};
    }
    data.param[msg.key] = String(value);

    let jsonString;
    try {
      jsonString = JSON.stringify(data, null, 2);
    } catch (err) {
      console.error('Invalid data for JSON:', err);
      return res.status(400).json({ message: 'Invalid data for JSON' });
    }

    await writeFileAtomic(filePath, jsonString, 'utf8');

    // value, not msg.value: show what was actually saved (after clamp)
    res.json({ message: `${msg.key} = <b>${value}</b> saved for ${symbol}` });
  } catch (err) {
    console.error('Error saving param:', err);
    res.status(500).json({ message: 'Error saving param' });
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

  if (pair.needsAttention(symbol)) {
    pair.updateSymbol({ symbol, status: statusPair.STOP });
  }

  // result.message = how many resting orders were actually pulled (0 = no-op)
  telegram.send(`✖️ <b>Canceled all orders</b> ${symbol} (${result.message} pulled)`);

  res.json(result);
});

router.post('/series/delete', async (req, res) => {
  const rawSymbol = req.body.message;
  if (!rawSymbol) {
    return res.status(400).json({ success: false, message: 'Symbol is required in request body' });
  }

  const symbol = rawSymbol.replace(/[^a-zA-Z0-9_-]/g, '');
  if (!symbol) {
    return res.status(400).json({ success: false, message: 'Invalid symbol' });
  }

  if (pair.isRunning(symbol)) {
    return res.status(409).json({ success: false, message: 'Cycle is running — press Stop first' });
  }

  const open = await API.openOrders({ symbol });
  if (!open.success) {
    return res.status(502).json(open);
  }
  if (open.message > 0) {
    return res.status(409).json({
      success: false,
      message: `${open.message} active order(s) still on the exchange — cancel them first`,
    });
  }

  const file = path.join(__dirname, '../data', `${symbol}-binance.json`);
  try {
    await fs.unlink(file);
  } catch (err) {
    if (err.code !== 'ENOENT') {
      return res
        .status(500)
        .json({ success: false, message: `Failed to delete series file: ${err.message}` });
    }
  }

  pair.deleteSymbol(symbol);

  logBus.clearSymbol(symbol);

  telegram.send(`🗑 <b>Series deleted</b> ${symbol}`);

  res.json({ success: true, message: 'No active orders.<br>Series deleted' });
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
      calc = Calculator.build(settings, message);
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
