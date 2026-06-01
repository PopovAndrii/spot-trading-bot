// Этап 2: пересчёт усреднённого ЗАКРЫВАЮЩЕГО ордера после частичного исполнения.
//
// Контекст (long): позиция набирается BUY-ордерами (тратим quote, получаем base),
// закрывается одним SELL по усреднённой цене с прибылью. Если активный SELL
// частично исполнился (часть base уже продана), а затем сработал следующий BUY,
// прежний план SELL становится неверным: на руках меньше base и часть прибыли
// уже реализована. Эта функция считает новый объём и цену закрытия по РЕАЛЬНЫМ
// исполнениям (executedQty / cummulativeQuoteQty из getOrderFill).
//
// Для short — зеркально: позицию набирают SELL, закрывает BUY ниже по цене.
//
// entries  — реально исполненные ордера набора позиции:
//            [{ executedQty, cummulativeQuoteQty }]  (BUY для long / SELL для short)
// closes   — частично исполненные закрывающие ордера (которые отменили) за цикл:
//            массив [{ executedQty, cummulativeQuoteQty }] | один объект | null.
//            За цикл их может быть несколько (SELL[0], SELL[1]…), вычитаем сумму.
// strategy — 'long' | 'short'
// feesPct  — profit% + commission% (например 0.45)
//
// Возвращает { quantity, avgEntryPrice, price } — сырые числа без округления
// (округление по stepSize/tickSize делается на этапе применения), либо null,
// если позиция уже полностью закрыта (остаток base <= 0).
function rebalanceClose(entries, closes, strategy, feesPct) {
  const closeArr = Array.isArray(closes) ? closes : closes ? [closes] : [];
  const sum = (arr, key) => (arr || []).reduce((s, e) => s + (Number(e[key]) || 0), 0);

  const remainingBase = sum(entries, 'executedQty') - sum(closeArr, 'executedQty');
  const remainingQuote = sum(entries, 'cummulativeQuoteQty') - sum(closeArr, 'cummulativeQuoteQty');

  if (remainingBase <= 0) return null; // позиция уже закрыта целиком

  const avgEntryPrice = remainingQuote / remainingBase;
  const factor = strategy === 'short' ? 1 - feesPct / 100 : 1 + feesPct / 100;

  return {
    quantity: remainingBase,
    avgEntryPrice,
    price: avgEntryPrice * factor,
  };
}

module.exports = { rebalanceClose };
