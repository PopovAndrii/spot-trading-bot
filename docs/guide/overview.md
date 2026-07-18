# Overview

The Binance Trading Bot is a **self-hosted, non-custodial** spot trading bot with a
web dashboard. You run it on your own machine, against **your own** Binance API
keys. The image ships with no keys, sends your credentials nowhere, and defaults
to Binance testnet.

It runs one strategy family, but runs it thoroughly: a **DCA / Grid** ladder, with
an optional **Hybrid** micro-scalp layered on top. Understanding that strategy is
most of understanding the bot, so those sections are the heart of these docs — this
page is the map.

## What it does, in one loop

A single **cycle** on one trading pair (e.g. `BNBUSDT`) works like this:

1. **Enter and average down.** The bot lays a ladder of buy orders below the
   current price. As price falls, deeper rungs fill, each one larger than the last,
   pulling your average entry down. This is the classic [DCA / Grid](/dca-grid/overview).
2. **Close the whole position at once.** Against that averaged entry it rests a
   single take-profit sized to the entire position held so far. It is recomputed
   from your **real fills**, so it tracks reality rather than the original plan.
3. **(Hybrid) Scalp the wait.** With [Hybrid](/hybrid/overview) on, while the
   position sits below that close, a small partial close — the micro-scalp —
   harvests the up-and-down chop. Each fire is **banked**, and banked profit pulls
   the whole-position exit closer.
4. **Bank, re-arm, repeat.** When the grid finally closes in profit, the cycle
   ends and the next one begins.

## Who it is for

This is an **operator's tool**, not a one-click product. It assumes you understand
limit orders, averaging down, and the risk of holding a falling position. In
[Expert Mode](/expert/expert-mode) it even lets you cancel and re-place individual
live orders by hand.

::: warning Trade on testnet first
In `real` mode the bot places live orders with real funds. Start on
[testnet](/guide/testnet-vs-real), learn how a cycle behaves, and only then
consider real keys. See the [Disclaimer](/help/disclaimer).
:::

## How to read these docs

- **[Getting Started](/guide/getting-started)** — get it running in a few minutes.
- **[DCA / Grid](/dca-grid/overview)** — the classic strategy and every control on
  the dashboard, field by field.
- **[Expert Mode](/expert/expert-mode)** — manual, per-order intervention.
- **[Hybrid](/hybrid/overview)** — the micro-scalp: parameters, the summary bar,
  the grid marks, and the badge legend.
- **[Operations](/operations/running)** — persistence, backups, configuration, updates.
