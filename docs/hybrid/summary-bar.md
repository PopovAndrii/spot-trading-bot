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

| State | Message | Means |
|---|---|---|
| **idle** | `nothing held — waiting for the first fill` | No rung has filled yet — the cycle is armed but empty. |
| **idle** | `order #N held — DCA until #M` | An order is held, but shallower than *Grid from order* — still pure averaging, no scalp yet. |
| **idle** | `order #N is already closed out — nothing left to scalp` | Rare: rung #N's own volume is already fully sold (a close already took it), but the rest of the position is still open — nothing left on *this* rung to scalp, distinct from the whole cycle ending. |
| **idle** | `position closed — nothing left to scalp` | The whole-position close fired and the cycle ended; the button is back to **Start**. |
| **live** | `scalping order #N` | The micro on order #N is **live on the book** — this and [the tail](/hybrid/overview#the-tail) resting beside it. |
| **live** | `arming the micro on #N` | The gate just opened this tick; the micro is being placed. |
| **blocked** 🔴 | `no room for the micro on #N — raise Grid exit % to X` | The micro doesn't fit, but a higher Grid exit % would fix it — [Auto exit](/hybrid/parameters#auto-exit) raises it for you when it's on. |
| **blocked** 🔴 | `no room for the micro on #N — no Grid exit % fits, lower Micro profit %` | No Grid exit % is high enough for this gap — the only fix left is a smaller Micro profit %. |
| **wait** | `price is above the micro — waiting for it to come back under X` | In the zone, but arming now would sell straight into the book — it waits for price to dip back under the micro. |
| **wait** | `price out of the zone — full close rests` | Price is past the [split](/hybrid/parameters#grid-exit) — the scalp yields and the plain whole-position close rests instead. |

Read the bar top-down: **what it's doing** (state), then the four numbers it's doing it
with. Every rung's own forecast is shown by the [✓ / ✗ marks](/hybrid/grid-marks) in the
table, and the colored [badges](/hybrid/badges) tie each number to its row.
