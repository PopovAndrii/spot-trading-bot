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

const API = new InvokeApi();

router.get('/:currency', async function (req, res, next) {
  const currency = req.params.currency; // BNBUSDT

  if (!/^[A-Za-z0-9]{3,20}$/.test(currency)) return next();

  let base = '';
  let quote = '';
  let formatInfo = {};

  const exchangeInfo = await API.exchangeInfo({ symbol: currency });
  // При ошибке API .message — строка, а не объект; без этой проверки
  // .message.symbols[0] бросал TypeError (async-роут → unhandled rejection,
  // запрос подвисал вместо внятной error-страницы). ANALYSIS §2 Баги.
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

  // При ошибке любого из вызовов .message — строка; без проверки
  // .message.symbols[0] / .message.balances.find бросали TypeError → 500.
  // Возвращаем внятный JSON с сообщением биржи. ANALYSIS §2 Баги.
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
      balance: roundToStep(balance, tickSize), // free balance (округляем вниз)
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

    // Server-side write lock (req 15): refuse to overwrite a live order-state
    // file while the bot is running for this symbol. The UI already locks the
    // Save button (req 7), but a direct POST (stale tab, reload mid-tick) would
    // bypass it and wipe orderId/status/executedQty. Stop the cycle first.
    if (pair.isRunning(symbol)) {
      return res.status(409).json({ message: 'Cycle is running — press "Stop" before saving' });
    }

    // Recovery-лок (ANALYSIS п.1.5): рестарт сервера прервал цикл посередине —
    // в файле живые ордера (NEW/PARTIALLY_FILLED), они висят на бирже, но цикл
    // по ним не возобновлён. Save затёр бы их orderId — потеря контроля над
    // реальными ордерами. Завершённые циклы (DONE, без живых ордеров) скан
    // не помечает — их Save перезаписывает как обычно.
    if (pair.needsAttention(symbol)) {
      return res.status(409).json({
        message: 'Server was restarted with live orders — press "Start" to resume or cancel orders before saving',
      });
    }

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

    // история циклов: прожитый цикл (есть ордера с orderId) снапшотится в
    // {timestamp}-SYMBOL-binance.json перед перезаписью новым расчётом
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

    // newData.restart выше приведён к boolean — сравнение со строкой "true"
    // всегда давало false и ответ «off» (ANALYSIS.md п.2, баги)
    const str = newData.restart === true ? "on" : "off";

    res.json({ message: `Restart for: ${symbol} is <b>${str}</b>` });
  } catch (err) {
    console.error('Error saving file:', err);
    res.status(500).json({ message: 'Error saving file' });
  }
});

// Live-обновление параметров, не влияющих на расчётную таблицу: Active orders и
// Request frequency. Эти спинбоксы НЕ блокируются на время работы (вынесены из
// #group-spinbox), и их изменения должны попадать в файл прямо во время цикла —
// робот перечитывает конфиг на каждом проходе readLoop. В отличие от /save, здесь
// НЕТ guard isRunning: правка точечная (только param[key]), ордера не трогаются.
router.post('/calculator/param', async (req, res, next) => {
  try {
    const msg = req.body.message || {};
    const rawPair = msg.pair;
    if (!rawPair) {
      return res.status(400).json({ message: 'Pair is required' });
    }

    // Server-side clamp (ANALYSIS п.2): UI-минимумы спинбоксов легко обходятся
    // прямым POST, а requestFrequency=1 × getOrder на каждый ордер — риск бана
    // Binance (-1003/418). Границы зеркалят SpinBox'ы в spotbot.ejs.
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

    // value, а не msg.value: показать фактически сохранённое (после clamp)
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

  // Живых ордеров на бирже больше нет — снять recovery-лок (ANALYSIS п.1.5),
  // иначе Save останется заблокированным до перезапуска цикла.
  if (pair.needsAttention(symbol)) {
    pair.updateSymbol({ symbol, status: statusPair.STOP });
  }

  // Пару из меню здесь НЕ убираем: меню = файлы серий на диске, а файл остаётся.
  // Удаление серии — отдельное осознанное действие (кнопка Delete current series →
  // POST /series/delete), которое снова проверяет биржу и стирает файл.
  res.json(result);
});

// Удалить файл текущей серии (SYMBOL-binance.json) → пара уходит из меню.
// Кнопка активна только после Cancel all orders. Перед удалением ПЕРЕПРОВЕРЯЕМ
// биржу: если на паре остались живые ордера, файл не трогаем — иначе потеряли бы
// orderId, по которым потом нечем снять ордера (осиротевшие ордера на бирже).
router.post('/series/delete', async (req, res) => {
  const rawSymbol = req.body.message;
  if (!rawSymbol) {
    return res.status(400).json({ success: false, message: 'Symbol is required in request body' });
  }

  const symbol = rawSymbol.replace(/[^a-zA-Z0-9_-]/g, '');
  if (!symbol) {
    return res.status(400).json({ success: false, message: 'Invalid symbol' });
  }

  // Цикл не должен работать (иначе он перезапишет файл следующим тиком).
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
      return res.status(500).json({ success: false, message: `Failed to delete series file: ${err.message}` });
    }
    // ENOENT — файла и так нет, считаем удаление успешным (идемпотентно).
  }

  pair.deleteSymbol(symbol);
  // чистим историю логов пары, иначе после перезагрузки страницы её вкладка-
  // фильтр в консоли вернётся из replay logBus.history().
  logBus.clearSymbol(symbol);

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
