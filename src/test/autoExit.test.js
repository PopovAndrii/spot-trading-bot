const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Job } = require('../lib/job');

// A micro that does not fit under the split is refused SILENTLY: the engine places no
// scalp and the cycle runs on as plain DCA. The table said "raise Grid exit %" and
// stopped there — leaving the only question that matters unanswered: raise it to WHAT.
// Live on ETHBTC the whole gap was one tick wide, so guessing costs a cycle.
//
// requiredGridExit answers it, and field-autoExit decides who turns the knob. The
// fixture is a frozen snapshot of that real ETHBTC cycle (blocked at Grid exit 76%),
// so the split runs through #fullClose off the actual fills — not a hand-set price
// that would fit by accident.
const FIXTURE = path.join(__dirname, 'fixtures', 'ethbtc-blocked.json');
const load = () => JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));

const viewOf = (obj, price = 0.02894) => {
  const j = new Job();
  j.price = price;
  j.hybridEnabled = true;
  return j.view(obj, 'long');
};

test('the fixture really is blocked at its saved Grid exit %', () => {
  const v = viewOf(load());
  assert.equal(v.fits, false);
  assert.equal(v.enabled, true);
  assert.ok(v.micro && v.split);
});

test('a blocked micro carries the percent that would fit', () => {
  const obj = load();
  const v = viewOf(obj);

  assert.ok(v.needExit > Number(obj.param['field-gridExit']),
    `expected a raise above ${obj.param['field-gridExit']}, got ${v.needExit}`);

  // and it is not a guess: at that value the micro really fits
  const fixed = load();
  fixed.param['field-gridExit'] = String(v.needExit);
  assert.equal(viewOf(fixed).fits, true);
});

test('the suggested percent is the LOWEST that fits — one below it still blocks', () => {
  const v = viewOf(load());
  const under = load();
  under.param['field-gridExit'] = String(v.needExit - 1);

  assert.equal(viewOf(under).fits, false);
});

test('a micro that already fits asks for nothing', () => {
  const obj = load();
  const v = viewOf(obj);
  obj.param['field-gridExit'] = String(v.needExit);

  const fixed = viewOf(obj);
  assert.equal(fixed.fits, true);
  assert.equal(fixed.needExit, null);
});

test('a micro too fat for the whole gap: no percent fits, so the answer is null', () => {
  // 2% take-profit on a gap worth a fraction of a percent — Grid exit % is the wrong
  // knob, and saying "raise it" would send the user chasing a number that cannot help.
  const obj = load();
  obj.param['field-microProfit'] = '2';
  const v = viewOf(obj);

  assert.equal(v.fits, false);
  assert.equal(v.needExit, null);
});

test('requiredGridExit stays an integer inside 0..100', () => {
  const obj = load();
  const j = new Job();
  j.price = 0.02894;
  j.hybridEnabled = true;
  const D = obj.BUY.reduce((d, o, i) => (o.status === 'FILLED' ? i : d), -1);
  const need = j.requiredGridExit(obj, D, 'long', '0.02904');

  assert.ok(Number.isInteger(need));
  assert.ok(need >= 0 && need <= 100);
});
