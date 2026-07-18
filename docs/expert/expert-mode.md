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
