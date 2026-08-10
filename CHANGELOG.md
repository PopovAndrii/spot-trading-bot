# Changelog

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
