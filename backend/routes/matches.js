const express = require('express');
const router = express.Router();
const { getFixturesByDate, formatDate } = require('../services/footballApi');

router.get('/', async (req, res, next) => {
  try {
    const { date, league } = req.query;
    let targetDate = date;
    if (targetDate && !/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
      return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD.' });
    }
    if (!targetDate) targetDate = formatDate(new Date());

    let fixtures = await getFixturesByDate(targetDate);
    if (league && league !== 'all') {
      fixtures = fixtures.filter(f => f.leagueKey === league);
    }
    res.json({ date: targetDate, total: fixtures.length, fixtures });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid fixture ID.' });
    const fixtures = await getFixturesByDate(formatDate(new Date()));
    const fixture = fixtures.find(f => f.id === id);
    if (!fixture) return res.status(404).json({ error: 'Fixture not found.' });
    res.json(fixture);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
