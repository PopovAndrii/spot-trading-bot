const express = require('express');
const router = express.Router();

const Dotenv = require('dotenv');
Dotenv.config();

const { Spot } = require('@binance/connector');
const client = new Spot(process.env.API_KEY, process.env.API_SECRET);

/* GET home page. */
function exchangeInfo(data) {
  router.get('/', function(req, res, next) {
    res.render('index', { title: 'Express', info: data});
  });
}

client.exchangeInfo({ symbols:["BTCUSDT", "BNBUSDT"] }) // symbols:["BTCUSDT"]
    .then(response => exchangeInfo(response.data))
    // .then(response => client.logger.log(response.data))
    .catch(error => client.logger.error(error));

module.exports = router;
