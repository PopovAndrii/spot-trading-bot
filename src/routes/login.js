const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const rateLimit = require('express-rate-limit');

const loginLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 min
  max: 4,
  standardHeaders: true,
  legacyHeaders: false,
});

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
// const hash = bcrypt.hashSync('admin', 10);
// console.log(hash);

function ensureAuthenticated(req, res, next) {
  if (req.session && req.session.user) {
    return next();
  } else {
    res.redirect('/login');
  }
}

router.get('/', (req, res) => {
  res.render('login', {
    title: 'Login Page',
  });
});

router.get('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error(err);
    }
    res.redirect('/login');
  });
});

router.post('/', loginLimiter, async (req, res) => {
  const { username, password } = req.body;

  const USER_LOGIN = process.env.ADMIN_LOGIN;
  if (username !== USER_LOGIN) {
    await delay(3000);
    return res.redirect('/login');
    // return res.status(401).send('Invalid credentials');
  }
  const USER_PASS_HASH = process.env.ADMIN_PASSWORD_HASH;
  const match = await bcrypt.compare(password, USER_PASS_HASH);

  if (!match) {
    await delay(3000);
    return res.redirect('/login');
    // return res.status(401).send('Invalid credentials');
  }

  req.session.user = { name: username };
  res.redirect('/');
});

module.exports = {
  router: router,
  ensureAuthenticated: ensureAuthenticated,
};
