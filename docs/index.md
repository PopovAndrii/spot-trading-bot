---
layout: home

hero:
  name: Spot Trading Bot for<br>Binance
  text: DCA / Grid hybrid
  tagline: A self-hosted, non-custodial spot bot that averages a position down, closes the whole grid at a profit, and scalps the oscillations in between.
  image:
    light: /img/hero-light.png
    dark: /img/hero-dark.png
    alt: DCA / Grid hybrid dashboard
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: How the strategy works
      link: /dca-grid/overview

features:
  - title: DCA ladder
    details: A ladder of safety orders averages your entry down as price falls — each rung deeper and larger than the last.
  - title: Grid close
    details: The whole position is closed as one averaged take-profit that follows your real fills, not a static plan.
  - title: Micro-scalp
    details: While the position waits for its exit, a small partial close banks the oscillations and pulls the exit price closer.
  - title: Testnet first
    details: Ships with no keys and defaults to Binance testnet. Your API keys stay in your own .env, on your own machine.
---

## Releases

Current version: **`2.0.1`**.

Every new version is added to this list with a short note on what changed. Newest first.

| Version | Date | Notes |
|---|---|---|
| **`2.0.1`** | 2026-07-20 | Live re-place of the resting micro when Micro profit % changes (atomic `cancelReplace`). VitePress docs site, rebrand + new logo, Docker Hub image rename. Fixes: resting micro shows its real book price; re-place popup price rounded to tick. |
| **`2.0.0`** | 2026-07-17 | First test release. DCA/Grid hybrid strategy — safety-order ladder, averaged grid close that follows real fills, and a micro-scalp that banks oscillations and pulls the exit closer. Live hybrid controls on a running cycle, Telegram trade notices, testnet-first, and Docker Hub distribution. |

## Source

Open source under GPLv3.

::: tip Development happens on GitLab
The **GitLab repository is canonical**: active development, issues, merge requests,
and releases happen there.

The **GitHub repository is a read-only mirror** for visibility and easier discovery.
Please open issues and contributions on GitLab.
:::

- **GitLab (canonical):** [gitlab.com/AndreyPopov/spot-trading-bot](https://gitlab.com/AndreyPopov/spot-trading-bot)
- **GitHub mirror:** [github.com/PopovAndrii/spot-trading-bot](https://github.com/PopovAndrii/spot-trading-bot)
