#!/bin/bash
set -e

cd /var/www/src

# Production serves pre-compiled CSS (style.css is committed). Build only as a
# fallback if it is missing (needs the sass devDependency).
if [ ! -f public/stylesheets/style.css ]; then
  echo "🎨 style.css missing — building…"
  npm run build-css || echo "⚠️  build-css failed (sass devDep missing?) — commit compiled style.css"
fi

# pm2-runtime = container-native PM2: runs in the foreground as PID 1, forwards
# SIGTERM for graceful shutdown, and streams logs to `docker logs`.
# (Unlike `pm2 start` which daemonizes and needs `tail -f /dev/null` to stay up.)
exec node_modules/.bin/pm2-runtime start ./bin/www --name my-app
