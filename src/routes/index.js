const express = require('express');
const router = express.Router();

const { Spot } = require('@binance/connector');
const client = new Spot(process.env.API_KEY, process.env.API_SECRET);

const { ensureAuthenticated } = require('./login');
router.use(ensureAuthenticated);

router.get('/', function (req, res, next) {
  client
    .exchangeInfo({ symbols: ['BTCUSDT', 'BNBUSDT'] })
    .then((response) => {
      // Как только данные получены, рендерим страницу
      res.render('index', {
        title: 'Main Page',
        user: req.session.user.name,
        info: response.data, // Передаем свежие данные
      });
    })
    .catch((error) => {
      // Обработка ошибки, если Binance API недоступен
      console.error(error);
      res.status(500).render('error', { message: 'Ошибка получения данных Binance API' });
    });
});

module.exports = router;
