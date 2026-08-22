# Interface

Every control on the dashboard, in the order it appears. Read this alongside the
[strategy overview](/dca-grid/overview) — each field shapes the ladder described
there.

> 📷 **Screenshot:** the full form (strategy selector, parameter fields, buttons).

Two groups behave differently once a cycle is running:

- **Build parameters** define the ladder and are **locked** while the bot runs —
  they only take effect on the next *Calculate*.
- **Runtime parameters** (marked 🟢 below) can be **changed live**; the change is
  written to the running cycle on the fly.

## Strategy direction

### Long / Short

The direction of the whole strategy.

- **Long** — the ladder sits **below** price. You buy the dips and close higher. Use
  when you expect a range or an uptrend.
- **Short** — mirrored: the ladder sits **above** price, you sell the rallies and
  close lower.

Clicking **Long** or **Short** also pulls your **Available balance** from the
exchange for that pair.

## Build parameters

These build the ladder. Locked while a cycle runs.

### Available balance

The budget the entire grid is sized from. It is fetched from the exchange when you
click Long/Short.

- You may **reduce** it to trade with less than your full balance.
- **Do not inflate it** above what you actually hold — the grid would plan orders
  the account can't cover.

### Order Size

The size of the **first** order. It must be **at least** the exchange's minimum for
the pair; setting it about **+5%** above that minimum is the usual safe margin. Every
deeper rung grows from this first size according to the progression.

### Profit

The target profit of the whole-position close, in percent. Typically **≤ 1%**;
the optimal range is **0.2–0.5%**. This margin (plus commission) is added above your
**average** entry to price the closing order.

### Exchange commission

Your Binance commission, in percent. Binance is generally **0.25%**, but you may
qualify for a **0.1%** bonus rate — set whichever applies to you. The bot folds this
into the close price so the target profit is *net* of fees.

### Progression strategy

How the order size grows as the grid goes deeper:

- **Progressive** — each step is scaled by a fixed multiplier.
- **Fibonacci** — sizes follow the Fibonacci sequence.

This governs how quickly the deposit is consumed down the ladder. **Fibonacci is the
most effective** of the two.

### Martingail

The Martingale factor. It controls the **gap of the closing order** (the final sale)
and how the end of the series behaves:

- **Higher** → the end-of-series close triggers more effectively and more often, but
  the **balance depletes very quickly**.
- **Lower** → the grid is very wide with good percentage overlap, but the final order
  sits **further away** than you'd want.

Guide ranges: **min 25–35 · optimal 35–80 · excellent 80–100+**.

### Progressive step

Controls the **overlap %** between rungs — the price distance between drops (Long) or
rises (Short).

- **More overlap (> 20%)** → lower risk (good), but orders fill **less often** (bad).
- Find the balance for how much currency your account holds.

### Indent price

The distance between the **first order** and the **current price** — how far below
(Long) / above (Short) the market the ladder starts.

## Remembering your settings

Pressing **Save** also remembers your Build parameters **per pair and per
strategy** (Long/Short), in the browser's local storage — not on the server. Next
time you click **Long** or **Short** for that same pair, your last-saved Order
Size, Profit, Commission, Progression strategy, Martingail, Progressive step,
Indent price, Hybrid params and Runtime parameters are restored automatically,
instead of the server's generic defaults.

- This only fires on a **Long/Short click** (or switching pairs and coming back).
  It does **not** apply on a plain page reload — a reload shows the pair's saved
  **config file** instead (the grid that was actually calculated/placed), so the
  form never lies about what the bot is really running.
- **Available balance** and **price** are never remembered this way — they always
  come fresh from the exchange when you click Long/Short.
- It's per-browser: local storage doesn't sync across browsers or devices.

## Runtime parameters 🟢

Changeable while the bot runs; written to the live cycle on the fly.

### Active orders 🟢

How many orders sit **live on the book at once**. The bot keeps this many resting and
places deeper ones as shallower rungs fill.

### Request frequency 🟢

The polling period for the whole series, in milliseconds — how often the bot checks
order and price state. Lower = more responsive, more API calls.

### Restart 🟢

When **on**, the bot **starts a new cycle automatically** after the current series
closes. When off, it stops after the current cycle completes.

### Greed lock 🟢

Orders are sized from the **live price** (Order Size × price) against a **fixed**
Available balance. After the price rallies, each rung costs more, so the same
balance may only fit a **shorter** ladder than the cycle that just closed — the
leftover slice of the balance would otherwise sit idle for the whole next cycle.

With Greed lock **on**, a Restart is refused if the new grid would come out with
**fewer orders** than the previous cycle. The bot stops instead of looping into the
shrunk ladder, and sends a Telegram notice with the old/new order count and the
idle balance, so you can raise the deposit or order size and start again
deliberately.

With Greed lock **off** (default), Restart always rebuilds the grid from the fresh
price, even if that means fewer orders.

## Actions

### Calculate

Builds the grid from the current build parameters and renders it in the
[table](/dca-grid/table). This is a **preview** — nothing is sent to the exchange.

### Save

Persists the calculated grid and settings for the pair, so they survive a reload and
can be started later.

### Start / Stop

**Start** begins the live cycle — the bot places orders and manages them. The button
then becomes **Stop**, which halts the cycle. (See [Managing a pair](/dca-grid/pair-controls)
for cancelling or deleting orders.)

### Stream

Beside Start/Stop, the live price ticker for the pair (e.g. `BNBUSDT 556.15`). It
updates from the exchange stream and is the price the bot measures everything
against.

> 📷 **Screenshot:** the Calculate / Save / Start-Stop row with the live Stream price.

---

Next: [Reading the grid table](/dca-grid/table) — how these settings turn into rows.
