# Changelog

## v2.0.1

### Added

- Live re-place of a resting micro: when Micro profit % (or commission) changes, the standing micro re-quotes to the new price atomically via `cancelReplace`, following the knob without waiting for a fill or rearm.
- VitePress documentation site, including a worked Long DCA/Grid Hybrid full-cycle example.

### Changed

- Rebrand: new logo, bind-mounted `data/` directory, and a link to the main repository.
- Docker Hub image renamed to `5879/binance-bot`.

### Fixed

- Resting micro now shows its real order-book price instead of a stale/derived value.
- Re-place popup price is rounded to tick, removing float artifacts in the displayed price.
