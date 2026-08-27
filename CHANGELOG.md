# Changelog

## v2.0.8

### Added

- Hybrid tail now follows price like the micro: at placement it takes the live micro's price when that is more favorable than its own recomputed exit, and while resting it recomputes on every poll and cancel-replaces on drift — so lowering Micro profit %/commission reaches an already-placed tail immediately instead of only on the next fill that deepens the ladder.

## v2.0.7

### Added

- Greed lock: an optional switch that refuses an auto-Restart if the new grid would come out with fewer orders than the cycle that just closed (a price rally makes each rung more expensive against a fixed deposit). The bot stops instead of looping into a shrunk ladder, with a Telegram notice showing the old/new order count and the idle balance.
- Save now remembers your tuned Build parameters (order size, profit, commission, martingale, fibonacci step, indent, grid/hybrid params, active orders, request frequency) per pair and per strategy in the browser's local storage. Clicking Long/Short restores your last-saved values instead of the server's generic defaults.

### Fixed

- Landing directly on a pair page (`/spotbot/:symbol`) for an already-configured pair left the SpinBox decrement arrows stuck disabled at their server-rendered state; only a manual Long/Short click recreated the widget correctly. Fixed by recreating the SpinBox after the saved config is applied.
- Indent price could not reach 0 (SpinBox minimum was 0.01).
- A background tab's WebSocket reconnect could sit stuck behind a frozen, throttled backoff timer until the tab was refocused; regaining visibility now clears the pending timer and retries the connection immediately.
- Mobile: the order table could grow wider than the screen and drag the whole page (including the parameter form above it) into a sideways scroll. The table now scrolls horizontally on its own, the rest of the layout stays put.
- Mobile: the danger-zone row (Cancel all / Delete current series / Hybrid grid / Expert Mode) no longer fits four items abreast; it now wraps onto two rows of two, with the switch labels moved above their sliders so both fit.
- Mobile: Calculate, Save, Start and Cancel all orders now show their text label alongside the icon (previously icon-only on every screen size).
- Mobile Firefox: the fixed console at the bottom could hide the buttons below the table almost entirely when open — the page only reserved space for it via a `body:has(.console--open)` selector that mobile Firefox wasn't honoring. Reserving that space now uses a plain class toggled by the console's own open/close handler instead.

## v2.0.6

### Fixed

- Static assets (JS/CSS) served without cache-control could linger stale in the browser across deploys, showing mismatched footer versions and a resurrected pre-fix Start-button race until a hard refresh. Static serving now forces revalidation via `Cache-Control: no-cache`.

## v2.0.5

### Fixed

- Start button, parameter lock, and the header pair-status label could get stuck out of sync with the running bot after a fresh page load (new tab, post-login): a DOM race in the lock logic could silently drop the running state, and the pair-list label was never resynced once the page's status check completed.

## v2.0.4

### Fixed

- Cycle no longer ends when a close fills at the deepest held rung but the position isn't flat: the classic close now recomputes the leftover from the real fills instead of trusting a stale rung-sized order left on the slot by a pulled hybrid scalp.

### Changed

- Telegram: batched trade messages drop the closing separator line; Start/Pause/Series deleted messages get a color-coded square icon.

## v2.0.3

### Fixed

- Distinguish exchange outage (maintenance, gateway 502/503) from an invalid key or a real bug, instead of showing both as the same raw error.
- Request timeout on key checks, so a dead network fails fast instead of hanging indefinitely.
- Pair page shows a friendly "temporarily unavailable, retry in a few minutes" message during an exchange outage, instead of a raw stack trace.

## v2.0.2

### Added

- Public GitLab Pages documentation link from the repository front page.
- Dedicated developer documentation page with release command examples.
- AI usage guidance in the docs for setup, deployment, and manual review expectations.

### Fixed

- Auto-create pair state for live params.
- Suppressed `npm` update/fund noise in the Docker setup flow.

## v2.0.1

### Added

- Live re-place of a resting micro: when Micro profit % (or commission) changes, the standing micro re-quotes to the new price atomically via `cancelReplace`, following the knob without waiting for a fill or rearm.
- VitePress documentation site, including a worked Long DCA/Grid Hybrid full-cycle example.

### Changed

- Rebrand: new logo, bind-mounted `data/` directory, and a link to the main repository.
- Docker Hub image renamed to `5879/spot-trading-bot`.

### Fixed

- Resting micro now shows its real order-book price instead of a stale/derived value.
- Re-place popup price is rounded to tick, removing float artifacts in the displayed price.

## v2.0.0

### Added

- First test release of the DCA / Grid hybrid strategy.
- DCA safety-order ladder that averages the entry down — each rung deeper and larger than the last.
- Averaged grid close: the whole position exits as one take-profit that follows your real fills, not a static plan.
- Micro-scalp that banks the oscillations while the position waits and pulls the exit price closer.
- Live hybrid controls adjustable on a running cycle.
- Telegram trade notifications.
- Testnet-first: ships with no keys, defaults to Binance testnet.
- Docker Hub distribution.
