# The scalp summary bar

When Hybrid is on, a one-line bar appears **under the Start/Stop button** (hidden on a
classic cycle). It is the scalp in a glance — a **state message** plus the numbers it is
working with, straight from the engine.

> 📷 **Screenshot:** the hybrid bar with its cells (price · split · micro · close · banked).

## The cells

| Cell | Meaning |
|---|---|
| **price** | The live **stream price** the scalp is measured against — the same ticker shown by Start/Stop. |
| **split** | The [Grid exit %](/hybrid/parameters#grid-exit) line — the boundary the micro may not cross. |
| **micro** | The micro order as **price × quantity** — the slice the deepest rung is scalping. |
| **close** | The **real** whole-position close as **price × quantity**. Recomputed from your actual fills, so it drifts away from the plan column as the cycle runs. |
| **banked** | Everything the grid has **banked** so far from micro fires. Highlighted once it is above zero. |

::: tip close vs. the table's "Sell currency"
The **close** here is the *live* averaged close computed from real fills — it is the
truth for the running cycle. The table's Sell currency column is the *planned* close.
They start equal and diverge a little as fills land off-plan.
:::

## The state message

The bar leads with a plain-language status of what the scalp is doing right now:

| State | Message means |
|---|---|
| **idle** | Nothing held yet — waiting for the first fill. |
| **DCA** | An order is held, but shallower than *Grid from order* — still pure averaging, no scalp yet. |
| **scalping #N** | The micro on order #N is **live on the book**. |
| **blocked** | No room for the micro on this rung — it names the Grid exit % to raise (or, if none fits, to lower Micro profit %). With [Auto exit](/hybrid/parameters#auto-exit) on, it raises it for you. |
| **waiting** | In the zone but price is above the micro — arming now would sell into the book, so it waits for price to come back under the micro. Or: price is out of the zone (past the split) and the full close rests instead. |
| **arming** | Placing the micro on the deepest order. |
| **closed** | The position is closed out — nothing left to scalp. |

Read the bar top-down: **what it's doing** (state), then the four numbers it's doing it
with. Every rung's own forecast is shown by the [✓ / ✗ marks](/hybrid/grid-marks) in the
table, and the colored [badges](/hybrid/badges) tie each number to its row.
