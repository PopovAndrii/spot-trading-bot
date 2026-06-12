const createError = require('http-errors');
const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const logger = require('morgan');
const helmet = require('helmet');

const Dotenv = require('dotenv');
Dotenv.config();

// Fail-fast (ANALYSIS п.11): без секрета express-session бросит на первом же
// запросе невнятный stack — лучше упасть сразу с понятным сообщением.
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

// Безопасные заголовки (CSP, nosniff, X-Frame-Options и т.д.). Поправки под
// этот проект: inline-скрипты в ejs (navbar/spotbot) → 'unsafe-inline';
// WebSocket → connect-src ws:/wss:; приложение ходит по HTTP в локальной
// сети → upgrade-insecure-requests выключен, иначе браузер форсирует https.
// В dev CSP выключен: browser-sync (live-reload) грузит socket.io с отдельного
// порта по http-polling, strict CSP это блокирует. CSP — фича прода.
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
// it used to spawn a second, WS-less HTTP server and caused port confusion (req 23).

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

app.set('trust proxy', 1); // for HTTPS secure: 'auto'

// Single session middleware instance, reused for both HTTP routes and the
// WebSocket upgrade handshake (req 24 — authorize WS, not only HTTP routes).
const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  rolling: true, // продлевать сессию по активности (инактивити-таймаут)
  // Файловый стор вместо MemoryStore (ANALYSIS п.11): сессии переживают
  // рестарт контейнера (не разлогинивает) и не текут по памяти.
  // data/ уже в .gitignore и персистится bind-mount'ом.
  store: new FileStore({
    path: path.join(__dirname, 'data/sessions'),
    ttl: 2 * 60 * 60, // секунды; согласован с cookie.maxAge
    retries: 1,
    logFn: () => {}, // file-store шумит ENOENT'ами на пустом сторе
  }),
  cookie: {
    secure: 'auto', // auto for HTTP/HTTPS
    httpOnly: true,
    sameSite: 'strict', // CSRF-минимум: POST-ы (cancel allorders) только со своего сайта
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

  // render the error page
  res.status(err.status || 500);
  res.render('error');
});

module.exports = app;
