const test = require('node:test');
const assert = require('node:assert/strict');
const { pair, statusPair } = require('../lib/pair');

// Server-side write lock. pair.isRunning() is the shared
// source of truth used by /calculator/save to refuse overwriting a live
// order-state file while the bot is running for a symbol.

test('unknown symbol → not running', () => {
  assert.equal(pair.isRunning('NOPESUCH'), false);
});

test('START status → running', () => {
  pair.addSymbol({ symbol: 'BNBUSDT', status: statusPair.START });
  assert.equal(pair.isRunning('BNBUSDT'), true);
  pair.deleteSymbol('BNBUSDT');
});

test('STOP status → not running (save allowed after Stop)', () => {
  pair.addSymbol({ symbol: 'ETHUSDT', status: statusPair.START });
  pair.updateSymbol({ symbol: 'ETHUSDT', status: statusPair.STOP });
  assert.equal(pair.isRunning('ETHUSDT'), false);
  pair.deleteSymbol('ETHUSDT');
});

test('NEW status (subscribed, not started) → not running', () => {
  pair.addSymbol({ symbol: 'ADAUSDT', status: statusPair.NEW });
  assert.equal(pair.isRunning('ADAUSDT'), false);
  pair.deleteSymbol('ADAUSDT');
});
