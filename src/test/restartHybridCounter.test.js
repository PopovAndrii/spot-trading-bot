const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const JsonTimerSender = require('../modules/jsonTimerSender');

// Auto-restart rebuilds the grid file from scratch, so the per-cycle stats
// (gridRealized/gridCycles/gridCounts) reset by design. The cumulative `hybrid`
// counter (micro fills of the SERIES, bumped by bankGridLeg) must be the one
// thing carried over — two looped testnet cycles wiped it before this fix.
//
// restartCycle writes to src/data/<symbol>-binance.json; like the stop-guard
// test we redirect the write into a temp dir via a relative symbol.

const DATA_DIR = path.join(__dirname, '../data');

function doneCycleObj() {
  return {
    status: 3,
    restart: true,
    hybrid: 7, // micros banked across the series so far
    gridRealized: 1.26,
    gridCycles: 4,
    gridCounts: { 2: 4 },
    param: {
      'field-currency': '100',
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
    },
    BUY: [],
    SELL: [],
  };
}

test('restartCycle: cumulative hybrid counter survives, per-cycle stats reset', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'restart-hybrid-'));
  const symbol = path.join(path.relative(DATA_DIR, dir), 'TESTUSDT');
  const file = path.join(dir, 'TESTUSDT-binance.json');

  const sender = new JsonTimerSender({}, 'long');
  sender.symbol = symbol;
  sender.strategy = 'long';
  sender.API = {
    bookTicker: async () => ({
      success: true,
      message: { askPrice: '100.00', bidPrice: '99.98' },
    }),
  };

  await sender.restartCycle(doneCycleObj());

  const written = JSON.parse(await fs.readFile(file, 'utf8'));
  assert.equal(written.hybrid, 7); // carried over
  assert.equal(written.status, 0); // fresh cycle
  assert.equal(written.restart, true);
  assert.ok(!('gridRealized' in written)); // per-cycle stats start clean
  assert.ok(!('gridCycles' in written));
  assert.ok(!('gridCounts' in written));
  assert.ok(written.BUY.length > 0); // grid actually rebuilt

  await fs.rm(dir, { recursive: true, force: true });
});

test('restartCycle: old config without the counter → starts at 0', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'restart-hybrid-'));
  const symbol = path.join(path.relative(DATA_DIR, dir), 'TESTUSDT');
  const file = path.join(dir, 'TESTUSDT-binance.json');

  const sender = new JsonTimerSender({}, 'long');
  sender.symbol = symbol;
  sender.strategy = 'long';
  sender.API = {
    bookTicker: async () => ({
      success: true,
      message: { askPrice: '100.00', bidPrice: '99.98' },
    }),
  };

  const obj = doneCycleObj();
  delete obj.hybrid;
  await sender.restartCycle(obj);

  const written = JSON.parse(await fs.readFile(file, 'utf8'));
  assert.equal(written.hybrid, 0);

  await fs.rm(dir, { recursive: true, force: true });
});
