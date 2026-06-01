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
// partial  — частично исполненный закрывающий ордер (его отменяем) или null:
//            { executedQty, cummulativeQuoteQty }
// strategy — 'long' | 'short'
// feesPct  — profit% + commission% (например 0.45)
//
// Возвращает { quantity, avgEntryPrice, price } — сырые числа без округления
// (округление по stepSize/tickSize делается на этапе применения), либо null,
// если позиция уже полностью закрыта (остаток base <= 0).
function rebalanceClose(entries, partial, strategy, feesPct) {
  const sum = (key) => (entries || []).reduce((s, e) => s + (Number(e[key]) || 0), 0);

  const entryBase = sum('executedQty');
  const entryQuote = sum('cummulativeQuoteQty');

  const soldBase = Number(partial?.executedQty) || 0;
  const soldQuote = Number(partial?.cummulativeQuoteQty) || 0;

  const remainingBase = entryBase - soldBase;
  const remainingQuote = entryQuote - soldQuote;

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
