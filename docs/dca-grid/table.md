# Reading the grid table

*Calculate* turns your [settings](/dca-grid/interface) into the grid table — one row
per rung of the ladder, top (shallowest) to bottom (deepest). Every number here is a
**plan**: what the bot will do if price falls that far. Nothing is on the exchange
until you *Start*.

> 📷 **Screenshot:** the grid table for a pair (e.g. BNBUSDT).

## The columns

Row **#1** is the first order, nearest the current price; each row below is a deeper
rung. For a **Long** grid (mirrored for Short):

| Column | What it is |
|---|---|
| **#** | Rung number. #1 is the shallowest (fills first); deeper rungs fill only if price keeps falling. |
| **%** | How far **below the current price** this rung sits — the depth of drop it covers. Grows down the ladder. |
| **Buy currency** | The **price** this rung's BUY order rests at. |
| **BUY** | The **base amount** bought at this rung (e.g. BNB). Grows down the ladder by the Martingale factor. |
| **SELL** | The **cumulative** base held once filled *through this rung* — i.e. your whole position size at this depth. |
| **Sell currency** | The **whole-position close price** at this depth: your average entry so far, marked up by Profit % + commission. This is the single averaged take-profit. |
| **Spent** *(quote)* | The **money** spent on this one rung, in the quote currency (e.g. USDT). |
| **Balance** | The deposit **left over** after buying through this rung. |

## How to read a row

Each row answers: *"If price falls to here and every rung above has filled, what is my
position and where does it close?"*

- **SELL** is your total position size at that depth (cumulative base).
- **Sell currency** is where that whole position sells in profit — the averaged close.
  Because it is computed from the running average, it **descends** as deeper (larger)
  rungs pull the average down. That is the point of averaging: the close chases the
  price down, so a bounce doesn't have to reach your first entry to profit.
- **Balance** shows the budget draining. When a rung would cost more than the
  **Balance** left, the ladder stops — that last rung is as deep as your deposit reaches.

## How it fills, live

When the cycle runs, price walking **down** fills rungs top-to-bottom. The **deepest
filled** rung is your real state: its **SELL** is what you hold, and the whole
position rests to close at that rung's **Sell currency**. A bounce up to that price
closes everything in profit and ends the cycle.

::: tip
The plan columns never lie about the real exit — the displayed **Sell currency** is
the averaged whole-position close. When [Hybrid](/hybrid/overview) is on, an extra
micro-scalp is layered on top of this same table; that is covered in its own section.
:::

Next: [Managing a pair](/dca-grid/pair-controls) — cancelling and deleting orders.
