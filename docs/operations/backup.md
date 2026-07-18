# Backup & Updates

## Where your state lives

Your money state — open cycles, fills, banked profit, sessions — lives in the
`data/` directory, mounted as the named volume **`binance-data`**. It survives restarts
and image updates.

## Everyday commands

```bash
docker compose pull && docker compose up -d   # update
docker compose logs -f   # follow logs
docker compose down       # stop (data is kept)
```

## Back up your state

The volume name is prefixed by your folder name (e.g. `binance-bot_binance-data`), so
find it first, then archive it:

```bash
VOL=$(docker volume ls -q | grep binance-data)
docker run --rm -v "$VOL":/data -v "$PWD":/backup \
  alpine tar czf /backup/binance-data.tgz -C /data .
```

::: tip Back up before updating
A cycle holds real position state. Take a `binance-data.tgz` snapshot before a
`docker compose pull`, so you can roll back if an update misbehaves.
:::

## Prefer a visible host folder?

Instead of a named volume, you can keep the state in a plain `./data` folder you can see:
in `compose.yml` replace `binance-data:/var/www/src/data` with
`./data:/var/www/src/data`, then run `mkdir -p data` before the first start.
