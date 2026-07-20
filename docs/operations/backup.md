# Backup & Updates

## Where your state lives

Your money state — open cycles, fills, banked profit, sessions — lives in the
**`data/` folder next to your `compose.yml`**, as `data/SYMBOL-binance.json`. It's a
plain host folder you can read and copy directly, and it survives restarts and image
updates.

## Everyday commands

```bash
docker compose pull && docker compose up -d   # update
docker compose logs -f   # follow logs
docker compose down       # stop (data is kept)
```

## Back up your state

The folder sits right next to your `compose.yml` — just copy it:

```bash
tar czf data-backup.tgz data/   # or: cp -r data data.bak
```

::: tip Back up before updating
A cycle holds real position state. Take a `data-backup.tgz` snapshot before a
`docker compose pull`, so you can roll back if an update misbehaves.
:::
