const express = require('express');
const router = express.Router();

const { pair } = require('../lib/pair');

const { ensureAuthenticated } = require('./login');
router.use(ensureAuthenticated);

router.get('/symbols', (req, res) => {
  try {
    const symbols = pair.getActiveSymbols();
    res.json(symbols);
  } catch (err) {
    res.status(500).json({ error: 'Failed to get active symbols' });
  }
});

module.exports = router;
