// Read-only fund-recovery stats for a lived session.
//
// When a cycle ends, part of the position may stay un-bought-back (the grid
// didn't manage to close the leftover — see testnet wicks / take-profit lag).
// From the ACTUAL fills in the archive this function computes two metrics and one
// phrase: how much is left on hand and at what price to sell it (long) / buy it
// back (short) so the WHOLE series ends without a loss.
//
// Places nothing on the exchange and doesn't change the data/*.json schema —
// read-only.
//
// Reuses rebalanceClose: remainingBase = Σ entry.executedQty − Σ close.executedQty
// (the stranded quantity), remainingQuote = Σ entry.quote − Σ close.quote (the
// stranded money). Commission is passed WITHOUT profit — we need the series
// break-even, not the close's target profit.
const Decimal = require('decimal.js');
const { rebalanceClose } = require('./rebalanceClose');

function recoveryStats(session) {
  if (!session || typeof session !== 'object') return null;

  const param = session.param || {};
  const strategy = param['field-strategy'] === 'short' ? 'short' : 'long';
  const commission = Number(param['field-commission']) || 0;
  const pricePrec = Number(param['field-tickSize']) || 2;
  const qtyPrec = Number(param['field-stepSize']) || 3;

  // long: build with BUY, close with SELL. short is mirrored.
  const entries = strategy === 'short' ? session.SELL : session.BUY;
  const closes = strategy === 'short' ? session.BUY : session.SELL;
  if (!Array.isArray(entries)) return null;

  const r = rebalanceClose(entries, closes, strategy, commission);
  if (!r) return null; // position fully closed — nothing to return

  const strandedQty = Number(new Decimal(r.quantity).toFixed(qtyPrec));
  if (strandedQty <= 0) return null; // leftover within dust

  const base = (session.pair || '').replace(/(USDT|USDC|BUSD|FDUSD)$/i, '') || 'base';

  // avgEntryPrice <= 0 → the closing part already returned all invested money,
  // the series is in profit even with a leftover on hand.
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

  const breakevenPrice = Number(new Decimal(r.price).toFixed(pricePrec));
  const side = strategy === 'short' ? 'buy' : 'sell';
  const bound = strategy === 'short' ? 'no more than' : 'no less than';
  // one-shot: after recovery the cycle is done — no reverse trade is needed
  const tail =
    strategy === 'short'
      ? "This is a one-time buy — you don't need to sell it again afterwards."
      : "This is a one-time sell — you don't need to buy it back afterwards.";

  return {
    strategy,
    base,
    strandedQty,
    breakevenPrice,
    alreadyProfit: false,
    text: `If you want to stop the session, to break even you need to ${side} ${strandedQty} ${base} at ${bound} ${breakevenPrice}. ${tail}`,
  };
}

module.exports = { recoveryStats };
