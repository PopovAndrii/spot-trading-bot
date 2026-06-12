const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const { archiveIfActive } = require('../lib/cycleArchive');

// История циклов: прожитый цикл архивируется перед перезаписью Save,
// нетронутый расчёт — нет.

async function withTmpDir(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'archive-test-'));
  try {
    return await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

const order = (status, orderId) => ({ status, orderId, side: 'BUY' });

test('cycle with placed orders → archived copy with same content', async () => {
  await withTmpDir(async (dir) => {
    const filePath = path.join(dir, 'BNBUSDT-binance.json');
    const config = JSON.stringify({
      pair: 'BNBUSDT',
      BUY: [order('FILLED', 1), order('NEW', 2)],
      SELL: [order(null, null)],
    });
    await fs.writeFile(filePath, config);

    const archived = await archiveIfActive(filePath);

    assert.ok(archived, 'archive path returned');
    assert.match(path.basename(archived), /^\d+-BNBUSDT-binance\.json$/);
    assert.equal(await fs.readFile(archived, 'utf8'), config);
    // основной файл не тронут — его перезапишет writeFileAtomic после
    assert.equal(await fs.readFile(filePath, 'utf8'), config);
  });
});

test('never-started config (no orderId) → no archive', async () => {
  await withTmpDir(async (dir) => {
    const filePath = path.join(dir, 'BNBUSDT-binance.json');
    await fs.writeFile(
      filePath,
      JSON.stringify({ BUY: [order(null, null)], SELL: [order(null, null)] })
    );

    assert.equal(await archiveIfActive(filePath), null);
    // в каталоге только исходный файл, архив не появился
    assert.deepEqual(await fs.readdir(dir), ['BNBUSDT-binance.json']);
  });
});

test('missing file (first Save) → null, no throw', async () => {
  await withTmpDir(async (dir) => {
    assert.equal(await archiveIfActive(path.join(dir, 'NOPE-binance.json')), null);
  });
});

test('broken JSON → null, no throw', async () => {
  await withTmpDir(async (dir) => {
    const filePath = path.join(dir, 'BNBUSDT-binance.json');
    await fs.writeFile(filePath, '{ not json');
    assert.equal(await archiveIfActive(filePath), null);
  });
});
