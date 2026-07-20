# The DCA / Grid strategy

This is the bot's base strategy. With **Hybrid off** it is exactly this and nothing
more — a DCA ladder that averages a position down and closes it whole, in profit.
The [Hybrid](/hybrid/overview) micro-scalp is an optional layer added on top later;
ignore it until you understand this page.

## The idea

**DCA** — *dollar-cost averaging* — means you don't try to buy the bottom. You place
a **ladder of orders** below the current price (for **Long**; mirrored above it for
**Short**). As the price falls, deeper rungs fill one by one. Each rung is **larger**
than the one above it, so every fill drags your **average entry price** down faster
than the market fell. The deeper the dip, the cheaper your average.

Against that averaged position the bot rests **one closing order** — the
whole-position take-profit. It is priced a small margin (**Profit %** + commission)
above your **average** entry, so when price bounces back to it the *entire* position
sells at once, in profit — even though most individual rungs are still underwater.

That is the whole classic cycle:

1. Lay the ladder below price.
2. Let dips fill rungs and pull the average down.
3. Rest one averaged close above that average.
4. Price bounces → the close fills → the cycle ends in profit → start again.

## Why a ladder, not one order

A single buy is a bet on timing. A ladder is a bet on **range**: as long as price
eventually bounces before the ladder runs out of rungs, the cycle closes green. The
shape of that ladder — how far apart the rungs are, how fast they grow, how far the
last rung reaches — is set by a handful of controls:

- **Progression strategy** + **Martingail** — how fast each rung grows, and so how
  quickly the deposit is spent and how far the ladder reaches.
- **Progressive step** — how far apart the rungs sit (the overlap %).
- **Indent price** — how far the first rung sits from the current price.
- **Order Size** and **Available balance** — the size of the first rung and the
  budget the whole ladder is built from.

Each of these is walked through in the [Interface](/dca-grid/interface) page, and
you can see their combined result — every rung's price, size, and running
average — in the [grid table](/dca-grid/table).

## The trade-off to understand first

Averaging down is powerful *within a range* and dangerous *in a trend*. A ladder
with wide spacing and high overlap survives a deep drop but fills rarely; a tight,
aggressive ladder fills often but burns the deposit fast and reaches shallow. There
is no universally correct setting — you tune the ladder to the pair, the budget, and
how much drop you want it to absorb. The controls exist precisely so you can make
that trade-off deliberately.

::: warning
A DCA ladder holds a **losing position** and adds to it. If price keeps falling past
the last rung, the position stays open and underwater until price recovers. Size the
ladder for the drop you can actually sit through. Trade it on
[testnet](/guide/testnet-vs-real) first.
:::

Next: the [Interface](/dca-grid/interface), control by control.
