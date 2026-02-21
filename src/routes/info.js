const express = require('express');
const router = express.Router();
const { InvokeApi } = require('../lib/invokeAPI');

const apiMethod = new InvokeApi();

router.get('/', async function (req, res, next) {
  res.render('info', {
    title: 'Acount Information ',
  });
});

router.post('/account-info', async function (req, res, next) {
  // res.render('info', { title: 'Express' });
  try {
    const data = await apiMethod.getAccount();

    res.json({ message: data });
  } catch (err) {
    console.error('Error saving file:', err);
    res.status(500).json({ message: 'Error saving file' });
  }
});
module.exports = router;
