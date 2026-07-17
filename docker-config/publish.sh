#!/usr/bin/env bash
# Build the production image and push it to Docker Hub (multi-arch: amd64 + arm64).
#
# Prerequisites (one-time):
#   docker login                                   # log in to Docker Hub
#   docker buildx create --use --name multiarch    # a buildx builder for multi-arch
#
# Usage:
#   docker-config/publish.sh            # tag = version from src/package.json (+ :latest)
#   docker-config/publish.sh 1.2.0      # explicit version tag
#   IMAGE=youruser/yourname docker-config/publish.sh    # override the repo name
#
# Rename the image later by changing IMAGE (or the default below) and re-running.
set -euo pipefail
cd "$(dirname "$0")/.."   # repo root

IMAGE="${IMAGE:-autoxarkov/binance-bot}"
VERSION="${1:-$(node -p "require('./src/package.json').version" 2>/dev/null || echo latest)}"
GIT_COMMIT="$(git rev-parse --short HEAD 2>/dev/null || echo '')"
GIT_BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo '')"

echo "→ Publishing ${IMAGE}:${VERSION} (+ :latest)"
echo "  commit=${GIT_COMMIT} branch=${GIT_BRANCH}"

docker buildx build \
    --file docker-config/Dockerfile \
    --target prod \
    --platform linux/amd64,linux/arm64 \
    --build-arg GIT_COMMIT="${GIT_COMMIT}" \
    --build-arg GIT_BRANCH="${GIT_BRANCH}" \
    --tag "${IMAGE}:${VERSION}" \
    --tag "${IMAGE}:latest" \
    --push \
    .

echo "✓ Pushed ${IMAGE}:${VERSION} and ${IMAGE}:latest"
