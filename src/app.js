const createError = require('http-errors');
const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const logger = require('morgan');

const Dotenv = require('dotenv');
Dotenv.config();

const loginRouter = require('./routes/login');
const navRouter = require('./routes/nav');
const indexRouter = require('./routes/index');
const infoRouter = require('./routes/info');
const spotbotRouter = require('./routes/spotbot');

const session = require('express-session');

const app = express();

if (process.env.NODE_ENV === 'development') {
  const browserSync = require('browser-sync').create();
  app.listen(3000, () => {
    browserSync.init({
      proxy: 'http://localhost:3000',
      files: ['routes/*.js', 'views/*.ejs', 'public/**/*'],
      open: false,
      notify: false,
    });
  });
}
// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

app.set('trust proxy', 1); // for HTTPS secure: 'auto'
app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    rolling: true, // продлевать сессию по активности (инактивити-таймаут)
    cookie: {
      secure: 'auto', // auto for HTTP/HTTPS
      httpOnly: true,
      maxAge: 2 * 60 * 60 * 1000,
    },
  })
);

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

app.use(
  logger('dev', {
    skip: (req) => {
      return [
        '/api/ping',
        '/login',
        '/spotbot'
      ].some(path => req.originalUrl.startsWith(path));
    }
  })
);

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
