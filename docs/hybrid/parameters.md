# Hybrid parameters

Four controls govern the micro-scalp. They sit in their own row and — unlike the build
parameters — are **all changeable while the bot runs**; a change lands on the live cycle
on the next tick. None of them rebuild the DCA ladder.

> 📷 **Screenshot:** the hybrid parameter row.

## Grid from order

From which **order number** down the ladder the deepest filled order is allowed to run
the scalp. Orders **above** it never scalp — they stay pure DCA.

- Switching Hybrid on aims this at the order the price is currently stuck on.
- You can retype it live — e.g. **raise** it to make the scalp **ignore** the current
  order and wait for a deeper one to fill first.

## Micro profit % {#micro-profit}

The **net** take-profit of each micro-order, on top of commission.

- **Smaller** → banks bounces more **often**, and fits into a **narrower** gap.
- Default **0.1**.

This is the margin the deepest rung's slice is sold at, measured from that rung's own
entry price (entry × (1 + Micro profit % + commission)).

## Grid exit % {#grid-exit}

The **split** of the pause gap between the deepest filled order and the whole-position
close (measured against the live stream price):

- **Below** the split → the micro-scalp trades the deepest order's own volume.
- **Above** the split → the normal full close rests instead.
- `0` = at the deepest fill (no scalp), `100` = at the close, **default `50`** = midway.

The micro **never crosses this line**. So if *Micro profit % + commission* needs more
room than the split leaves, **no scalp is placed at all** — the cycle quietly runs as
plain DCA. The fix is to **raise Grid exit %** (more room) or **lower Micro profit %**
(smaller micro). The [✓ / ✗ marks](/hybrid/grid-marks) show, per rung, whether it fits.

## Auto exit

A switch that turns the Grid exit % knob **for you**:

- **On** — when the micro doesn't fit under the split, the bot **raises Grid exit % to
  the value that fits**, automatically, on the running cycle.
- **Off** — the bot only **warns** you (in the log and in Telegram) and **names** the
  value to set; nothing changes until you set it.

See [Auto exit behaviour](/hybrid/grid-marks) in context of the fit marks.
