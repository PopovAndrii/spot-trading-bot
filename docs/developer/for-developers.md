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
The production image bakes in the runtime code and mounts only persistent state — there is
no bind-mounted source, so a code change never reaches the running bot until the image is
rebuilt.

Deploy an update to the self-hosted production server:

```sh
GIT_COMMIT=$(git rev-parse --short HEAD) GIT_BRANCH=$(git rev-parse --abbrev-ref HEAD) \
  docker compose -f compose.prod.yml build
docker compose -f compose.prod.yml up -d
```

`GIT_COMMIT`/`GIT_BRANCH` are baked into the image build args and only stamp the running
app's footer with the commit/branch that is actually live — they don't affect behavior.
Omit them and the footer is blank.

### Docker Hub image

`5879/spot-trading-bot` is a **separate** public image for `compose.public.yml` users — it
is not the same artifact as the production deploy above, and updating your own production
server does not update it. It uses the same `prod` build target, just tagged and pushed:

```sh
docker build --target prod -t 5879/spot-trading-bot:2.0.8 -t 5879/spot-trading-bot:latest \
  -f docker-config/Dockerfile .
docker push 5879/spot-trading-bot:2.0.8
docker push 5879/spot-trading-bot:latest
```

Push the version tag **and** `:latest` — `compose.public.yml` pins `:latest` by default, so
skipping it leaves existing installs on the old image after `docker compose pull`.

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

Bump the version in `src/package.json` without creating a git tag automatically (run
inside the container, see [Local development](#local-development)):

```sh
npm version 2.0.8 --no-git-tag-version
```

Then create and push the release tag from the host:

```sh
git tag -a v2.0.8 -m "Release v2.0.8"
git push origin v2.0.8
```
