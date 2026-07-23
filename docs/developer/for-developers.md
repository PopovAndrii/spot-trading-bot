# For developers

This page collects the project details that are useful for contributors and maintainers,
so the public `README.md` can stay focused on quick start.

## Repository model

- **`main`** — releases only
- **`dev`** — integration branch for changes that are not yet live-tested
- Topic branches are cut from a release and merged back into `dev`, not directly into `main`

GitLab is the canonical repository for development, issues, merge requests, and releases.
GitHub is a read-only mirror.

## Local development

The project runs in Docker. `node`, `npm`, and `npx` are expected to run **inside the container**.

Main commands:

```sh
docker compose up -d --build
docker compose exec app bash
```

Inside the container:

```sh
npm run dev
npm start
npm test
npm run lint
npm run build-css
```

## Main project structure

- `src/lib/calculator.js` — grid builder
- `src/lib/job.js` — state machine for one pair cycle
- `src/lib/rebalanceClose.js` — recomputes the close from real fills
- `src/modules/jsonTimerSender.js` — main bot loop
- `src/lib/websocketRouter.js` — browser websocket server
- `src/lib/invokeAPI.js` — Binance REST wrapper
- `src/lib/UserStreamApi.js` — Binance user data stream
- `src/data/*.json` — persisted pair state

## Environment notes

- `BINANCE_MODE=test|real` selects the Binance environment
- `STATUS_APP` unset means the bot logic is effectively a no-op
- `STATUS_LOGIN=false` disables authentication
- real mode without real keys falls back to testnet

## Production notes

Production uses `compose.prod.yml` and `pm2-runtime` through `docker-config/entrypoint.sh`.
The production image bakes in the runtime code and mounts only persistent state.

## Validation

Run inside the container when available:

```sh
npm test
npm run lint
```

Docs build from the repository root:

```sh
npm --prefix docs ci
npm --prefix docs run build
```

## Formatting

Formatting is handled by the configured linters, not Prettier:

- JavaScript: ESLint + `@stylistic/eslint-plugin`
- SCSS/CSS: Stylelint + `@stylistic/stylelint-plugin`
- EJS: `js-beautify`

## Release notes

Keep public release documentation and tags in the established project format.
Development happens on GitLab; publish the GitHub mirror only after the GitLab side is ready.

## Release commands

For this project, bump the version in `src/package.json` without creating a git tag automatically:

```sh
docker compose exec app sh -lc "cd /var/www/src && npm version 2.0.2 --no-git-tag-version"
```

Then create and push the release tag from the host:

```sh
git tag -a v2.0.2 -m "Release v2.0.2 — test"
git push origin v2.0.2
```
