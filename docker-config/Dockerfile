# syntax=docker/dockerfile:1

# ---------- base: общий рантайм-слой ----------
FROM node:24-bookworm-slim AS base

# curl — healthcheck/diagnostics; procps — provides `ps`, needed by concurrently/
# tree-kill to terminate child processes on Ctrl+C (slim image omits it otherwise)
RUN apt-get update && apt-get install -y --no-install-recommends curl procps \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /var/www

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

COPY --chown=node:node src/package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --chown=node:node src/ ./
COPY --chown=node:node --from=builder /var/www/src/public/stylesheets ./public/stylesheets

COPY docker-config/entrypoint.sh /usr/local/bin/entrypoint.sh
# data/ исключён .dockerignore'ом — создать пустой, писать будет node
RUN chmod +x /usr/local/bin/entrypoint.sh && mkdir -p data && chown node:node data

USER node
EXPOSE 3002
CMD ["/usr/local/bin/entrypoint.sh"]
