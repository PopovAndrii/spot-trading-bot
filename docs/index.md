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

Current version: **`2.0.6`**.

Every new version is added to this list with a short note on what changed. Newest first.

| Version | Date | Notes |
|---|---|---|
| **`2.0.6`** | 2026-08-19 | Static assets (JS/CSS) served without cache-control could linger stale in the browser across deploys, showing mismatched footer versions and a resurrected pre-fix Start-button race until a hard refresh. Static serving now forces revalidation via `Cache-Control: no-cache`. |
| **`2.0.5`** | 2026-08-10 | Start button, parameter lock, and the header pair-status label could get stuck out of sync with the running bot after a fresh page load — a DOM race could silently drop the running state, and the pair-list label was never resynced. |
| **`2.0.4`** | 2026-08-08 | Cycle no longer ends on a rung-sized close while the position isn't flat — the classic close recomputes the leftover from real fills instead of a stale plan left by a pulled hybrid scalp. Telegram: batched messages drop the closing separator; Start/Pause/Series deleted get a color-coded icon. |
| **`2.0.3`** | 2026-08-05 | Distinguish an exchange outage from an invalid key or a real bug, instead of showing both as the same raw error. Request timeout on key checks. Friendly "temporarily unavailable" message during an outage instead of a raw stack trace. |
| **`2.0.2`** | 2026-07-26 | Public docs link from the repo front page, developer release command examples, AI usage guidance in docs, auto-create pair state for live params, and quieter Docker setup output. |
| **`2.0.1`** | 2026-07-20 | Live re-place of the resting micro when Micro profit % changes (atomic `cancelReplace`). VitePress docs site, rebrand + new logo, Docker Hub image rename. Fixes: resting micro shows its real book price; re-place popup price rounded to tick. |
| **`2.0.0`** | 2026-07-17 | First test release. DCA/Grid hybrid strategy — safety-order ladder, averaged grid close that follows real fills, and a micro-scalp that banks oscillations and pulls the exit closer. Live hybrid controls on a running cycle, Telegram trade notices, testnet-first, and Docker Hub distribution. |

## Source

Open source under GPLv3.

::: tip Development happens on GitLab
The **GitLab repository is canonical**: active development, merge requests,
and releases happen there.

The **GitHub repository is a public mirror** for visibility, stars, and feedback.
For code changes and releases, GitLab remains the primary home.
:::

- **GitLab (canonical):** [gitlab.com/AndreyPopov/spot-trading-bot](https://gitlab.com/AndreyPopov/spot-trading-bot)
- **GitHub mirror + feedback:** [github.com/PopovAndrii/spot-trading-bot](https://github.com/PopovAndrii/spot-trading-bot)
- **Documentation site (GitLab Pages):** [exchange-crypto-059f74.gitlab.io](https://exchange-crypto-059f74.gitlab.io/)
- **Documentation site (GitHub Pages):** [popovandrii.github.io/spot-trading-bot](https://popovandrii.github.io/spot-trading-bot/)
- **Docker Hub:** [hub.docker.com/r/5879/spot-trading-bot](https://hub.docker.com/r/5879/spot-trading-bot)

::: tip Support the project
If this project helps you, consider starring it on [GitHub](https://github.com/PopovAndrii/spot-trading-bot) or [GitLab](https://gitlab.com/AndreyPopov/spot-trading-bot), and feel free to leave feedback on either platform.
:::

## 🛠️ Need Help with Deployment?

While this project is fully open-source and free to set up on your own using the provided Docker guidelines, I offer paid **DevOps & Server Setup Assistance** if you prefer a turn-key technical installation:

- **VPS / Ubuntu Server Setup:** Initial server hardening, firewall setup, and Docker/Docker Compose installation.
- **Environment Configuration:** Proper system setup and process monitoring (systemd / PM2).
- **Consultation:** 1-on-1 call via Zoom/Discord to walk you through the architecture and running process safely.

> ⚠️ **Disclaimer:** I provide purely technical infrastructure and DevOps support for open-source software setup. I do **not** provide financial advice, trading strategies, or key management services. You are fully responsible for your own exchange API keys and funds.

<p align="center">
  <a href="mailto:vps.support.bot@gmail.com">
    <img src="https://img.shields.io/badge/Email-Deployment_Support-blue?style=for-the-badge&logo=gmail" alt="Email Support" />
  </a>
</p>
