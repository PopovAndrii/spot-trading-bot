const express = require('express');
const router = express.Router();
const { InvokeApi } = require('../lib/invokeAPI');

const apiMethod = new InvokeApi();

router.get('/', async function (req, res, next) {
  res.render('info', {
    title: 'Acount Information: You Balances ',
  });
});

router.post('/account-info', async function (req, res, next) {
  try {
    const data = await apiMethod.getAccount();

    if (!data) {
      const err = apiMethod.getError('getAccount');
      return res.status(500).json({ success: false, message: err?.message || 'Failed to fetch account' });
    }

    res.json({ success: true, message: data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});
module.exports = router;
