---
layout: home

hero:
  name: Spot Trading Bot for Binance
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

Current version: **`2.0.0`** — first test release.

Every new version is added to this list with a short note on what changed. Newest first.

| Version | Notes |
|---|---|
| **`2.0.0`** | First test release. |

## Source

Open source under GPLv3.

- **GitLab (canonical):** [gitlab.com/AndreyPopov/exchange-crypto](https://gitlab.com/AndreyPopov/exchange-crypto)
