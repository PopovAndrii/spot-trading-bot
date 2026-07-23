# FAQ & Troubleshooting

## Testnet fills look wrong / weird wicks {#testnet-wicks}

Binance **testnet order books are thin**, so price can spike on tiny volume and orders
fill at prices you'd never see on mainnet. That's the testnet, not the bot. Use testnet
to validate the **logic** (does the grid build, arm, scalp, close correctly?), and judge
**execution and slippage** only on mainnet. See [Testnet vs Real](/guide/testnet-vs-real).

## The bot is on testnet even though I set `real`

That's the **safety fallback**: `BINANCE_MODE=real` with **no real keys present** runs on
testnet on purpose, so you can't trade real funds without real keys. Add
`API_KEY` / `API_SECRET` and restart. See [Testnet vs Real](/guide/testnet-vs-real#safety-fallback).

## Hybrid is on but nothing is scalping

The micro must fit **under the split** ([Grid exit %](/hybrid/parameters#grid-exit)). If
*Micro profit % + commission* needs more room than the split leaves, the scalp is refused
and the cycle runs as plain DCA. Check the [✓ / ✗ marks](/hybrid/grid-marks): a red ✗
means no room — **raise Grid exit %** or **lower Micro profit %** (or turn on
[Auto exit](/hybrid/parameters#auto-exit) to do it automatically).

Also: rungs **above** *Grid from order* never scalp by design, and a micro only arms when
price is in the lower part of the gap. The [summary bar](/hybrid/summary-bar) spells out
the current state.

## I changed a parameter but nothing happened

Only the **runtime** parameters (Active orders, Request frequency, Restart, and the whole
hybrid row) apply to a live cycle. The **build** parameters are locked while running —
they only take effect on the next *Calculate* / new cycle. See the
[Interface](/dca-grid/interface).

## How do I reset a pair cleanly?

Stop → Check and Cancel all → Delete current series → reconfigure. Full steps in
[Managing a pair](/dca-grid/pair-controls).

## Can I run the same pair in Long and Short at the same time?

Strongly discouraged. Avoid running the same symbol in both directions on one account
(for example `BTCUSDC` Long and `BTCUSDC` Short simultaneously).

Some destructive actions operate on the **whole symbol**, not on one logical side, so a
cancel action may affect both the Long and the Short orders.

## Did I back up my state?

Your cycles and banked profit live in the `data/` folder next to your `compose.yml`.
Copy it before updates — see [Backup & Updates](/operations/backup).
