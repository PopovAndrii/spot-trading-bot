# Getting Started

You need **Docker with Compose v2** and one file. The bot runs from the published
image `5879/spot-trading-bot` — no repository clone, no build.

## Where to run it

The bot manages open positions continuously, so it should run **24/7**.

- **Strongly recommended: a Linux web server / VPS** that stays on around the clock.
  A laptop that sleeps or a home PC you shut down leaves the bot unable to watch and
  close its open cycles.
- **Not a phone.** The dashboard is a wide desktop layout — it does not fit a
  portrait mobile screen. Use it from a desktop browser.
- **Not Windows.** The bot has not been tested on Windows and there are no near-term
  plans to support it. Run it on Linux.

## Minimal start

**1. Create a folder with this `compose.yml`:**

```yaml
services:
  app:
    image: 5879/spot-trading-bot:latest
    container_name: spot-trading-bot
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

**2. Create the `data/` folder** (so it's owned by you, not root) **and your `.env`** —
the `.env` step is interactive: it asks for a dashboard login/password and your
Binance keys, then writes a `.env` next to the compose file:

```bash
mkdir -p data
docker compose run --rm -v "$PWD":/out -e ENV_OUT=/out/.env app npm run setup-user
```

**3. Start it:**

```bash
docker compose up -d
```

**4. Open** [http://localhost:3002](http://localhost:3002) and log in with the
credentials from step 2.

::: tip Older Compose
`env_file: required: false` needs Docker Compose ≥ 2.24. On older versions, run
`touch .env` before step 3.
:::

## Next steps

- Understand [testnet vs real keys](/guide/testnet-vs-real) before touching real funds.
- Learn the [strategy](/dca-grid/overview) — what the bot is actually doing.
- Keep your money state safe: [Backup & Updates](/operations/backup).

Everyday commands:

```bash
docker compose pull && docker compose up -d   # update
docker compose logs -f   # follow logs
docker compose down       # stop (data is kept)
```
