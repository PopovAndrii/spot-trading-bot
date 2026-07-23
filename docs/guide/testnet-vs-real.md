# Testnet vs Real

The bot picks its Binance network from **`BINANCE_MODE`** (set during `setup-user`),
independent of `NODE_ENV`:

| `BINANCE_MODE` | Uses | Keys used |
|---|---|---|
| `test` | Binance **testnet** | `API_KEY_TEST` / `API_SECRET_TEST` |
| `real` | Binance **mainnet** | `API_KEY` / `API_SECRET` |

## Testnet keys — required

Test keys are the **safe fallback**, so they're required. Get them for free at
**[testnet.binance.vision](https://testnet.binance.vision)** — log in with GitHub, then
*Generate HMAC_SHA256 Key*. Testnet uses **play money**; trade all you want.

## Real keys — optional

Create them in your Binance account → *API Management*:

- Grant **spot trading** permission **only**.
- **Do not enable withdrawals.**

## Safety fallback

If `BINANCE_MODE=real` but **no real keys are present**, the bot automatically runs on
**testnet** instead of touching real funds. You cannot accidentally trade real money
without real keys in place.

## Switching an already-configured bot

The network is decided by **`BINANCE_MODE`** in `.env`. Flipping it moves the bot
between testnet and mainnet. Two ways to change it:

**Re-run the setup wizard** — interactive, and lets you add the keys for the mode
you're switching to:

```bash
docker compose run --rm -v "$PWD":/out -e ENV_OUT=/out/.env app npm run setup-user
```

**Or edit `.env` by hand** — change the one line:

```ini
BINANCE_MODE=real   # or: test
```

Either way, **recreate the container** so it re-reads `.env` — a plain
`docker compose restart` keeps the old values:

```bash
docker compose up -d --force-recreate
```

::: tip Real needs real keys
Switching to `real` only takes effect if `API_KEY` / `API_SECRET` are set. Without
them the bot silently stays on testnet — the [safety fallback](#safety-fallback) above.
:::

::: warning Switch only when a pair is flat
Saved state (the open cycle, its grid and resting orders) is stored per **pair**, not
per network — `data/SYMBOL-binance.json` is the same file in both modes. Order IDs from
one network don't exist on the other, so switch a pair only when it has **no live
cycle** (stopped and closed out). Otherwise the bot starts up trying to reconcile
against orders that aren't there on the network you just moved to.
:::

::: warning Start on testnet
Only switch to `real` once you understand how the bot behaves through a full cycle.
Testnet order books are **thin**, so fills and slippage there are not representative —
judge the *logic* on testnet, not the *execution*. See the
[FAQ](/help/faq#testnet-wicks).
:::

::: danger Testing status and liability
This project is still **in testing**. It is provided **as is** with **no warranty**,
and the author accepts **no responsibility** for losses, damages, or trading results.
:::
