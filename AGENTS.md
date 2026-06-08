# Project guide

Crypto trading bot for **Binance Spot** with an Express.js web UI.

## Environment Restrictions (Environment Boundaries)

- You are not permitted to create hidden folders (e.g., `.my_agent_cache/`) in the root or within the project on the host machine.
- Save all temporary build or test files exclusively to the standard system directory `/tmp` for this project.
- Always clear your temporary files before ending your session.

## Language

- **Chat with the user in Russian.** Code, commits, comments, and docs stay in
  English (see Git conventions).

## Runtime / environment

- **Runs in Docker** (docker-compose); `pm2` in prod. **Node.js and npm live
  inside the container**, NOT on the host PATH. `node`/`npm`/`npx` failing on the
  host is expected — it does not mean Node is missing. Run tooling via
  `docker compose exec <svc> npx ...`, or rely on review when the container isn't up.
- **Binance environment** is chosen in `src/lib/runMode.js`:
  - `BINANCE_MODE=test|real` takes priority; otherwise `NODE_ENV=development` → testnet.
  - Safe fallback: `real` selected but no real `API_KEY`/`API_SECRET` → falls back
    to testnet so the container doesn't crash.
- `STATUS_APP` env var: when unset, `Job` runs as a **no-op** (test mode) — it
  returns `pass` for everything and places no real orders.

## Stack

Node.js + Express 5, EJS templates, WebSocket (`ws`), SCSS, Docker/Nginx, pm2.
Key dep: `@binance/connector` for the Binance REST API.

## Core modules (in `src/`)

- `lib/calculator.js` — ES module `Calculator`. Builds the BUY/SELL grid for LONG
  or SHORT. Step strategies: `fibonacci` and `progressive` (linear). Martingale
  coefficient scales order sizes. **Commission is applied to PRICE, not quantity**
  (the close price is marked up by `profit + commission` so net profit survives fees).
- `lib/job.js` — State machine for one BUY/SELL pair. Decides the next API action
  (newOrder, getOrder, cancelOrder, cancelOpenOrders) from current order statuses.
  Position is closed by a SINGLE close order at the **top filled** entry index;
  lower close orders are canceled as superseded.
- `lib/rebalanceClose.js` — Recomputes the close order (qty/price) from real fills
  after partial executions.
- `lib/invokeAPI.js` — Singleton `InvokeApi` wrapping `@binance/connector`. Errors
  are caught and surfaced via `logBus` to the web terminal (not thrown).
- `lib/streamAPI.js` — Singleton-per-symbol WS client to Binance public ticker.
- `modules/jsonTimerSender.js` — Main bot loop. Reads JSON config, runs `Job`,
  calls Binance, writes results back. Supports auto-restart of a completed cycle.
- `lib/websocketRouter.js` — WS server (browser ↔ server), subscribe/start/stop.

## Persistence

JSON files in `src/data/` (one per symbol, e.g. `BNBUSDT-binance.json`).
Completed cycles are archived with a timestamp prefix. Keep this file-based model,
the singleton API/Stream patterns, and the `STATUS_APP` no-op flag when changing things.

## Git conventions

- **Branches:** `dev` = anything that still needs live (real-trading) testing.
  After live testing passes → merge `dev` into `main`/`master` and bump a version.
  Default new work to `dev` unless told otherwise; never merge to master or tag a
  version until the user confirms live testing passed.
- **Commits:** write subject + bullet body in **English**, concise imperative
  subject with a category prefix (`Fix:`, `Test:`, `Job:`, `@TODO`) and a short bullet body.
  **Do NOT append a `Co-Copyright-By` / copyright trailer.**
- **Timing:** don't `git commit` unprompted — the user batches related changes and
  says when to commit.

## Parked work

- **Binance.US** (`BINANCE_REGION=com|us`) lives on branch `binance-us`, not `dev`.
  Blocked: user is in the UK (can't open a Binance.US account; `api.binance.us` is
  geo-fenced to US IPs), so it can't be live-validated without an actual US user.
