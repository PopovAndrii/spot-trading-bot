const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const JsonTimerSender = require('../modules/jsonTimerSender');

// restartCycle rebuilds the grid around the fresh price from bookTicker, which
// Binance returns padded to 8 decimals ("582.22000000"). A first Start stores a
// clean parseFloat'd value, so the restarted config must match — field-currency
// trimmed to the pair's tick precision (numeric value unchanged).

const DATA_DIR = path.join(__dirname, '../data');

function doneObj(over = {}) {
  return {
    status: 3,
    restart: true,
    param: {
      'field-strategy': 'long',
      'field-deposit': '1000',
      'field-orderSize': '1',
      'field-profit': '0.2',
      'field-commission': '0.2',
      'field-fibonachiStep': '0.2',
      'field-martingail': '49',
      'field-indent': '0.1',
      'field-gridLevel': '3',
      'field-microProfit': '0.1',
      'field-gridExit': '50',
      'field-activeOrders': '3',
      'field-requestFrequency': '1000',
      'field-stepSize': '3',
      'field-tickSize': '2',
      'field-hybrid': 'on',
      ...over,
    },
    BUY: [],
    SELL: [],
  };
}

async function drive(strategy, ticker, obj) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'restart-price-'));
  const symbol = path.join(path.relative(DATA_DIR, dir), 'TESTUSDT');
  const file = path.join(dir, 'TESTUSDT-binance.json');

  const sender = new JsonTimerSender({}, strategy);
  sender.symbol = symbol;
  sender.strategy = strategy;
  sender.API = { bookTicker: async () => ({ success: true, message: ticker }) };

  await sender.restartCycle(obj);
  const written = JSON.parse(await fs.readFile(file, 'utf8'));
  await fs.rm(dir, { recursive: true, force: true });
  return written;
}

test('restart long: askPrice padded to 8 decimals → trimmed to tickSize', async () => {
  const w = await drive('long', { askPrice: '582.22000000', bidPrice: '582.20000000' }, doneObj());
  assert.equal(w.param['field-currency'], '582.22'); // not "582.22000000"
});

test('restart short: bidPrice trimmed the same way', async () => {
  const w = await drive(
    'short',
    { askPrice: '582.22000000', bidPrice: '582.20000000' },
    doneObj({ 'field-strategy': 'short' })
  );
  assert.equal(w.param['field-currency'], '582.20');
});

test('restart: trim honors the pair tick precision (tickSize 5)', async () => {
  const w = await drive(
    'long',
    { askPrice: '0.10794235', bidPrice: '0.10793000' },
    doneObj({ 'field-tickSize': '5', 'field-currency': '0.10794' })
  );
  assert.equal(w.param['field-currency'], '0.10794'); // 8-decimal ask → 5 decimals
});
