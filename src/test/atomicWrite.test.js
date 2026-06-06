const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { writeFileAtomic } = require('../lib/atomicWrite');

// REQUIREMENTS.md п.22 — atomic config write (temp + rename) so a crash mid-write
// never leaves corrupt JSON in the source of truth.

test('writes content to the target file', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'atomic-'));
  const file = path.join(dir, 'BNBUSDT-binance.json');

  await writeFileAtomic(file, '{"a":1}');

  assert.equal(await fs.readFile(file, 'utf8'), '{"a":1}');
  await fs.rm(dir, { recursive: true, force: true });
});

test('overwrites an existing file wholesale', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'atomic-'));
  const file = path.join(dir, 'cfg.json');

  await writeFileAtomic(file, 'old-content-long');
  await writeFileAtomic(file, 'new');

  assert.equal(await fs.readFile(file, 'utf8'), 'new');
  await fs.rm(dir, { recursive: true, force: true });
});

test('leaves no .tmp files after a successful write', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'atomic-'));
  const file = path.join(dir, 'cfg.json');

  await writeFileAtomic(file, 'data');

  const leftovers = (await fs.readdir(dir)).filter((f) => f.endsWith('.tmp'));
  assert.deepEqual(leftovers, []);
  await fs.rm(dir, { recursive: true, force: true });
});

test('rejects and cleans up temp when the directory is missing', async () => {
  const missing = path.join(os.tmpdir(), 'no-such-dir-xyz', 'cfg.json');
  await assert.rejects(() => writeFileAtomic(missing, 'data'));
});
