const express = require('express');
const router = express.Router();

const { InvokeApi } = require('../lib/invokeAPI');
const { getPublicIp } = require('../lib/serverIp');

const apiMethod = new InvokeApi();

router.get('/', async function (req, res, next) {
  const [result, serverIp] = await Promise.all([
    apiMethod.getSpotSymbols(),
    getPublicIp(),
  ]);
  res.render('index', {
    title: 'Main Page',
    info: result.success ? result.message : { symbols: [] },
    serverIp,
  });
});

module.exports = router;
