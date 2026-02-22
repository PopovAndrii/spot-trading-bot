const express = require('express');
const router = express.Router();

const { Spot } = require('@binance/connector');

let api_key = process.env.API_KEY;
let api_secret = process.env.API_SECRET;
let baseURL = 'https://api.binance.com';

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
      res.render('index', {
        title: 'Main Page',
        // user: req.session.user.name,
        info: response.data,
      });
    })
    .catch((error) => {
      console.error('BINANCE ERROR:', error.message, error.response?.data);
      res.status(500).render('error', { message: 'Error get data Binance API' });
    });
});

module.exports = router;
