const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const JsonTimerSender = require('../modules/jsonTimerSender');
const { Status } = require('../lib/job');

// DEEP_ANALYSIS_PLAN.md §B.3 — «лишняя» запись файла после stop().
// Инвариант: если Stop нажат, пока #jobIterator ждёт ответа биржи в #runToApi,
// после резолва итератор НЕ должен трогать файл сетки (guard перед записью).
//
// #jobIterator приватный, поэтому гоняем его через публичный readLoop(): он
// читает файл сетки и запускает итератор. #filePath() жёстко указывает в
// src/data, поэтому перенаправляем запись во временную папку через относительный
// symbol (path.join(src/data, symbol) === tmp/<name>). Мокаем API.getOrder и job
// — биржа и расчёт здесь ни при чём, проверяем только момент записи.

const DATA_DIR = path.join(__dirname, '../data');

// obj сетки: long, набор не исчерпан (не все BUY FILLED) → recovery-консолидация
// не срабатывает, идём в обычную ветку обработки ордера.
const gridObj = () => ({
  status: Status.READY,
  pair: 'TESTUSDT',
  param: { 'field-activeOrders': '8', 'field-requestFrequency': '500' },
  BUY: [{ status: 'NEW', symbol: 'TESTUSDT', side: 'BUY', orderId: null }],
  SELL: [{ status: null, symbol: 'TESTUSDT', side: 'SELL', orderId: null }],
});

// getOrder-ответ, который двигает статус NEW → FILLED (currentOrder.status='NEW',
// message.status='FILLED' → не партиал, идём к Object.assign + записи).
const filledReply = () => ({
  success: true,
  message: {
    status: 'FILLED', orderId: 777, side: 'BUY',
    executedQty: '1', cummulativeQuoteQty: '10',
  },
});

// Поднимает sender с перенаправлением файла в tmp и моками API/job.
// flipStopDuringCall=true → API.getOrder выставляет running=false (Stop во время
// ожидания биржи).
async function setup(flipStopDuringCall) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'stopguard-'));
  // symbol такой, что path.join(DATA_DIR, `${symbol}-binance.json`) === tmp-файл
  const symbol = path.join(path.relative(DATA_DIR, dir), 'TESTUSDT');
  const file = path.join(dir, 'TESTUSDT-binance.json');

  await fs.writeFile(file, JSON.stringify(gridObj(), null, 2));

  const sender = new JsonTimerSender({}, 'long');
  sender.symbol = symbol;
  sender.running[symbol] = true;

  const flags = { apiCalled: false };
  sender.job = {
    long: () => ({ method: 'getOrder', data: { symbol }, status: 'NEW', id: 0 }),
  };
  sender.API = {
    getOrder: async () => {
      flags.apiCalled = true;
      if (flipStopDuringCall) sender.running[symbol] = false; // Stop во время await
      return filledReply();
    },
  };

  return { sender, symbol, file, dir, flags };
}

async function teardown({ sender, symbol, dir }) {
  sender.running[symbol] = false;
  clearTimeout(sender.timer);
  await fs.rm(dir, { recursive: true, force: true });
}

const waitUntil = async (fn, ms = 2000) => {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > ms) throw new Error('timeout waiting for iterator');
    await new Promise((r) => setTimeout(r, 10));
  }
};

test('stop during #runToApi → file NOT written after stop (frozen)', async () => {
  const ctx = await setup(true);
  try {
    ctx.sender.readLoop(); // запускает #jobIterator (busy=true)
    // ждём, пока биржу опросили (внутри итератора) и проход завершился
    await waitUntil(() => ctx.flags.apiCalled && ctx.sender.busy === false);

    const saved = JSON.parse(await fs.readFile(ctx.file, 'utf8'));
    // guard сработал до Object.assign/записи — файл остался исходным
    assert.equal(saved.BUY[0].status, 'NEW');
    assert.equal(saved.BUY[0].orderId, null);
    assert.equal('executedQty' in saved.BUY[0], false);
  } finally {
    await teardown(ctx);
  }
});

test('control: running stays true → file IS written (status persisted)', async () => {
  const ctx = await setup(false);
  try {
    ctx.sender.readLoop();
    await waitUntil(() => ctx.flags.apiCalled && ctx.sender.busy === false);

    const saved = JSON.parse(await fs.readFile(ctx.file, 'utf8'));
    // без stop guard пропускает — запись проходит как обычно
    assert.equal(saved.BUY[0].status, 'FILLED');
    assert.equal(saved.BUY[0].orderId, 777);
    assert.equal(saved.BUY[0].executedQty, 1);
  } finally {
    await teardown(ctx);
  }
});
