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

Node.js + Express 5, EJS templates, WebSocket (`ws`), SCSS, Docker, pm2.
Key dep: `@binance/connector` for the Binance REST API. Auth: `express-session`
+ `bcrypt`; `express-rate-limit` guards the login route. (Nginx is present in
`compose.yml` but **disabled** — Node is served directly on `${PORT}`.)

## Commands

Run inside the container (`docker compose exec app <cmd>`), or via the `init`
helper script:

- `npm start` — `nodemon ./bin/www` (the real server; WS + browser-sync live here).
- `npm run dev` — CSS watch + server together (`concurrently`).
- `npm test` — Node's built-in test runner (`node --test`); specs in `src/test/`.
- `npm run lint` / `npm run lint:fix` — ESLint (+ Prettier).
- `npm run build-css` / `npm run watch-css` — compile `scss/` → `public/stylesheets/`.
- `npm run setup-user` — generate `src/.env` (admin hash, session secret, keys).
  See `src/.env.example` for the full variable list.
- `npm run prod-runtime` — `pm2-runtime` (prod).

## Requirements log

`REQUIREMENTS.md` is the running spec/changelog. Commits and code comments
reference items by number (e.g. "req 24", "req 22"). When you touch behavior that
maps to a numbered requirement, read that entry first and keep its rationale.

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
  The upgrade is **authenticated** in `bin/www`: the shared session middleware
  runs on the handshake, so an un-logged-in socket gets 401 (req 24/16) — unless
  `STATUS_LOGIN=false`.
- `lib/UserStreamApi.js` — Singleton WS client to Binance **user data stream**
  (listenKey + keep-alive + heartbeat/backoff reconnect). For account/order events.
- `lib/atomicWrite.js` — `writeFileAtomic`: temp-file + `fs.rename` so a crash mid-write
  never leaves a corrupt config (the single source of truth for open orders, req 22).
- `lib/runMode.js` — `isTestnet()` / `requestedTestnet()`: which Binance to hit
  (see Runtime section). Used by `invokeAPI`/`checkKeys` to pick keys + baseURL.
- `lib/checkKeys.js` — Validates an API key+secret **pair** via a signed account
  request against the matching baseURL (real vs testnet). Powers the key-status UI.
- `lib/logBus.js` — Tiny in-process pub/sub (ring buffer, 200 entries) feeding the
  web terminal. `invokeAPI` errors are pushed here instead of thrown.
- `lib/serverIp.js` — Cached public-IP lookup (ipify) for the Binance IP-whitelist UI.
- `lib/pair.js` — In-memory registry (`Map`) of active symbols + status
  (NEW/START/STOP).
- `lib/MomentumIndicator.js` — Weighted momentum score (price/volume/trend/volatility)
  from candles. **WIP**, not wired into the main loop.
- `lib/DynamicMartingail.js`, `lib/test2.js` — Experimental dynamic-martingale
  calculator / scratch. **Not in the main flow**; treat as drafts.

## Routes

Auth gate: everything after `/login` requires a session (`ensureAuthenticated`),
unless `STATUS_LOGIN=false`.

- `routes/login.js` — `GET /login`, `GET /login/logout`, `POST /login`
  (rate-limited bcrypt login).
- `routes/index.js` — `GET /` (main page, pair selector from `getSpotSymbols`),
  `POST /check-keys` (key validation).
- `routes/nav.js` (mounted at `/api`) — `GET /symbols`, `/session`, `/session/ping`,
  `/ping`, `/logs` (web-terminal history from `logBus`).
- `routes/info.js` — `GET /info`, `POST /info/account-info` (balances).
- `routes/spotbot.js` — `GET /:currency` (bot page), `POST /:symbol`
  (balance+ticker+exchangeInfo), `POST /table/:symbol` (saved config),
  `POST /calculator/result` (run grid), `POST /calculator/save`,
  `POST /calculator/restart` (toggle auto-restart), `POST /cancel/allorders`.

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
- **Releases:** keep every release in the SAME style as the previous ones — do
  not change the formatting from release to release. Rules:
  - **English only**, never Russian.
  - **No emoji** anywhere.
  - **Don't change the markdown style** between releases — match how the prior
    release was formatted.
  - Single-line annotated tag message: `Release vX.Y.Z — <short summary>`, where
    the summary is a concise comma/`+` separated list (e.g. `Release v1.0.3 —
    fixes + rebalance closing logic, dynamic pairs, prod Docker`). Title is just
    `vX.Y.Z`.
  - Don't invent a new format or add/remove sections each time.

## Parked work

- **Binance.US** (`BINANCE_REGION=com|us`) lives on branch `binance-us`, not `dev`.
  Blocked: user is in the UK (can't open a Binance.US account; `api.binance.us` is
  geo-fenced to US IPs), so it can't be live-validated without an actual US user.
