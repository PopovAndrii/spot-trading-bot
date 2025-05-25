const express = require('express');
const router = express.Router();
const { Spot } = require('@binance/connector');

const client = new Spot(process.env.API_KEY, process.env.API_SECRET);

function info(data){
  router.get('/', function(req, res, next) {
    res.render('info', { 
      title: 'Acount Information ', 
      info: data, });
  });
}

client.account({ omitZeroBalances: true })
  .then(response => info(response.data))
  .catch(error => client.logger.error(error));

module.exports = router;
