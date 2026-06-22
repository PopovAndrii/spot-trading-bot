const express = require('express');
const router = express.Router();

const { InvokeApi } = require('../lib/invokeAPI');
const { getPublicIp } = require('../lib/serverIp');
const { getKeysInfo, checkKeys } = require('../lib/checkKeys');
const { DONATIONS } = require('../lib/donations');

const apiMethod = InvokeApi.getInstance();

router.get('/', async function (req, res, next) {
  const [result, serverIp] = await Promise.all([
    apiMethod.getSpotSymbols(),
    getPublicIp(),
  ]);
  res.render('index', {
    title: 'Main Page',
    info: result.success ? result.message : { symbols: [] },
    serverIp,
    keys: getKeysInfo(),
    donations: DONATIONS,
  });
});

// Проверка пары ключей (real | test) подписанным запросом к Binance
router.post('/check-keys', async function (req, res, next) {
  const env = req.body?.env;
  if (env !== 'real' && env !== 'test') {
    return res.status(400).json({ success: false, message: 'env must be "real" or "test"' });
  }
  const result = await checkKeys(env);
  res.json(result);
});

module.exports = router;
