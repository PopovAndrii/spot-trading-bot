const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const JsonTimerSender = require('../modules/jsonTimerSender');

// Manual single-order re-place (replaceManualOrder).
// Contract: re-place only a manually-pulled, already-CANCELED slot — its order is
// surely off the book, so a new placement can't double a live one. "Pulled" means
// an in-session pull (manualPulls) OR a persisted `manual` flag in the grid file
// (survives a process restart, when manualPulls is empty). CANCELED is required in
// both cases because manualPulls is now set optimistically, before the cancel ACK.
// Place on the exchange with the slot's quantity (server-sourced, not client) and
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

const senders = [];

async function setup() {
  await fs.writeFile(filePath, JSON.stringify(grid()), 'utf8');

  const sender = new JsonTimerSender({}, 'long');
  sender.symbol = SYMBOL;
  sender.running = true;
  // A successful re-place kicks an out-of-band tick (#kickTick) to persist soon.
  // Stub readLoop so that tick is a no-op here — we assert the schedule, not the
  // full loop (which would reschedule itself and keep the test process alive).
  sender.readLoop = async () => {};

  const calls = [];
  sender.API = {
    newOrder: async (data) => {
      calls.push(data);
      return { success: true, message: { orderId: 999, status: 'NEW' } };
    },
  };
  senders.push(sender);
  return { sender, calls };
}

test.after(() => {
  for (const s of senders) clearTimeout(s.timer);
  return fs.unlink(filePath).catch(() => {});
});

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
  assert.ok(sender.timer, 'kicked an out-of-band tick to persist the re-place'); // shrink crash window
});

test('replaceManualOrder: snaps price to tickSize decimals (PRICE_FILTER)', async () => {
  const { sender, calls } = await setup();
  // grid carrying price precision (tickSize = 2 decimals) in param
  await fs.writeFile(
    filePath,
    JSON.stringify({
      param: { 'field-tickSize': 2 },
      BUY: [{ status: 'CANCELED', orderId: 1, quantity: '0.5', price: '100', manual: true }],
      SELL: [],
    }),
    'utf8'
  );
  sender.manualPulls.BUY.add(0);

  const r = await sender.replaceManualOrder({ side: 'BUY', index: 0, price: '101.567' });

  assert.equal(r.success, true);
  assert.equal(calls[0].price, '101.57'); // snapped, not the raw 101.567
  assert.match(r.message, /101\.57/);
  assert.equal(sender.manualReplaces.BUY.get(0).price, '101.57');
});

test('replaceManualOrder: no tickSize in config → sends price as-is', async () => {
  const { sender, calls } = await setup(); // fixture grid() has no param
  sender.manualPulls.BUY.add(0);

  const r = await sender.replaceManualOrder({ side: 'BUY', index: 0, price: '101.567' });

  assert.equal(r.success, true);
  assert.equal(calls[0].price, '101.567'); // unchanged fallback
});

test('replaceManualOrder: persisted manual cancel (after restart) → allowed', async () => {
  // manualPulls empty (fresh process), but the grid file carries CANCELED+manual
  // on slot 0 — reconstruct the pull from the file so ＋ is not a dead button.
  const { sender, calls } = await setup();

  const r = await sender.replaceManualOrder({ side: 'BUY', index: 0, price: '101' });

  assert.equal(r.success, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].quantity, '0.5');
});

test('replaceManualOrder: not manually pulled (no flag, not in set) → fail', async () => {
  // slot 1 is a live NEW order the user never pulled — must never be re-placed over.
  const { sender, calls } = await setup(); // manualPulls empty

  const r = await sender.replaceManualOrder({ side: 'BUY', index: 1, price: '99' });

  assert.equal(r.success, false);
  assert.equal(calls.length, 0);
  assert.equal(sender.manualReplaces.BUY.size, 0);
});

test('replaceManualOrder: pulled but not CANCELED yet (optimistic window) → fail', async () => {
  // manualPulls is set optimistically before the cancel ACK (resurrection fix), so
  // a slot still NEW on the exchange must be rejected — placing now would double it.
  const { sender, calls } = await setup();
  sender.manualPulls.BUY.add(1); // slot 1 is still NEW in the fixture

  const r = await sender.replaceManualOrder({ side: 'BUY', index: 1, price: '99' });

  assert.equal(r.success, false);
  assert.match(r.message, /not cancelled/);
  assert.equal(calls.length, 0);
});

test('replaceManualOrder: not running / invalid price → fail, no API call', async () => {
  const { sender, calls } = await setup();
  sender.manualPulls.BUY.add(0);

  sender.running = false;
  assert.equal(
    (await sender.replaceManualOrder({ side: 'BUY', index: 0, price: '101' })).success,
    false
  );

  sender.running = true;
  assert.equal(
    (await sender.replaceManualOrder({ side: 'BUY', index: 0, price: '0' })).success,
    false
  );
  assert.equal(
    (await sender.replaceManualOrder({ side: 'BUY', index: 0, price: 'abc' })).success,
    false
  );

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
