# Spot Trading Bot for Binance

![Node.js](https://img.shields.io/badge/Node.js-20+-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)
![Express](https://img.shields.io/badge/Express-5-000000?style=for-the-badge&logo=express&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?style=for-the-badge&logo=docker&logoColor=white)
![Binance Spot](https://img.shields.io/badge/Binance-Spot-F3BA2F?style=for-the-badge&logo=binance&logoColor=black)
![WebSocket](https://img.shields.io/badge/WebSocket-ws-010101?style=for-the-badge&logo=socketdotio&logoColor=white)
![SCSS](https://img.shields.io/badge/SCSS-Styling-CC6699?style=for-the-badge&logo=sass&logoColor=white)

[![GitHub stars](https://img.shields.io/github/stars/PopovAndrii/spot-trading-bot?style=for-the-badge)](https://github.com/PopovAndrii/spot-trading-bot/stargazers)
[![Docker Pulls](https://img.shields.io/docker/pulls/5879/spot-trading-bot?style=for-the-badge&logo=docker)](https://hub.docker.com/r/5879/spot-trading-bot)
[![GitHub release](https://img.shields.io/github/v/release/PopovAndrii/spot-trading-bot?style=for-the-badge)](https://github.com/PopovAndrii/spot-trading-bot/releases)
[![License](https://img.shields.io/github/license/PopovAndrii/spot-trading-bot?style=for-the-badge)](LICENSE)
[![Docs](https://img.shields.io/badge/Docs-Online-blue?style=for-the-badge)](https://popovandrii.github.io/spot-trading-bot/)
[![Docker Hub](https://img.shields.io/badge/Docker%20Hub-5879%2Fspot--trading--bot-2496ED?style=for-the-badge&logo=docker&logoColor=white)](https://hub.docker.com/r/5879/spot-trading-bot)

If this project helps you, please consider starring the repository on GitHub or GitLab, and feel free to leave feedback on either platform.

![Spot Trading Bot for Binance dashboard](docs/public/img/long_DCA_grid_hybrid/Screenshot_20260719_122737.png)

> **Canonical repository:** GitLab — development, merge requests, and releases happen there.  
> **GitHub:** public mirror for visibility, stars, and feedback.

Self-hosted spot trading bot for Binance with a web dashboard.
Runs with **your own** API keys, defaults to **testnet**, and stores its state locally.

- **GitLab (canonical):** <https://gitlab.com/AndreyPopov/spot-trading-bot>
- **GitHub mirror + feedback:** <https://github.com/PopovAndrii/spot-trading-bot>
- **Documentation site (GitLab Pages):** <https://exchange-crypto-059f74.gitlab.io/>
- **Documentation site (GitHub Pages):** <https://popovandrii.github.io/spot-trading-bot/>
- **Docker Hub:** <https://hub.docker.com/r/5879/spot-trading-bot>
- **Documentation sources:** VitePress docs in `docs/`

## Quick start

You need **Docker with Compose v2**.

1. Create a working directory and save `compose.public.yml` there as `compose.yml`.
2. Create a writable data directory:

```sh
mkdir -p data
```

3. Generate your `.env` interactively:

```sh
docker compose run --rm -v "$PWD":/out -e ENV_OUT=/out/.env app npm run setup-user
```

4. Start the bot:

```sh
docker compose up -d
```

5. Open `http://localhost:3002` and log in with the credentials from step 3.

## Everyday commands

```sh
docker compose pull && docker compose up -d   # update
docker compose logs -f                        # follow logs
docker compose down                           # stop
```

## Safety notes

- Start on **Binance testnet** first.
- If `BINANCE_MODE=real` but no real keys are configured, the bot safely falls back to **testnet**.
- Do **not** run the same pair in both directions at once on one account
  (for example `BTCUSDC` Long and `BTCUSDC` Short simultaneously). Some destructive
  actions work on the **whole symbol**, so a cancel operation may affect both sides.
- This project is still **in testing**. It is provided **as is**, with **no warranty**,
  and the author accepts **no responsibility** for losses, damages, or trading results.

## Documentation

- User / operator docs: `docs/`
- Getting started: `docs/guide/getting-started.md`
- Testnet vs real: `docs/guide/testnet-vs-real.md`
- Running & persistence: `docs/operations/running.md`
- Developer notes: `docs/developer/for-developers.md`
- Disclaimer: `docs/help/disclaimer.md`

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


## License

**Copyright © 2026 Andrii Popov.**

Released under the **GNU General Public License v3.0 or later** (GPLv3). See `LICENSE`.

## Disclaimer

This software is an **independent, unofficial** project, not affiliated with Binance.
It is a tool, **not financial advice**.

By using it, you accept that:

- live trading is done at your own risk;
- the software may contain bugs;
- the author and contributors accept **no liability** for financial loss or damages.
