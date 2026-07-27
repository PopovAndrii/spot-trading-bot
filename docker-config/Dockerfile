# syntax=docker/dockerfile:1

# ---------- base: общий рантайм-слой ----------
FROM node:24-bookworm-slim AS base

# curl — healthcheck/diagnostics; procps — provides `ps`, needed by concurrently/
# tree-kill to terminate child processes on Ctrl+C (slim image omits it otherwise);
# git — buildInfo читает commit/dirty в dev (репо приходит bind-mount'ом, .git есть)
RUN apt-get update && apt-get install -y --no-install-recommends curl procps git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /var/www

# Silence npm's "New version of npm available" banner and the funding footer in
# every stage — build logs and deploy output should carry only our own messages.
ENV NPM_CONFIG_UPDATE_NOTIFIER=false
ENV NPM_CONFIG_FUND=false

# ---------- dev: код и node_modules приходят bind-mount'ом (compose.yml) ----------
FROM base AS dev
USER node

# ---------- builder: полные зависимости (sass) + сборка CSS ----------
FROM base AS builder
WORKDIR /var/www/src
COPY src/package*.json ./
RUN npm ci
COPY src/ ./
RUN npm run build-css

# ---------- prod: самодостаточный образ (ANALYSIS п.13) ----------
# Код, прод-зависимости, собранный CSS и entrypoint внутри образа: его можно
# выкатить как артефакт без git clone + npm install на машине. Bind-mount
# остаётся только в dev-compose; в prod-compose монтируется только src/data
# (денежное состояние робота).
FROM base AS prod
ENV NODE_ENV=production
WORKDIR /var/www/src

# В prod-образе .git нет — commit/branch для футера приходят build-arg'ами и пекутся в ENV.
# Сборка: GIT_COMMIT=$(git rev-parse --short HEAD) GIT_BRANCH=$(git rev-parse --abbrev-ref HEAD) \
#         docker compose -f compose.prod.yml build
ARG GIT_COMMIT=
ARG GIT_BRANCH=
ENV GIT_COMMIT=$GIT_COMMIT
ENV GIT_BRANCH=$GIT_BRANCH

COPY --chown=node:node src/package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Runtime-only source — deliberately selective. The published image carries NO
# scss sources (only compiled CSS, copied from the builder below), and no tests,
# dev tools, php, graphify-out, .env.example, or lint/nodemon configs.
COPY --chown=node:node src/app.js ./app.js
COPY --chown=node:node src/bin ./bin
COPY --chown=node:node src/lib ./lib
COPY --chown=node:node src/modules ./modules
COPY --chown=node:node src/routes ./routes
COPY --chown=node:node src/views ./views
COPY --chown=node:node src/public ./public
# Compiled stylesheets from the builder (overwrites public/stylesheets so the
# freshly built style.css wins; scss/ never enters the image).
COPY --chown=node:node --from=builder /var/www/src/public/stylesheets ./public/stylesheets
# GPLv3: ship the license text alongside the distributed binary.
COPY --chown=node:node LICENSE ./LICENSE

COPY docker-config/entrypoint.sh /usr/local/bin/entrypoint.sh
# data/ исключён .dockerignore'ом — создать пустой, писать будет node
RUN chmod +x /usr/local/bin/entrypoint.sh && mkdir -p data && chown node:node data

USER node
EXPOSE 3002
CMD ["/usr/local/bin/entrypoint.sh"]
