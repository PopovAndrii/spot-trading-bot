const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const JsonTimerSender = require('../modules/jsonTimerSender');
const { Status } = require('../lib/job');

// DEEP_ANALYSIS_PLAN.md §B.3 — a "spurious" file write after stop().
// Invariant: if Stop is pressed while #jobIterator is awaiting the exchange in
// #runToApi, after the resolve the iterator must NOT touch the grid file (guard
// before the write).
//
// #jobIterator is private, so we drive it via the public readLoop(): it reads the
// grid file and runs the iterator. #filePath() points hard into src/data, so we
// redirect the write to a temp folder via a relative symbol (path.join(src/data,
// symbol) === tmp/<name>). We mock API.getOrder and job — the exchange and the
// calculation are irrelevant here, we only check the moment of the write.

const DATA_DIR = path.join(__dirname, '../data');

// grid obj: long, entry not exhausted (not all BUY FILLED) → recovery
// consolidation doesn't trigger, we go down the normal order-processing branch.
const gridObj = () => ({
  status: Status.READY,
  pair: 'TESTUSDT',
  param: { 'field-activeOrders': '8', 'field-requestFrequency': '500' },
  BUY: [{ status: 'NEW', symbol: 'TESTUSDT', side: 'BUY', orderId: null }],
  SELL: [{ status: null, symbol: 'TESTUSDT', side: 'SELL', orderId: null }],
});

// a getOrder reply that moves the status NEW → FILLED (currentOrder.status='NEW',
// message.status='FILLED' → not a partial, we go to Object.assign + write).
const filledReply = () => ({
  success: true,
  message: {
    status: 'FILLED',
    orderId: 777,
    side: 'BUY',
    executedQty: '1',
    cummulativeQuoteQty: '10',
  },
});

// Spins up a sender with the file redirected to tmp and API/job mocks.
// flipStopDuringCall=true → API.getOrder sets running=false (Stop while waiting
// on the exchange).
async function setup(flipStopDuringCall) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'stopguard-'));
  // symbol such that path.join(DATA_DIR, `${symbol}-binance.json`) === the tmp file
  const symbol = path.join(path.relative(DATA_DIR, dir), 'TESTUSDT');
  const file = path.join(dir, 'TESTUSDT-binance.json');

  await fs.writeFile(file, JSON.stringify(gridObj(), null, 2));

  const sender = new JsonTimerSender({}, 'long');
  sender.symbol = symbol;
  sender.running[symbol] = true;

  const flags = { apiCalled: false };
  sender.job = {
    long: () => ({ method: 'getOrder', data: { symbol }, status: 'NEW', id: 0 }),
  };
  sender.API = {
    getOrder: async () => {
      flags.apiCalled = true;
      if (flipStopDuringCall) sender.running[symbol] = false; // Stop during the await
      return filledReply();
    },
  };

  return { sender, symbol, file, dir, flags };
}

async function teardown({ sender, symbol, dir }) {
  sender.running[symbol] = false;
  clearTimeout(sender.timer);
  await fs.rm(dir, { recursive: true, force: true });
}

const waitUntil = async (fn, ms = 2000) => {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > ms) throw new Error('timeout waiting for iterator');
    await new Promise((r) => setTimeout(r, 10));
  }
};

test('stop during #runToApi → file NOT written after stop (frozen)', async () => {
  const ctx = await setup(true);
  try {
    ctx.sender.readLoop(); // starts #jobIterator (busy=true)
    // wait until the exchange was polled (inside the iterator) and the pass finished
    await waitUntil(() => ctx.flags.apiCalled && ctx.sender.busy === false);

    const saved = JSON.parse(await fs.readFile(ctx.file, 'utf8'));
    // the guard fired before Object.assign/write — the file stayed as the original
    assert.equal(saved.BUY[0].status, 'NEW');
    assert.equal(saved.BUY[0].orderId, null);
    assert.equal('executedQty' in saved.BUY[0], false);
  } finally {
    await teardown(ctx);
  }
});

test('control: running stays true → file IS written (status persisted)', async () => {
  const ctx = await setup(false);
  try {
    ctx.sender.readLoop();
    await waitUntil(() => ctx.flags.apiCalled && ctx.sender.busy === false);

    const saved = JSON.parse(await fs.readFile(ctx.file, 'utf8'));
    // without a stop the guard passes — the write goes through as usual
    assert.equal(saved.BUY[0].status, 'FILLED');
    assert.equal(saved.BUY[0].orderId, 777);
    assert.equal(saved.BUY[0].executedQty, 1);
  } finally {
    await teardown(ctx);
  }
});
