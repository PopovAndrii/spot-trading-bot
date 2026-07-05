const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { Calculator } = require('../lib/calculator');

// Money in float + toFixed. The logic is NOT changed;
// this is a safety-net golden: it pins the current Calculator.build() output
// bit-for-bit across a set of inputs (long/short, progressive/fibonacci, indent).
// Any future money-arithmetic refactor (decimal.js / integer ticks) must produce
// the same result — otherwise the test fails and a digit shift becomes visible
// before deploy.
//
// The reference lives in fixtures/calculatorGolden.json (under version control).
// An intentional behavior change = deliberately regenerate the fixture with the
// same script and review the diff, rather than hand-editing the numbers.

const GOLDEN = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures', 'calculatorGolden.json'), 'utf8')
);

for (const [name, { settings, strategy, expected }] of Object.entries(GOLDEN)) {
  test(`golden: ${name} (${strategy}) — grid is bit-for-bit stable`, () => {
    const actual = Calculator.build(settings, strategy);
    assert.deepEqual(actual, expected);
  });
}

// Guard against an "empty" golden: if the fixture is accidentally zeroed out, the
// tests above would pass on nothing — this test requires non-empty coverage.
test('golden fixture is non-empty and every case has rows', () => {
  const names = Object.keys(GOLDEN);
  assert.ok(names.length >= 4);
  for (const name of names) {
    assert.ok(Array.isArray(GOLDEN[name].expected) && GOLDEN[name].expected.length > 0, name);
  }
});
