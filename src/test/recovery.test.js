const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const { scanLiveCycles } = require('../lib/recovery');

// ANALYSIS.md item 1.5 — after a server restart, configs with live orders
// (NEW/PARTIALLY_FILLED + orderId) must be found by the recovery scan.

async function withTmpDir(files, fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'recovery-test-'));
  try {
    for (const [name, content] of Object.entries(files)) {
      await fs.writeFile(path.join(dir, name), content);
    }
    return await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

const order = (status, orderId) => ({ status, orderId, side: 'BUY' });

test('live NEW order with orderId → found', async () => {
  const config = JSON.stringify({
    pair: 'BNBUSDT',
    BUY: [order('NEW', 123), order(null, null)],
    SELL: [order(null, null)],
  });

  await withTmpDir({ 'BNBUSDT-binance.json': config }, async (dir) => {
    const found = await scanLiveCycles(dir);
    assert.deepEqual(found, [{ symbol: 'BNBUSDT', file: 'BNBUSDT-binance.json', liveOrders: 1 }]);
  });
});

test('PARTIALLY_FILLED on SELL side counts as live', async () => {
  const config = JSON.stringify({
    pair: 'BTCUSDT',
    BUY: [order('FILLED', 1)],
    SELL: [order('PARTIALLY_FILLED', 2)],
  });

  await withTmpDir({ 'BTCUSDT-binance.json': config }, async (dir) => {
    const found = await scanLiveCycles(dir);
    assert.equal(found.length, 1);
    assert.equal(found[0].liveOrders, 1);
  });
});

test('DONE cycle with stale NEW insurance orders → not found (false positive)', async () => {
  // the final cancelOpenOrders pulls the orders on the exchange, but in old files
  // their statuses stayed NEW — the file's DONE status is authoritative
  const config = JSON.stringify({
    pair: 'BNBUSDT',
    status: 3, // Status.DONE
    BUY: [order('FILLED', 1), order('NEW', 2)],
    SELL: [order('FILLED', 3), order('NEW', 4)],
  });

  await withTmpDir({ 'BNBUSDT-binance.json': config }, async (dir) => {
    assert.deepEqual(await scanLiveCycles(dir), []);
  });
});

test('finished cycle (FILLED/CANCELED only) → not found', async () => {
  const config = JSON.stringify({
    pair: 'BNBUSDT',
    BUY: [order('FILLED', 1), order('CANCELED', 2)],
    SELL: [order('FILLED', 3)],
  });

  await withTmpDir({ 'BNBUSDT-binance.json': config }, async (dir) => {
    assert.deepEqual(await scanLiveCycles(dir), []);
  });
});

test('NEW status without orderId (never placed) → not live', async () => {
  const config = JSON.stringify({
    pair: 'BNBUSDT',
    BUY: [order('NEW', null), order(null, null)],
    SELL: [],
  });

  await withTmpDir({ 'BNBUSDT-binance.json': config }, async (dir) => {
    assert.deepEqual(await scanLiveCycles(dir), []);
  });
});

test('timestamped archives and non-JSON files are skipped', async () => {
  const live = JSON.stringify({ pair: 'BNBUSDT', BUY: [order('NEW', 5)], SELL: [] });

  await withTmpDir(
    {
      '1779992341074-BTCUSDT-binance.json': live, // autoRestart archive
      'readme.txt': 'not json',
      'BNBUSDT-binance.json': live,
    },
    async (dir) => {
      const found = await scanLiveCycles(dir);
      assert.equal(found.length, 1);
      assert.equal(found[0].file, 'BNBUSDT-binance.json');
    }
  );
});

test('broken JSON does not crash the scan', async () => {
  const live = JSON.stringify({ pair: 'BNBUSDT', BUY: [order('NEW', 5)], SELL: [] });

  await withTmpDir(
    { 'broken-binance.json': '{ not json', 'BNBUSDT-binance.json': live },
    async (dir) => {
      const found = await scanLiveCycles(dir);
      assert.equal(found.length, 1);
    }
  );
});

test('missing directory → empty list', async () => {
  assert.deepEqual(await scanLiveCycles('/nonexistent/dir'), []);
});
