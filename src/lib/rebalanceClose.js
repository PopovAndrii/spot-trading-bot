const Decimal = require('decimal.js');

// Recompute the averaged CLOSING order after a partial fill.
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
// bankedQuote — quote profit the cycle has ALREADY realized outside the live
//            fills (the hybrid scalp bank, obj.gridRealized). rearmGridLeg wipes
//            the oscillation's fills off the slots, so this money is invisible to
//            the sums above — yet it is cost the position no longer has to
//            recover. Folded into the close price only: long exits lower, short
//            exits higher (mirrored), each banked oscillation pulls the exit
//            toward the market. The fee factor keeps the priced exit above the
//            cycle's zero P&L by construction. avgEntryPrice stays the true
//            average of the remaining fills — recoveryStats depends on that.
//
// Returns { quantity, avgEntryPrice, price } — raw numbers without rounding
// (rounding by stepSize/tickSize is done at apply time), or null if the position
// is already fully closed (base leftover <= 0). Sums and the averaging division
// run in Decimal so the money math doesn't drift; the boundary values are handed
// back as plain numbers for the callers.
function rebalanceClose(entries, closes, strategy, feesPct, bankedQuote = 0) {
  const closeArr = Array.isArray(closes) ? closes : closes ? [closes] : [];
  // A slot's fills = what its current order executed PLUS what the orders it has
  // already replaced executed (filledQty/filledQuote — see slotQty in job.js). A
  // close that partially filled and was then pulled and re-placed still closed
  // that base: read it back, or the next close is sized for a position that is
  // no longer held. Absent accumulators = 0, so old configs are unchanged.
  const sum = (arr, key, banked) =>
    (arr || []).reduce(
      (s, e) => s.plus(Number(e[key]) || 0).plus(Number(e[banked]) || 0),
      new Decimal(0)
    );

  const base = (arr) => sum(arr, 'executedQty', 'filledQty');
  const quote = (arr) => sum(arr, 'cummulativeQuoteQty', 'filledQuote');

  const remainingBase = base(entries).minus(base(closeArr));
  const remainingQuote = quote(entries).minus(quote(closeArr));

  if (remainingBase.lte(0)) return null; // position already fully closed

  const avgEntryPrice = remainingQuote.div(remainingBase);

  // A bank that covers the whole remaining cost cannot be priced into a limit
  // order (the price would hit zero or go negative) — skip the discount and let
  // the surplus land in cycleProfit untouched.
  const banked = new Decimal(Number(bankedQuote) || 0);
  let effQuote = strategy === 'short' ? remainingQuote.plus(banked) : remainingQuote.minus(banked);
  if (effQuote.lte(0)) effQuote = remainingQuote;

  const feeFactor = new Decimal(feesPct).div(100);
  const factor =
    strategy === 'short' ? new Decimal(1).minus(feeFactor) : new Decimal(1).plus(feeFactor);

  return {
    quantity: remainingBase.toNumber(),
    avgEntryPrice: avgEntryPrice.toNumber(),
    price: effQuote.div(remainingBase).times(factor).toNumber(),
  };
}

module.exports = { rebalanceClose };
