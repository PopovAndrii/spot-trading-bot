# Running & Persistence

## The cycle lifecycle

1. **Calculate** builds the grid from your settings (a preview — nothing is sent).
2. **Save** persists the grid and settings for the pair.
3. **Start** begins the live cycle: the bot places the ladder, keeps
   [Active orders](/dca-grid/interface#runtime-parameters) resting, and polls state at
   the [Request frequency](/dca-grid/interface).
4. As price falls, rungs fill and the averaged close is recomputed from the **real
   fills**. With [Hybrid](/hybrid/overview) on, the deepest rung scalps in between.
5. When the whole-position close fills, the cycle **ends in profit**.
6. If **Restart** is on, the next cycle begins automatically; otherwise the bot stops.

## Persistence — one file per pair

Each pair's state lives in its own JSON file under **`data/`** (e.g.
`data/BNBUSDT-binance.json`): the open cycle, its orders, fills, banked profit, and
settings. This is the bot's **source of truth** — it survives restarts and image
updates, so a running cycle is picked up exactly where it left off.

::: warning Don't hand-edit `data/*.json`
These files hold live money state — order IDs, filled quantities, banked profit. Editing
them by hand can desync the bot from the exchange. Use the dashboard controls
([Managing a pair](/dca-grid/pair-controls)) instead.
:::

Because this state is money-critical, **back it up** — see [Backup & Updates](/operations/backup).

## Stream liveness

The bot watches the exchange **price stream** to drive the cycle. Liveness is measured by
the stream's **pings**, not by trades — a quiet pair with no trades is still *live* as
long as the connection is pinging. So silence on an inactive pair is normal, not a stall;
the bot only treats the stream as dead when the pings stop.

## Restart behaviour

**Restart** (a live switch) decides what happens at the end of a series:

- **On** → a fresh cycle is armed and started automatically once the current one closes.
- **Off** → the bot stops cleanly after the current cycle completes.

It can be toggled while the bot runs; the change applies to the *next* series boundary.

## Greed Lock — refusing a shrunken restart

The ladder is sized from the **live price** (order size × price) against a **fixed
deposit**. If price has moved a lot by the time a series ends — up on a Long, down on a
Short — the same deposit no longer stretches to the same number of rungs, and an
automatic restart can come back **one or more rungs shorter** than the series that just
finished. That unspent slice of the deposit then sits idle for the whole next cycle.

**Greed Lock** (a live switch, next to Restart) guards against this:

- **On** → if the freshly recalculated ladder would have **fewer** rungs than the series
  that just ended, the restart is **refused** — the bot stops instead of quietly trading a
  smaller grid. A Telegram message reports the old/new rung count and the idle balance, so
  the deposit or order size can be raised deliberately.
- **Off** → the restart proceeds with however many rungs the balance covers, same as
  before Greed Lock existed.

It only guards **automatic restarts** at the end of a series — it has no effect on the
first **Start** of a new cycle, and it does nothing when Restart is off.
