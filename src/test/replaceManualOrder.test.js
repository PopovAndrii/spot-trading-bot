const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const JsonTimerSender = require('../modules/jsonTimerSender');

// DEEP_ANALYSIS_PLAN.md Item 10 — manual single-order re-place (replaceManualOrder).
// Contract: only a slot pulled THIS session (manualPulls) may be re-placed — its
// order is surely cancelled, so a new placement can't double the live order. Place
// on the exchange FIRST with the slot's quantity (server-sourced, not client) and
// the user's price, then record the replace so the engine adopts it as a normal
// NEW. A failed/invalid call records nothing and leaves the pull intact (retryable).
// Pure unit: the exchange call is mocked, the grid file is a throwaway fixture.

const SYMBOL = '__TESTREPL';
const filePath = path.join(__dirname, '../data', `${SYMBOL}-binance.json`);

const grid = () => ({
  BUY: [
    { status: 'CANCELED', orderId: 1, quantity: '0.5', price: '100', manual: true },
    { status: 'NEW', orderId: 2, quantity: '0.6', price: '99' },
  ],
  SELL: [],
});

async function setup() {
  await fs.writeFile(filePath, JSON.stringify(grid()), 'utf8');

  const sender = new JsonTimerSender({}, 'long');
  sender.symbol = SYMBOL;
  sender.running[SYMBOL] = true;

  const calls = [];
  sender.API = {
    newOrder: async (data) => {
      calls.push(data);
      return { success: true, message: { orderId: 999, status: 'NEW' } };
    },
  };
  return { sender, calls };
}

test.after(() => fs.unlink(filePath).catch(() => {}));

test('replaceManualOrder: places slot qty at user price, records the replace', async () => {
  const { sender, calls } = await setup();
  sender.manualPulls.BUY.add(0); // slot 0 was pulled this session

  const r = await sender.replaceManualOrder({ side: 'BUY', index: 0, price: '101.5' });

  assert.equal(r.success, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].quantity, '0.5'); // from the grid slot, NOT the client
  assert.equal(calls[0].price, '101.5'); // user's price
  assert.equal(calls[0].side, 'BUY');
  assert.equal(sender.manualPulls.BUY.has(0), false); // no longer "pulled"
  assert.deepEqual(sender.manualReplaces.BUY.get(0), {
    status: 'NEW',
    orderId: 999,
    price: '101.5',
  });
});

test('replaceManualOrder: slot not pulled this session → fail, no API call', async () => {
  const { sender, calls } = await setup(); // manualPulls empty

  const r = await sender.replaceManualOrder({ side: 'BUY', index: 0, price: '101' });

  assert.equal(r.success, false);
  assert.equal(calls.length, 0);
  assert.equal(sender.manualReplaces.BUY.size, 0);
});

test('replaceManualOrder: not running / invalid price → fail, no API call', async () => {
  const { sender, calls } = await setup();
  sender.manualPulls.BUY.add(0);

  sender.running[SYMBOL] = false;
  assert.equal((await sender.replaceManualOrder({ side: 'BUY', index: 0, price: '101' })).success, false);

  sender.running[SYMBOL] = true;
  assert.equal((await sender.replaceManualOrder({ side: 'BUY', index: 0, price: '0' })).success, false);
  assert.equal((await sender.replaceManualOrder({ side: 'BUY', index: 0, price: 'abc' })).success, false);

  assert.equal(calls.length, 0);
});

test('replaceManualOrder: exchange place fails → not recorded, pull kept', async () => {
  const { sender } = await setup();
  sender.manualPulls.BUY.add(0);
  sender.API.newOrder = async () => ({ success: false, message: 'insufficient balance' });

  const r = await sender.replaceManualOrder({ side: 'BUY', index: 0, price: '101' });

  assert.equal(r.success, false);
  assert.equal(sender.manualReplaces.BUY.size, 0);
  assert.equal(sender.manualPulls.BUY.has(0), true); // still pulled → retryable
});
