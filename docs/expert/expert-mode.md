# Expert Mode

**Expert Mode** is a switch that unlocks **per-order manual controls** inside the grid
table. Off (the default), the table is read-only and the bot manages every order. On,
you can reach into the live grid and cancel or re-place individual orders by hand.

The switch carries a **danger accent** when on — a reminder that you are now editing
orders the bot is actively managing.

> 📷 **Screenshot:** the Expert Mode switch (on, danger accent) and a table row with the ✕ / ＋ controls.

## What it unlocks

With Expert Mode on, each order row in the Buy/Sell currency cell can show one control,
depending on the order's **state**:

| Order state | Control | What it does |
|---|---|---|
| **NEW / PARTIALLY_FILLED** (resting) | **✕** cancel | Pulls this single order off the book. |
| **CANCELED by you** (manually pulled) | **＋** re-place | Re-opens the order at a **new price** (via a popup). |
| **FILLED / bot-cancelled / none** | — | Nothing to do; no control shown. |

The **＋** appears only on an order **you** pulled — never on one the bot cancelled on
its own. That distinction is deliberate: a bot-cancelled order is part of the strategy
and should not be hand-re-placed by accident.

## ✕ — cancel one order

Removes a **single resting limit order** from the exchange book. Nothing is bought or
sold — a limit order only trades when price reaches it, so cancelling it before then
simply takes it off the book. Use it to pull one specific rung without touching the
rest of the grid.

## ＋ — re-place at a new price

On an order you have cancelled, **＋** opens a small **price popup**. You type a new
price and the order is placed again there — a fresh limit order back on the book.

The price is entered in a popup, **not inline**, because the table re-renders every
tick and would reset a field mid-edit.

::: warning This is hand-editing a live strategy
The bot keeps managing every order you don't touch. Cancelling or moving a rung by
hand changes the shape of the position the bot is working — do it only if you
understand the consequence for the averaged close and the [scalp](/hybrid/overview).
For flattening a whole pair at once, use [Managing a pair](/dca-grid/pair-controls)
instead. Test your workflow on [testnet](/guide/testnet-vs-real) first.
:::

## Expert Mode and the hybrid scalp

Expert Mode and the [hybrid scalp](/hybrid/overview) can be on at the same time, but
they do not share territory equally:

- **Plain DCA rungs** — everything above the scalp's arm — are safe to edit. The bot
  passes over any order you cancel or re-place by hand and keeps managing the rest.
- **The carrying rung** (the deepest held entry, where the micro lives) belongs to the
  scalp. Inside the scalp zone any resting close that is not the micro — including one
  you placed by hand — is pulled to make room for the micro. Your edit will be
  overridden on the next tick.
- **The tail slot** (the rung right above the carrying one) sizes its order against the
  position. A manual order sitting on that slot blocks the tail, and a manual close
  resting elsewhere is not subtracted from it — the combined sell volume can exceed
  what the account holds, and the exchange will start rejecting orders.

The same applies to the **whole-position exit**: the hybrid re-prices it from the
actual fills (and lowers it as micro profit is banked), so an exit you moved by hand
will not survive the next scalp cycle.

**Rule of thumb:** to hand-edit the exit or anything near the scalp, switch the hybrid
**off** first — it is a live toggle — make your changes, then decide whether to turn it
back on. Editing plain DCA rungs does not require this.
