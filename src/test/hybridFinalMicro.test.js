const test = require('node:test');
const assert = require('node:assert/strict');
const { Job, Status } = require('../lib/job');

// A filled micro is normally a banked oscillation: bank it, re-arm the rung, let its
// entry re-buy the same dip. But a micro that sold the LAST volume the cycle held is
// not an oscillation — it is the exit. Re-arming there re-opens a position the cycle
// had already left, with the whole ladder below it still armed.
//
// Seen live on BNBUSDT: the price rose, the micro on rung #4 filled (banked +0.15),
// the price kept rising and the whole-position close of rungs #1-3 filled right
// behind it. The books were square and in profit — and the re-arm bought rung #4
// straight back, into a crash that then walked the ladder down to rung #9.
//
// The invariant: when nothing is held any more, the cycle ENDS — and the last
// oscillation is still banked on the way out, because that money is real.

const order = (side, status, price, quantity, over = {}) => ({
  status,
  symbol: 'BNBUSDT',
  side,
  type: 'LIMIT',
  quantity,
  price,
  timeInForce: 'GTC',
  orderId: null,
  ...over,
});

const filled = (side, price, quantity, over = {}) =>
  order(side, 'FILLED', price, quantity, {
    orderId: 1,
    executedQty: Number(quantity),
    cummulativeQuoteQty: Number(price) * Number(quantity),
    ...over,
  });

// The live cycle at the moment the micro on rung #4 filled: four rungs held, the
// micro's own fills still on the slot. `closedBelow` = the whole-position close of
// rungs #1-3 filled too, i.e. the position is now flat.
const cycle = ({ closedBelow = false } = {}) => ({
  gridRealized: 0,
  param: {
    'field-strategy': 'long',
    'field-tickSize': '2',
    'field-stepSize': '3',
    'field-profit': '0.2',
    'field-commission': '0.20',
    'field-microProfit': '0.09',
    'field-gridExit': '65',
    'field-gridLevel': '3',
    'field-gridArm': '4',
    'field-hybrid': 'on',
  },
  BUY: [
    filled('BUY', '579.06', '0.018'),
    filled('BUY', '578.83', '0.030'),
    filled('BUY', '578.37', '0.052'),
    filled('BUY', '577.67', '0.088'),
    order('BUY', null, '576.52', '0.151'),
  ],
  SELL: [
    order('SELL', 'CANCELED', '581.38', '0.018'),
    order('SELL', 'CANCELED', '581.23', '0.048'),
    closedBelow
      ? filled('SELL', '580.95', '0.100')
      : order('SELL', 'NEW', '580.95', '0.100', { orderId: 6166786 }),
    filled('SELL', '579.35', '0.088', { role: 'micro', orderId: 6167033 }),
    order('SELL', null, '579.75', '0.339'),
  ],
});

const job = () => {
  const j = new Job(false);
  j.price = '580.00';
  return j;
};

test('final micro: the position is flat → the cycle ends, it does not re-arm', () => {
  const obj = cycle({ closedBelow: true });
  const r = job().hybridLong(obj, 3, obj.BUY[3]);

  assert.equal(r.status, Status.DONE);
  assert.equal(r.method, 'cancelOpenOrders'); // the armed ladder below must come off
  assert.notEqual(r.status, 'REARM');
});

test('final micro: the last oscillation is still banked on the way out', () => {
  const obj = cycle({ closedBelow: true });
  const r = job().hybridLong(obj, 3, obj.BUY[3]);

  // `bank` names the rung whose leg the engine must fold into gridRealized BEFORE it
  // closes the books — re-arming clears the fills the profit is computed from.
  assert.equal(r.bank, 3);
});

test('final micro: something still held → a normal banked oscillation', () => {
  const obj = cycle({ closedBelow: false }); // rungs #1-3 (0.100) are still open
  const r = job().hybridLong(obj, 3, obj.BUY[3]);

  assert.equal(r.status, 'REARM');
  assert.equal(r.bank, undefined); // the REARM handler banks it, as it always has
});

test('final micro: a deeper rung still held keeps the wheel turning', () => {
  const obj = cycle({ closedBelow: true });
  obj.BUY[4] = filled('BUY', '576.52', '0.151'); // the dip went further and refilled

  const r = job().hybridLong(obj, 3, obj.BUY[3]);

  assert.equal(r.status, 'REARM'); // 0.151 is still on the books → not the exit
});

test('final micro: an old config without fill data never ends itself', () => {
  const obj = cycle({ closedBelow: true });
  delete obj.BUY[0].executedQty; // pre-executedQty cycle: the held size is unknowable

  const r = job().hybridLong(obj, 3, obj.BUY[3]);

  assert.equal(r.status, 'REARM'); // "cannot tell" must never read as "closed"
});

test('final micro: short mirrors long', () => {
  const obj = cycle({ closedBelow: true });
  obj.param['field-strategy'] = 'short';
  // mirror the fixture: entries are SELLs, closes are BUY-backs
  [obj.BUY, obj.SELL] = [obj.SELL, obj.BUY];
  obj.SELL = obj.SELL.map((o) => ({ ...o, side: 'SELL' }));
  obj.BUY = obj.BUY.map((o) => ({ ...o, side: 'BUY' }));

  const r = job().hybridShort(obj, 3, obj.SELL[3]);

  assert.equal(r.status, Status.DONE);
  assert.equal(r.bank, 3);
});
