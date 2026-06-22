const express = require('express');
const router = express.Router();
const { getFixturesByDateFromOdds, getAllUpcomingMatches } = require('../services/oddsService');

function formatDate(date) {
  return new Date(date).toISOString().split('T')[0];
}

router.get('/', async (req, res, next) => {
  try {
    const { date, league } = req.query;
    const targetDate = date || formatDate(new Date());

    if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
      return res.status(400).json({ error: 'Invalid date. Use YYYY-MM-DD.' });
    }

    let fixtures = await getFixturesByDateFromOdds(targetDate);

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
    const id = req.params.id;
    const today = formatDate(new Date());
    const fixtures = await getFixturesByDateFromOdds(today);
    const fixture = fixtures.find(f => String(f.id) === String(id));
    if (!fixture) return res.status(404).json({ error: 'Fixture not found.' });
    res.json(fixture);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
