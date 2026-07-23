# Managing a pair

Below the table sits a **danger zone** with two destructive actions. Both are
per-**symbol** and cannot be undone — read the caveat before using them.

> 📷 **Screenshot:** the danger-zone buttons (Check and Cancel all / Delete current series).

## Check and Cancel all `<pair>`

Queries the exchange for **every open order on this symbol** and cancels them.

Use it to flatten a pair — pull all resting orders in one click, for example before
reconfiguring or when you want the bot out of the book.

::: warning Acts on the whole symbol
This cancels **all** open orders for the pair on your account — the bot's grid **and
any manual orders you placed yourself**. The exchange does not distinguish them, so
this is by design. If you have unrelated orders on the same symbol, they go too.
:::

::: danger Do not trade one symbol in both directions at once
Avoid running the same pair in **Long** and **Short** simultaneously on one account
(for example `BTCUSDC` Long and `BTCUSDC` Short). Destructive actions operate on the
**whole symbol**, not on a logical direction, so a cancel action may pull orders from
both sides.
:::

## Delete current series

Removes the **saved cycle** for this pair — the stored grid and its state.

It is disabled unless there is a current series to delete. Deleting throws away the
bot's record of the open cycle for that pair; it does not, by itself, sell a
position. Cancel the live orders first (above), then delete the series to start clean.

::: danger
Deleting the series discards the bot's bookkeeping for the cycle (fills, banked
profit, position size). Do this only when you intend to abandon that cycle — never as
a way to "refresh" a running one.
:::

## Order of operations to reset a pair

1. **Stop** the cycle (the Start/Stop button).
2. **Check and Cancel all** — pull every resting order for the symbol.
3. **Delete current series** — clear the stored cycle.
4. Reconfigure, *Calculate*, *Save*, *Start* again.
