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
