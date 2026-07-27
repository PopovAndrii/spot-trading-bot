# Changelog

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
