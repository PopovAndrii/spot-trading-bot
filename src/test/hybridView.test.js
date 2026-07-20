const test = require('node:test');
const assert = require('node:assert/strict');
const { Job } = require('../lib/job');

// Job.view is what the TABLE shows. It exists because the scalp was a black box:
// the plan columns keep showing the whole-position close, so a micro that was never
// placed and a micro resting on the book looked exactly the same — plain DCA. The
// view is produced by the same private helpers the engine trades on, so these tests
// pin the one property that matters: what the table says is what the robot does.
//
// The fixture is the real BNBUSDT cycle that started all of this — four filled rungs,
// hybrid armed from #4, where Grid exit 50 silently refused to scalp and 64 let it in.

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

const filled = (side, price, quantity) =>
  order(side, 'FILLED', price, quantity, {
    orderId: 1,
    executedQty: Number(quantity),
    cummulativeQuoteQty: Number(price) * Number(quantity),
  });

// gridExit is the only knob the tests move; everything else is the live config.
const cycle = (over = {}) => ({
  gridRealized: 0,
  param: {
    'field-strategy': 'long',
    'field-tickSize': '2',
    'field-stepSize': '3',
    'field-profit': '0.2',
    'field-commission': '0.20',
    'field-microProfit': '0.1',
    'field-gridExit': '64',
    'field-gridLevel': '3',
    'field-gridArm': '4',
    'field-hybrid': 'on',
    ...over,
  },
  BUY: [
    filled('BUY', '581.78', '0.018'),
    filled('BUY', '581.55', '0.030'),
    filled('BUY', '581.08', '0.050'),
    filled('BUY', '580.38', '0.085'),
    order('BUY', null, '579.22', '0.144'),
  ],
  SELL: [
    order('SELL', 'CANCELED', '584.11', '0.018'),
    order('SELL', 'CANCELED', '583.96', '0.048'),
    order('SELL', 'CANCELED', '583.68', '0.098'),
    order('SELL', null, '583.23', '0.183'),
    order('SELL', null, '582.48', '0.327'),
  ],
});

// Four rungs held, price sitting in the pause below the split.
const job = (price = '581.00') => {
  const j = new Job(false);
  j.price = price;
  return j;
};

test('view: reports the rung the scalp is aimed at and the one it carries', () => {
  const v = job().view(cycle(), 'long');

  assert.equal(v.enabled, true);
  assert.equal(v.arm, 4); // field-gridArm, 1-based — what "Grid from order" shows
  assert.equal(v.deepest, 4); // rung #4 is the deepest held → it carries the micro
});

test('view: the close is the REAL one, recomputed from the fills', () => {
  const v = job().view(cycle(), 'long');

  // 0.183 held, 106.30 spent → avg 580.90, +0.4% (profit + commission) = 583.22.
  // The plan column says 583.23: the plan is built off the ladder, the engine off
  // the fills, and this is the number the engine actually places.
  assert.equal(v.close.quantity, '0.183');
  assert.equal(v.close.price, '583.22');
});

test('view: the micro is the deepest rung own volume, at its own entry + micro profit', () => {
  const v = job().view(cycle(), 'long');

  // 580.38 × (1 + 0.1% micro profit + 0.2% commission) = 582.12, on rung #4's 0.085 —
  // NOT the 0.183 × 583.23 the SELL columns show. That gap is why the badge exists.
  assert.equal(v.micro.price, '582.12');
  assert.equal(v.micro.quantity, '0.085');
});

test('view: Grid exit 50 blocks the scalp — the table must say so, not look like DCA', () => {
  const v = job().view(cycle({ 'field-gridExit': '50' }), 'long');

  // split = 580.38 + (583.22 − 580.38) × 50% = 581.80, and the micro wants 582.12.
  assert.equal(v.split, '581.80');
  assert.equal(v.fits, false); // no room → the engine places NOTHING
  assert.equal(v.armed, false);
  assert.equal(v.resting, false);
});

test('view: Grid exit 64 lets it in — same cycle, one knob', () => {
  const v = job().view(cycle(), 'long');

  // split = 580.38 + 2.84 × 64% = 582.20, and 582.12 now fits under it.
  assert.equal(v.split, '582.20');
  assert.equal(v.fits, true);
  assert.equal(v.inZone, true); // price 581.00 is on the entry side of the split
  assert.equal(v.armed, true);
});

test('view: a lower Micro profit fits under the SAME 50% split', () => {
  const v = job().view(cycle({ 'field-gridExit': '50', 'field-microProfit': '0.02' }), 'long');

  assert.equal(v.micro.price, '581.66'); // 580.38 × 1.0022
  assert.equal(v.split, '581.80');
  assert.equal(v.fits, true); // the other way out of "blocked", and the badge names it
});

test('view: price past the split = waiting, not blocked — nothing to fix', () => {
  const v = job('583.00').view(cycle(), 'long');

  assert.equal(v.fits, true); // the micro would fit…
  assert.equal(v.inZone, false); // …but the price left the zone
  assert.equal(v.armed, false); // → the whole-position close rests instead
});

test('view: a resting micro is reported as resting, with its real price and volume', () => {
  const obj = cycle();
  obj.SELL[3] = order('SELL', 'NEW', '582.12', '0.085', { orderId: 6143954, role: 'micro' });

  const v = job().view(obj, 'long');

  assert.equal(v.resting, true);
  assert.equal(v.micro.price, '582.12');
  assert.equal(v.micro.quantity, '0.085');
});

test('view: a resting micro shows its REAL book price, not the recompute', () => {
  // The micro was placed at an OLDER, higher Micro profit % and rests at 583.10.
  // The knob was since lowered, so #gridClose now recomputes 582.12 — but the book
  // still holds 583.10, and the engine never re-prices a resting order. The badge
  // must show what is really on the exchange, or it reports a price that was never
  // there (the whole point of the resting branch).
  const obj = cycle();
  obj.SELL[3] = order('SELL', 'NEW', '583.10', '0.085', { orderId: 6143954, role: 'micro' });

  const v = job().view(obj, 'long');

  assert.equal(v.resting, true);
  assert.equal(v.micro.price, '583.10'); // the real book price, NOT the 582.12 recompute
  assert.equal(v.micro.quantity, '0.085');
});

test('view: banked oscillations surface — and each one pulls the close down', () => {
  const obj = cycle();
  obj.gridRealized = 0.2464;
  obj.SELL[3] = order('SELL', null, '583.23', '0.183', { hybrid: 3 });

  const v = job().view(obj, 'long');

  assert.equal(v.banked, 0.2464);
  // The bank is realized money of this cycle: the close no longer has to recover
  // it. (106.30484 − 0.2464) / 0.183 × 1.004 = 581.87 — down from 583.22. The
  // scalp's profit now does the work of the martingale volume the re-arm took back.
  assert.equal(v.close.price, '581.87');
});

test('view: rungs above the arm are pure DCA — no micro is described at all', () => {
  const obj = cycle({ 'field-gridArm': '5' }); // scalp only from rung #5, we hold #4
  const v = job().view(obj, 'long');

  assert.equal(v.arm, 5);
  assert.equal(v.deepest, 4);
  assert.equal(v.micro, null); // nothing to show: this rung can never scalp
  assert.equal(v.close.price, '583.22'); // the classic close still does
});

test('view: hybrid off is reported off, and the ladder still shows its real close', () => {
  const v = job().view(cycle({ 'field-hybrid': 'off' }), 'long');

  assert.equal(v.enabled, false);
  assert.equal(v.armed, false); // the bar and the zone tint hide on this
  assert.equal(v.close.price, '583.22');
});

test('view: an empty cycle says so instead of inventing a pause', () => {
  const obj = cycle();
  obj.BUY = obj.BUY.map((o) => order('BUY', null, o.price, o.quantity));

  const v = job().view(obj, 'long');

  assert.equal(v.deepest, null);
  assert.equal(v.close, null);
  assert.equal(v.micro, null);
  assert.equal(v.split, null);
});

test('view: unknown live price = no split, no scalp — the engine stays classic', () => {
  const j = new Job(false);
  j.price = null;

  const v = j.view(cycle(), 'long');

  assert.equal(v.price, null);
  assert.equal(v.split, '582.20'); // the split is a property of the ladder, not the tick…
  assert.equal(v.inZone, false); // …but without a price there is no zone to be in
  assert.equal(v.armed, false);
});

test('view: short mirrors long — the micro is a buy-back BELOW the deepest sell', () => {
  // A short ladder sells INTO the rise, so the entries ascend and the deepest held
  // rung is the highest sell. Everything else is the mirror: the close sits below
  // the average, the pause is the gap under the deepest sell, and the micro buys
  // that rung's own volume back inside it.
  const obj = cycle({ 'field-strategy': 'short' });
  obj.SELL = [
    filled('SELL', '578.00', '0.018'),
    filled('SELL', '578.50', '0.030'),
    filled('SELL', '579.20', '0.050'),
    filled('SELL', '580.38', '0.085'),
  ];
  obj.BUY = [
    order('BUY', null, '576.00', '0.018'),
    order('BUY', null, '576.00', '0.048'),
    order('BUY', null, '576.00', '0.098'),
    order('BUY', null, '576.00', '0.183'),
  ];

  const v = job('579.00').view(obj, 'short'); // price ABOVE the split = in the zone

  assert.equal(v.micro.price, '578.64'); // 580.38 × (1 − 0.1% micro − 0.2% commission)
  assert.equal(v.split, '578.34');
  assert.equal(v.fits, true); // short fits when the micro stays ABOVE the split
  assert.equal(v.inZone, true);
  assert.equal(v.armed, true);
});

// The FORECAST half: Calculator.microFits answers "will the scalp be allowed on this
// rung once it fills?" off the planned ladder, before a single order is placed. It is
// the same split the engine draws (gridExitThreshold) — so the ✓/✗ in the table and
// the engine's silence can never disagree.
const { Calculator } = require('../lib/calculator');

const plan = (over = {}) =>
  Calculator.build(
    {
      'field-currency': '579.20',
      'field-strategy': 'long',
      'field-tickSize': 2,
      'field-stepSize': 3,
      'field-deposit': '8890.95',
      'field-orderSize': '0.018',
      'field-profit': 0.2,
      'field-commission': 0.2,
      'field-martingail': 68,
      'field-fibonachiStep': 0.04,
      'field-indent': 0.05,
      'field-activeOrders': 12,
      'strategyList': 'fibonacci',
      'field-hybrid': 'on',
      'field-microProfit': 0.1,
      'field-gridExit': 50,
      ...over,
    },
    'long'
  );

test('forecast: Grid exit 50 is too tight for the shallow rungs of a narrow ladder', () => {
  const rows = plan();

  // BNBUSDT rungs sit tenths of a percent apart, and the micro needs 0.3% (micro
  // profit + commission). Aiming the scalp at #3 with Grid exit 50 buys nothing:
  // the engine will place no micro at all and the cycle runs as plain DCA.
  assert.equal(rows[2].microFits, false);
  assert.equal(rows[3].microFits, false);
  assert.equal(rows[4].microFits, false);
  assert.equal(rows[5].microFits, true); // the ladder is wide enough only by #6
});

test('forecast: Grid exit 68 opens the rung the scalp is actually aimed at', () => {
  const rows = plan({ 'field-gridExit': 68 });

  assert.equal(rows[2].microFits, true);
  assert.equal(rows[3].microFits, true);
});

test('forecast: a smaller Micro profit is the other way in — same 50% split', () => {
  const rows = plan({ 'field-microProfit': 0.02 });

  assert.equal(rows[2].microFits, true); // the micro drops under the split instead
});

test('forecast: the split is the one the engine draws, at tick precision', () => {
  const rows = plan();
  const r = rows[2];

  // split = entry + (whole-position close − entry) × 50%
  const expected = (
    parseFloat(r.buyCurrency) +
    (parseFloat(r.sellCurrency) - parseFloat(r.buyCurrency)) * 0.5
  ).toFixed(2);
  assert.equal(r.microSplit, expected);
});

test('forecast: classic cycles carry no forecast at all', () => {
  const rows = plan({ 'field-hybrid': 'off' });

  assert.equal(rows[2].microFits, undefined); // → the table draws no ✓/✗
  assert.equal(rows[2].microSplit, undefined);
});
