/*
 * Binance Trading Bot — self-hosted spot trading bot for Binance.
 * Copyright (C) 2026 Andrii Popov
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

const createError = require('http-errors');
const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const logger = require('morgan');
const helmet = require('helmet');

const Dotenv = require('dotenv');
Dotenv.config();

// Fail-fast: without the secret, express-session throws an
// opaque stack on the very first request — better to crash now with a clear message.
if (!process.env.SESSION_SECRET) {
  console.error('❌ SESSION_SECRET is not set (src/.env) — refusing to start');
  process.exit(1);
}

const loginRouter = require('./routes/login');
const navRouter = require('./routes/nav');
const indexRouter = require('./routes/index');
const infoRouter = require('./routes/info');
const spotbotRouter = require('./routes/spotbot');

const session = require('express-session');
const FileStore = require('session-file-store')(session);

const app = express();

// Security headers (CSP, nosniff, X-Frame-Options, etc.). Tweaks for this
// project: inline scripts in ejs (navbar/spotbot) → 'unsafe-inline'; WebSocket →
// connect-src ws:/wss:; the app runs over HTTP on the local network →
// upgrade-insecure-requests is disabled, otherwise the browser forces https.
// In dev CSP is off: browser-sync (live-reload) loads socket.io from a separate
// port via http-polling, which strict CSP blocks. CSP is a prod feature.
const isDev = process.env.NODE_ENV === 'development';
app.use(
  helmet({
    contentSecurityPolicy: isDev
      ? false
      : {
          directives: {
            ...helmet.contentSecurityPolicy.getDefaultDirectives(),
            'script-src': ["'self'", "'unsafe-inline'"],
            'connect-src': ["'self'", 'ws:', 'wss:'],
            'upgrade-insecure-requests': null,
          },
        },
  })
);

// NOTE: dev live-reload (browser-sync) lives in bin/www, where it proxies the
// REAL server (the one with WebSocketRouter). Do NOT call app.listen() here —
// it used to spawn a second, WS-less HTTP server and caused port confusion.

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

app.set('trust proxy', 1); // for HTTPS secure: 'auto'

// Single session middleware instance, reused for both HTTP routes and the
// WebSocket upgrade handshake (authorize WS, not only HTTP routes).
const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  rolling: true, // extend the session on activity (inactivity timeout)
  // File store instead of MemoryStore: sessions survive a
  // container restart (no forced logout) and don't leak memory.
  // data/ is already in .gitignore and persisted via a bind-mount.
  store: new FileStore({
    path: path.join(__dirname, 'data/sessions'),
    ttl: 2 * 60 * 60, // seconds; aligned with cookie.maxAge
    retries: 1,
    logFn: () => {}, // file-store spams ENOENT on an empty store
  }),
  cookie: {
    secure: 'auto', // auto for HTTP/HTTPS
    httpOnly: true,
    sameSite: 'strict', // CSRF minimum: POSTs (cancel allorders) only from our own site
    maxAge: 2 * 60 * 60 * 1000,
  },
});
app.use(sessionMiddleware);
app.set('sessionMiddleware', sessionMiddleware); // bin/www reads it for WS upgrade

// @popovandrii/ui-elements
app.use(
  '/ui-elements/css',
  express.static(path.join(__dirname, 'node_modules/bootstrap/dist/css'))
);
app.use(
  '/ui-elements/js',
  express.static(path.join(__dirname, 'node_modules/@popovandrii/ui-elements/dist'))
);
// #@popovandrii/ui-elements

// HTTP request logging level via env HTTP_LOG: off | app | all  (default: app)
//   off — no request logs at all
//   app — log app routes but skip static assets (js/css/images) — hides the GET /javascripts flood
//   all — log everything, including static assets
const HTTP_LOG = (process.env.HTTP_LOG || 'app').toLowerCase();

if (HTTP_LOG !== 'off') {
  const QUIET_PATHS = ['/api/ping', '/api/logs', '/login'];
  const STATIC_EXT = /\.(?:js|mjs|css|map|svg|png|jpe?g|gif|ico|woff2?|ttf)$/i;

  app.use(
    logger('dev', {
      skip: (req) => {
        // always skip noisy polling / auth endpoints
        if (QUIET_PATHS.some((p) => req.originalUrl.startsWith(p))) return true;
        // in 'app' mode also skip static assets (the GET /javascripts flood)
        if (HTTP_LOG === 'app' && STATIC_EXT.test(req.path)) return true;
        return false;
      },
    })
  );
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/login', loginRouter.router);
app.use(loginRouter.ensureAuthenticated);

app.use('/api', navRouter);
app.use('/', indexRouter);
app.use('/info', infoRouter);
app.use('/spotbot', spotbotRouter);

// catch 404 and forward to error handler
app.use(function (req, res, next) {
  next(createError(404));
});

// error handler
app.use(function (err, req, res, next) {
  // set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};
  res.locals.retryable = Boolean(err.retryable);

  // render the error page
  res.status(err.status || 500);
  res.render('error', { title: 'Error' });
});

module.exports = app;
