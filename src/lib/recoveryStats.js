// Read-only статистика возврата средств по прожитой сессии.
//
// По окончании цикла часть позиции может остаться невыкупленной (сетка не
// успела закрыть остаток — см. testnet-фитили / отставание тейк-профита).
// Эта функция по РЕАЛЬНЫМ исполнениям из архива считает два показателя и
// одну фразу: сколько осталось на руках и по какому курсу его продать
// (long) / выкупить (short), чтобы ВСЯ серия вышла не в убыток.
//
// Ничего не размещает на бирже и схему data/*.json не меняет — только читает.
//
// Переиспользует rebalanceClose: remainingBase = Σ entry.executedQty −
// Σ close.executedQty (зависший объём), remainingQuote = Σ entry.quote −
// Σ close.quote (застрявшие деньги). Комиссия передаётся БЕЗ profit — нам
// нужен безубыток серии, а не целевая прибыль закрытия.
const { rebalanceClose } = require('./rebalanceClose');

function recoveryStats(session) {
  if (!session || typeof session !== 'object') return null;

  const param = session.param || {};
  const strategy = param['field-strategy'] === 'short' ? 'short' : 'long';
  const commission = Number(param['field-commission']) || 0;
  const pricePrec = Number(param['field-tickSize']) || 2;
  const qtyPrec = Number(param['field-stepSize']) || 3;

  // long: набор BUY, закрытие SELL. short — зеркально.
  const entries = strategy === 'short' ? session.SELL : session.BUY;
  const closes = strategy === 'short' ? session.BUY : session.SELL;
  if (!Array.isArray(entries)) return null;

  const r = rebalanceClose(entries, closes, strategy, commission);
  if (!r) return null; // позиция закрыта целиком — возвращать нечего

  const strandedQty = Number(r.quantity.toFixed(qtyPrec));
  if (strandedQty <= 0) return null; // остаток в пределах пыли

  const base = (session.pair || '').replace(/(USDT|USDC|BUSD|FDUSD)$/i, '') || 'base';

  // avgEntryPrice <= 0 → закрывающая часть уже вернула все вложенные деньги,
  // серия в плюсе даже с остатком на руках.
  if (r.avgEntryPrice <= 0) {
    return {
      strategy,
      base,
      strandedQty,
      breakevenPrice: 0,
      alreadyProfit: true,
      text: `Series already in profit — the ${strandedQty} ${base} left over is pure profit.`,
    };
  }

  const breakevenPrice = Number(r.price.toFixed(pricePrec));
  const side = strategy === 'short' ? 'buy' : 'sell';
  const bound = strategy === 'short' ? 'no more than' : 'no less than';

  return {
    strategy,
    base,
    strandedQty,
    breakevenPrice,
    alreadyProfit: false,
    text: `If you want to stop the session, to break even you need to ${side} ${strandedQty} ${base} at ${bound} ${breakevenPrice}`,
  };
}

module.exports = { recoveryStats };
