# Configuration (.env)

`setup-user` writes these for you; you can also edit `.env` by hand and restart.

## Environment variables

| Variable | Purpose |
|---|---|
| `ADMIN_LOGIN` / `ADMIN_PASSWORD_HASH` | Dashboard login (bcrypt hash). |
| `SESSION_SECRET` | Signs session cookies (auto-generated). |
| `BINANCE_MODE` | `test` or `real` — see [Testnet vs Real](/guide/testnet-vs-real). |
| `API_KEY` / `API_SECRET` | Real mainnet keys (optional). |
| `API_KEY_TEST` / `API_SECRET_TEST` | Testnet keys (required). |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` | Trade & alert notifications (optional). |
| `NODE_ENV` | `production` (default). |
| `PORT` | HTTP port (default `3002`). |
| `STATUS_LOGIN` | `false` disables auth — local/trusted use only. |

## Parameter limits

The dashboard clamps each field to a safe range:

| Field | Min | Max |
|---|---|---|
| Profit | 0.1 | — |
| Exchange commission | 0.2 | 2 |
| Martingail | 20 | 150 |
| Progressive step | 0.01 | 2 |
| Indent price | 0.01 | 1 |
| Grid from order | 1 | 50 |
| Micro profit % | 0.01 | 2 |
| Grid exit % | 0 | 100 |
| Active orders | 2 | 50 |
| Request frequency (ms) | 500 | 5000 |

## Exchange filters

On top of these, the bot reads the pair's own **exchange filters** from Binance —
**tick size** (price precision), **step size** (quantity precision), and the **minimum
notional** — and rounds every order to them. This is why **Order Size** must be at least
the exchange minimum for the pair: an order below it would be rejected by Binance.
