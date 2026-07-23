# Overview

This is a **self-hosted, non-custodial** spot trading bot for Binance, with a
web dashboard. You run it on your own machine, against **your own** Binance API
keys. The image ships with no keys, sends your credentials nowhere, and defaults
to Binance testnet.

It runs one strategy family, but runs it thoroughly: a **DCA / Grid** ladder, with
an optional **Hybrid** micro-scalp layered on top. Understanding that strategy is
most of understanding the bot, so those sections are the heart of these docs — this
page is the map.

::: tip Current version — `2.0.1`
See the [release list](/#releases) for version history and notes.
:::

## Why this bot

| # | Advantage |
|---|---|
| 1 | **Non-custodial & self-hosted.** Runs on your own machine with your own keys. The bot holds no funds and has no withdrawal permission — your keys never leave your `.env`. |
| 2 | **Averages the entry down.** A DCA ladder of ever-deeper, ever-larger safety orders pulls your average entry down as price falls, instead of a single all-in buy. |
| 3 | **One take-profit from real fills.** The whole position is closed by a single exit, sized to everything held so far and recomputed from your **actual** fills — it tracks reality, not the original plan. |
| 4 | **Scalps the wait (Hybrid).** While the grid sits below its exit, small partial closes harvest the up-and-down chop and **bank** profit that pulls the whole-position exit closer. |
| 5 | **Reaches deeper than Binance's ~18% order cap.** Binance rejects a limit buy placed too far below market (its percent-price filter, ~18%). Because the grid keeps only a limited number of live orders — the **Active orders** setting — near the price and places deeper rungs *progressively* as price falls, the ladder extends far below that single-order cap over a falling move. |
| 6 | **Respects exchange filters automatically.** Every order is rounded to the pair's tick size, step size, and minimum notional, so orders aren't rejected by the exchange. |
| 7 | **Testnet-first, with a safety fallback.** Ships with no keys and defaults to Binance testnet; `real` mode without real keys silently falls back to testnet, so you can't trade real funds by accident. |
| 8 | **Manual per-order control (Expert Mode).** Cancel and re-place individual live orders by hand when you want to intervene. |
| 9 | **Free, open source, and yours to run 24/7.** GPLv3, self-hosted — no subscription, no third party between you and the exchange. |

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

::: info AI-assisted deployment and coding
Using AI is encouraged, especially for setup, deployment, and repetitive operator
work. It usually does not break the project by itself — it helps you launch faster
and reduces routine friction.

But always review AI-generated changes with your own eyes. New features and non-trivial
edits should be tested on **Binance testnet first**. AI often gets architecture or
integration details wrong — not only because the model can make mistakes, but also
because humans frequently describe requirements incompletely.

Treat AI as an accelerator, not as a final authority: inspect the code, verify the
behavior, and test the risky paths manually.
:::

## How to read these docs

- **[Getting Started](/guide/getting-started)** — get it running in a few minutes.
- **[DCA / Grid](/dca-grid/overview)** — the classic strategy and every control on
  the dashboard, field by field.
- **[Expert Mode](/expert/expert-mode)** — manual, per-order intervention.
- **[Hybrid](/hybrid/overview)** — the micro-scalp: parameters, the summary bar,
  the grid marks, and the badge legend.
- **[Operations](/operations/running)** — persistence, backups, configuration, updates.
