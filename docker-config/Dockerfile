FROM node:24-bookworm-slim

# curl — healthcheck/diagnostics; procps — provides `ps`, needed by concurrently/
# tree-kill to terminate child processes on Ctrl+C (slim image omits it otherwise)
RUN apt-get update && apt-get install -y --no-install-recommends curl procps \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /var/www

USER node
