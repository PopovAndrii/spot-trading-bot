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

::: warning Start on testnet
Only switch to `real` once you understand how the bot behaves through a full cycle.
Testnet order books are **thin**, so fills and slippage there are not representative —
judge the *logic* on testnet, not the *execution*. See the
[FAQ](/help/faq#testnet-wicks).
:::
