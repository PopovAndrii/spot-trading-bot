const express = require('express');
const router = express.Router();

const { Spot } = require('@binance/connector');

let api_key = process.env.API_KEY;
let api_secret = process.env.API_SECRET;
let baseURL = 'https://api.binance.com/api';

if (!api_key || !api_secret) {
  throw new Error('Binance API keys are not set');
}

if (process.env.NODE_ENV === 'development') {
  api_key = process.env.API_KEY_TEST;
  api_secret = process.env.API_SECRET_TEST;
  baseURL = 'https://testnet.binance.vision/';
}

const client = new Spot(api_key, api_secret, { baseURL: baseURL });

router.get('/', function (req, res, next) {
  client
    .exchangeInfo({ symbols: ['BTCUSDT', 'BNBUSDT'] })
    .then((response) => {
      // Как только данные получены, рендерим страницу
      res.render('index', {
        title: 'Main Page',
        // user: req.session.user.name,
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
