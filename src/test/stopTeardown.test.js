const test = require('node:test');
const assert = require('node:assert/strict');
const JsonTimerSender = require('../modules/jsonTimerSender');

// stop() must complete the running→stopped transition even when the exchange-side
// teardown blows up. It is called fire-and-forget from the DONE branch, so before
// this the order was: tear the streams down, THEN flip `running`. A throw in
// between (getUserStream() is null while the socket is mid-reconnect — exactly what
// a burst of fills provokes) left the engine reporting itself alive forever: the
// cycle was finished and archived, but getSpotStatus kept saying "running", the
// 'stopped' event never reached the router, and the UI stayed locked on Stop with
// no way back short of a server restart. That is a live cycle you cannot start.
//
// The invariant: nothing in stop() may gate the state flip or the 'stopped' event.

const sender = () => {
  const ts = new JsonTimerSender(null, 'long');
  ts.symbol = 'BNBUSDT';
  ts.running = true;
  ts.watching = true;
  return ts;
};

test('stop: a throwing stream teardown still stops the engine', async () => {
  const ts = sender();
  ts.onExecReport = () => {};
  ts.API = {
    getUserStream() {
      throw new Error('socket is reconnecting');
    },
  };

  const stopped = [];
  ts.on('stopped', (s) => stopped.push(s));

  await ts.stop();

  assert.equal(ts.running, false);
  assert.equal(ts.getSpotStatus('BNBUSDT'), false); // what the UI asks on every connect
  assert.deepEqual(stopped, ['BNBUSDT']); // what unlocks the buttons
});

test('stop: a null user stream is not a reason to stay running', async () => {
  const ts = sender();
  ts.onExecReport = () => {};
  ts.API = { getUserStream: () => null }; // dropped socket, no listeners to pull

  const stopped = [];
  ts.on('stopped', (s) => stopped.push(s));

  await ts.stop();

  assert.equal(ts.running, false);
  assert.deepEqual(stopped, ['BNBUSDT']);
});

test('stop: the clean path still tears the exec-report listener down', async () => {
  const ts = sender();
  const handler = () => {};
  ts.onExecReport = handler;

  const removed = [];
  ts.API = {
    getUserStream: () => ({
      removeListener: (event, fn) => removed.push([event, fn]),
    }),
  };

  await ts.stop();

  assert.deepEqual(removed, [['executionReport', handler]]);
  assert.equal(ts.onExecReport, null);
  assert.equal(ts.running, false);
});

test('stop: repeated stop is idempotent and still reports stopped', async () => {
  const ts = sender();
  ts.API = { getUserStream: () => null };

  const stopped = [];
  ts.on('stopped', (s) => stopped.push(s));

  await ts.stop();
  await ts.stop(); // cleanup / shutdown sweep hits stop() again

  assert.equal(ts.running, false);
  assert.deepEqual(stopped, ['BNBUSDT', 'BNBUSDT']);
});
