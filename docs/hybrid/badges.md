# Badges & prices

The table shows a **plan**. Once the cycle runs, small colored **badges** are layered on
the rows to show the **live truth** — where an order really sits, what the scalp is
doing, and what actually filled. This page is the legend, and it answers the obvious
question: *the number on a badge — what price is that?*

> 📷 **Screenshot:** a few rows with badges of each color.

## The color legend

| Color | Badge | Appears when | The price it shows |
|---|---|---|---|
| 🟡 **Yellow** | `560.09` | A live order rests at a price **different from the plan** column (re-placed, or the recomputed close). | The order's **actual resting price** on the book right now. |
| 🟢 **Green** | `micro 557.90 × 0.168` | The micro-scalp is **live** on the book (or arming). | The **micro sell price × the slice size** being scalped. |
| 🔵 **Blue** | `micro 557.90 …` | The micro is **waiting** — price is above it, or out of the zone. | Where the micro **would** rest once price comes back under it. |
| 🔴 **Red** | `micro 557.90 ✕` | The micro is **blocked** — it would cross the split. | Where the micro would need to sit; it can't be placed there. |
| ⚪ **Grey/white** | `558.45` / `0.020` | An order has **actually executed** (fully or partly). | The **real fill** — average price (`quote ÷ filled`) or filled quantity. Tooltip: *real price* / *real qty*. |
| **✓ / ✗** | green ✓ / red ✗ | Forecast on a zone rung (see [Grid marks](/hybrid/grid-marks)). | — (fit / no-fit, not a price.) |

A grey **×N** may also appear on a close rung — that is the **micro-fire counter**: how
many bounces this rung has banked.

::: tip Why yellow exists
The column shows the *planned* price. A live order can rest somewhere else — you
[re-placed it](/expert/expert-mode), or the [close was recomputed](/hybrid/summary-bar)
from real fills. The yellow badge surfaces the **real** resting price so the table never
lies. Hover it: *current price (re-placed)*.
:::

## What a micro order is

A **micro order** is a small **partial close** of the **deepest filled rung's own
volume** — a slice, not the whole position.

- On a **Long** cycle it is a **SELL**; on a **Short**, a **BUY**.
- It is priced at that rung's **entry**, marked up by
  [Micro profit %](/hybrid/parameters#micro-profit) + commission — a quick take-profit
  just above where the rung bought.
- When it fills, the bot **re-buys the dip** and **re-arms**, banking that bounce (×N).

It is completely separate from the **whole-position close**: the close sells
*everything* at the averaged price and ends the cycle; a micro sells *one rung's slice*
for a small profit and leaves the position open to keep scalping. The micro's job is to
earn from the chop while the position waits for its real close.

## How a buy or sell actually happens

Every price you see on a badge is a **limit order** — the bot does not buy or sell at
market. A limit order **rests on the book** at a set price and only trades when the
market **reaches** it:

- **BUY** rungs fill as price **falls** to them (averaging the position down).
- The **whole-position close** and the **micro** sells fill as price **rises** to them.

So a badge's number is always either **where an order is resting** (yellow, green, blue,
red) or **where one actually filled** (grey). Nothing on the table is a market action —
a fill happens only when price comes to the order.
