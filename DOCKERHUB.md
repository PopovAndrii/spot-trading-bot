# Spot Trading Bot for Binance

Self-hosted spot trading bot for Binance, with a web dashboard. You run it on
your own machine, with **your own** Binance API keys — the image ships with no
keys and never sends your credentials anywhere. Runs on testnet out of the box.

- **Image:** `5879/binance-bot`
- **Tags:** `latest`, `X.Y.Z` (pin a version for stability)
- **Architectures:** `linux/amd64`, `linux/arm64` (Intel & Apple Silicon)

---

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

---

## Minimal start

You only need Docker with Compose v2, and one file.

**1. Create a folder with this `compose.yml`:**

```yaml
services:
  app:
    image: 5879/binance-bot:latest
    container_name: binance-bot
    restart: unless-stopped
    ports:
      - "${PORT:-3002}:${PORT:-3002}"
    volumes:
      - ./data:/var/www/src/data
      - /etc/localtime:/etc/localtime:ro
    env_file:
      - path: .env
        required: false
    environment:
      NODE_ENV: ${NODE_ENV:-production}
      STATUS_APP: ${STATUS_APP:-false}
      STATUS_LOGIN: ${STATUS_LOGIN:-true}
      PORT: ${PORT:-3002}
```

**2. Create the `data/` folder and your `.env`** (the `.env` step is interactive —
asks for a login/password and Binance keys, then writes a `.env` next to the compose
file):

```bash
mkdir -p data
docker compose run --rm -v "$PWD":/out -e ENV_OUT=/out/.env app npm run setup-user
```

**3. Start it:**

```bash
docker compose up -d
```

**4. Open** http://localhost:3002 and log in with the credentials from step 2.

> `env_file: required: false` needs Docker Compose ≥ 2.24. On older versions,
> run `touch .env` before step 3.

---

## Testnet vs real keys

The bot picks its network from `BINANCE_MODE` (set during `setup-user`), independent
of `NODE_ENV`:

| `BINANCE_MODE` | Uses            | Keys used                       |
|----------------|-----------------|---------------------------------|
| `test`         | Binance testnet | `API_KEY_TEST` / `API_SECRET_TEST` |
| `real`         | Binance mainnet | `API_KEY` / `API_SECRET`        |

- **Test keys are required** — they're the safe fallback. Get them for free at
  **https://testnet.binance.vision** (log in with GitHub → *Generate HMAC_SHA256 Key*).
  Testnet uses play money; trade all you want.
- **Real keys are optional.** Create them in your Binance account → *API Management*.
  Give them **spot trading** permission only, and **do not enable withdrawals**.
- **Safety fallback:** if `BINANCE_MODE=real` but no real keys are present, the bot
  automatically runs on testnet instead of touching real funds.

**Start on testnet.** Only switch to `real` once you understand how the bot behaves.

---

## Configuration (`.env`)

`setup-user` writes these for you; you can also edit `.env` by hand.

| Variable | Purpose |
|---|---|
| `ADMIN_LOGIN` / `ADMIN_PASSWORD_HASH` | Dashboard login (bcrypt hash) |
| `SESSION_SECRET` | Signs session cookies (auto-generated) |
| `BINANCE_MODE` | `test` or `real` |
| `API_KEY` / `API_SECRET` | Real mainnet keys (optional) |
| `API_KEY_TEST` / `API_SECRET_TEST` | Testnet keys (required) |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` | Trade notifications (optional) |
| `NODE_ENV` | `production` (default) |
| `PORT` | HTTP port (default `3002`) |
| `STATUS_LOGIN` | `false` disables auth — local/trusted use only |

---

## Data, updates, and control

Your money state (open cycles, sessions) lives in the **`data/` folder next to your
`compose.yml`** (`data/SYMBOL-binance.json`), so it survives restarts and image updates.

```bash
docker compose pull && docker compose up -d   # update
docker compose logs -f   # follow logs
docker compose down       # stop (data is kept)
```

Back up your state — it's a plain folder, just copy it:

```bash
tar czf data-backup.tgz data/   # or: cp -r data data.bak
```

---

## License

**Copyright © 2026 Andrii Popov.**
Released under the **GNU General Public License v3.0 or later** (GPLv3) — you may
use, modify, and redistribute it under the same license. The image bundles
[pm2](https://github.com/Unitech/pm2) (AGPL-3.0) as a separate, unmodified
process. Full text in the `LICENSE` file (also included inside the image).

---

## Disclaimer

**Not affiliated with Binance.** This is an independent, unofficial open-source
project — **not** created, endorsed, or supported by Binance. "Binance" and related
marks belong to their respective owner and are used only to describe the exchange this
software connects to, through the public API with **your own** keys.

This software is provided **"as is", without warranty of any kind**, express or
implied. It is a tool, **not financial advice**.

- In `real` mode it places live orders with **real funds**. You are solely
  responsible for every trade, gain, and loss.
- Cryptocurrency trading carries substantial risk. Never trade money you cannot
  afford to lose. **Test on testnet first.**
- The authors and contributors accept **no liability** for any financial loss,
  damages, or claims arising from the use of this software.
- You are responsible for complying with the laws and regulations of your
  jurisdiction and with Binance's terms of service. Your API keys stay in your
  own `.env` on your own machine — they are never transmitted to the authors.

By running this image you accept these terms.
