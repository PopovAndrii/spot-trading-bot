# TODO

## BUG: float artifact in displayed price

`price` renders as `0.028964999999999998` instead of `0.02896` (ETHBTC tickSize = 0.00001).

- Appears when **Grid exit %** is changed.
- Disappears after 1 tick of the iterator (next update overwrites it with a clean value).

Binance sends the price as a string (`"0.02894000"`), so the tail comes from arithmetic on our side.
Fix: round to `decimalCount(tickSize)` before display.
