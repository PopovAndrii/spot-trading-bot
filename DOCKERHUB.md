# Binance Trading Bot

Self-hosted spot trading bot for Binance, with a web dashboard. You run it on
your own machine, with **your own** Binance API keys — the image ships with no
keys and never sends your credentials anywhere. Runs on testnet out of the box.

- **Image:** `5879/binance-bot`
- **Tags:** `latest`, `X.Y.Z` (pin a version for stability)
- **Architectures:** `linux/amd64`, `linux/arm64` (Intel & Apple Silicon)

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
      - binance-data:/var/www/src/data
      - /etc/localtime:/etc/localtime:ro
    env_file:
      - path: .env
        required: false
    environment:
      NODE_ENV: ${NODE_ENV:-production}
      STATUS_APP: ${STATUS_APP:-false}
      STATUS_LOGIN: ${STATUS_LOGIN:-true}
      PORT: ${PORT:-3002}

volumes:
  binance-data:
```

**2. Create your `.env`** (interactive — asks for a login/password and Binance keys,
then writes a `.env` next to the compose file):

```bash
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

Your money state (open cycles, sessions) lives in the named volume `binance-data`,
so it survives restarts and image updates.

```bash
docker compose pull && docker compose up -d   # update
docker compose logs -f   # follow logs
docker compose down       # stop (data is kept)
```

Back up your state (find the exact volume name with `docker volume ls` — Compose
prefixes it with your folder name, e.g. `binance-bot_binance-data`):

```bash
VOL=$(docker volume ls -q | grep binance-data)
docker run --rm -v "$VOL":/data -v "$PWD":/backup \
  alpine tar czf /backup/binance-data.tgz -C /data .
```

Prefer a visible host folder over a named volume? In `compose.yml` replace
`binance-data:/var/www/src/data` with `./data:/var/www/src/data`, then run
`mkdir -p data` before the first start.

---

## License

**Copyright © 2026 Andrii Popov.**
Released under the **GNU General Public License v3.0 or later** (GPLv3) — you may
use, modify, and redistribute it under the same license. The image bundles
[pm2](https://github.com/Unitech/pm2) (AGPL-3.0) as a separate, unmodified
process. Full text in the `LICENSE` file (also included inside the image).

---

## Disclaimer

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
