const express = require('express');
const router = express.Router();

const { InvokeApi } = require('../lib/invokeAPI');

const apiMethod = new InvokeApi();

router.get('/', async function (req, res, next) {
  const result = await apiMethod.getSpotSymbols();
  res.render('index', {
    title: 'Main Page',
    info: result.success ? result.message : { symbols: [] },
  });
});

module.exports = router;
