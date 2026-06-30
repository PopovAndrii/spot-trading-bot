const express = require('express');
const router = express.Router();
const { InvokeApi } = require('../lib/invokeAPI');

const apiMethod = InvokeApi.getInstance();

router.get('/', async function (req, res, next) {
  res.render('info', {
    title: 'Acount Information: You Balances ',
  });
});

router.post('/account-info', async function (req, res, next) {
  const result = await apiMethod.getAccount();

  if (!result.success) {
    return res.status(500).json(result);
  }

  res.json(result);
});
module.exports = router;
