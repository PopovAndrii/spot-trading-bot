# Enabling Hybrid

**Hybrid grid** is an optional layer on top of the classic [DCA / Grid](/dca-grid/overview).
Turn it on with the **Hybrid grid** switch below the table. Off = pure DCA, exactly as
described in Part 1. On = DCA **plus** a micro-scalp that harvests the chop while the
position waits for its close.

> 📷 **Screenshot:** the Hybrid grid switch and the hybrid parameter row (Grid from order, Micro profit %, Grid exit %, Auto exit).

## What it adds

The DCA grid is **untouched**. The averaged whole-position close keeps descending with
the Martingale factor and always covers the entire position — nothing about your safety
net changes.

On top of that, while the price sits in the **lower part of the gap** below that close
(the boundary is set by [Grid exit %](/hybrid/parameters#grid-exit)), the **deepest
filled order** scalps **its own volume**:

1. It **sells** its slice at a small [Micro profit %](/hybrid/parameters#micro-profit).
2. It **re-buys** the dip when price falls back.
3. It **banks** every such bounce (counted ×N on the rung).

So instead of just sitting underwater waiting for the bounce, the position earns from
the up-and-down movement in the meantime. Every banked bounce also pulls the effective
exit closer.

## The pause-scalp, in one line

- **Pure DCA:** lay the ladder → average down → wait → close the whole position.
- **Hybrid:** same ladder and same close, but the waiting is **worked** — the deepest
  rung scalps the range under the close and banks the bounces.

## When the scalp runs

The scalp is not always active — it only makes sense when the position is *stuck*
waiting, in range, below the close. The exact conditions (which rung, how far below the
close, whether the micro even fits) are governed by the
[hybrid parameters](/hybrid/parameters), shown live in the
[scalp summary bar](/hybrid/summary-bar) and forecast on each rung by the
[✓ / ✗ marks](/hybrid/grid-marks).

::: tip Live switch
Hybrid can be toggled while the bot runs. Switching it on aims the scalp at the order
the price is currently stuck on. It does **not** rebuild the ladder — the DCA grid and
its averaged close stay exactly where they were.
:::

## See it run

For all of the above on live data — an empty grid filling, the scalp banking bounces,
Auto exit raising the split, and the whole position closing — walk through
[a full recorded session](/hybrid/walkthrough).
