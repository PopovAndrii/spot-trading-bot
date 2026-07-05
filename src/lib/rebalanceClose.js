// Stage 2: recompute the averaged CLOSING order after a partial fill.
//
// Context (long): the position is built with BUY orders (spend quote, receive
// base) and closed with one SELL at the averaged price plus profit. If the active
// SELL partially filled (some base already sold) and then the next BUY triggered,
// the previous SELL plan becomes wrong: less base is held and some profit is
// already realized. This function computes the new close quantity and price from
// the ACTUAL fills (executedQty / cummulativeQuoteQty from the getOrder response,
// which are persisted to config — see jsonTimerSender.js).
//
// For short it's mirrored: the position is built with SELL, closed with a BUY lower.
//
// entries  — actually filled position-entry orders:
//            [{ executedQty, cummulativeQuoteQty }]  (BUY for long / SELL for short)
// closes   — partially filled closing orders (that were canceled) during the cycle:
//            array [{ executedQty, cummulativeQuoteQty }] | a single object | null.
//            There may be several per cycle (SELL[0], SELL[1]…); we subtract the sum.
// strategy — 'long' | 'short'
// feesPct  — profit% + commission% (e.g. 0.45)
//
// Returns { quantity, avgEntryPrice, price } — raw numbers without rounding
// (rounding by stepSize/tickSize is done at apply time), or null if the position
// is already fully closed (base leftover <= 0).
function rebalanceClose(entries, closes, strategy, feesPct) {
  const closeArr = Array.isArray(closes) ? closes : closes ? [closes] : [];
  const sum = (arr, key) => (arr || []).reduce((s, e) => s + (Number(e[key]) || 0), 0);

  const remainingBase = sum(entries, 'executedQty') - sum(closeArr, 'executedQty');
  const remainingQuote = sum(entries, 'cummulativeQuoteQty') - sum(closeArr, 'cummulativeQuoteQty');

  if (remainingBase <= 0) return null; // position already fully closed

  const avgEntryPrice = remainingQuote / remainingBase;
  const factor = strategy === 'short' ? 1 - feesPct / 100 : 1 + feesPct / 100;

  return {
    quantity: remainingBase,
    avgEntryPrice,
    price: avgEntryPrice * factor,
  };
}

module.exports = { rebalanceClose };
