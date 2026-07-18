# Getting Started

You need **Docker with Compose v2** and one file. The bot runs from the published
image `autoxarkov/binance-bot` — no repository clone, no build.

## Minimal start

**1. Create a folder with this `docker-compose.yml`:**

```yaml
services:
  app:
    image: autoxarkov/binance-bot:latest
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

**2. Create your `.env`** — interactive; asks for a dashboard login/password and
your Binance keys, then writes a `.env` next to the compose file:

```bash
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
docker compose pull && docker compose up -d   # update to the latest image
docker compose logs -f                         # follow logs
docker compose down                            # stop (data is kept)
```
