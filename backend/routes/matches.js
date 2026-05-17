const express = require('express');
const router = express.Router();
const axios = require('axios');
const { getFixturesByDate, formatDate } = require('../services/footballApi');
const { getFixturesByDateFromOdds } = require('../services/oddsService');

router.get('/test-api', async (req, res) => {
  try {
    const response = await axios.get('https://v3.football.api-sports.io/status', {
      headers: { 'x-apisports-key': process.env.FOOTBALL_API_KEY },
    });
    res.json(response.data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/', async (req, res, next) => {
  try {
    const { date, league } = req.query;
    const targetDate = date || formatDate(new Date());

    if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
      return res.status(400).json({ error: 'Invalid date. Use YYYY-MM-DD.' });
    }

    // Try Odds API first — no daily limit
    let fixtures = await getFixturesByDateFromOdds(targetDate);

    // Fall back to football API if odds API returns nothing
    if (fixtures.length === 0) {
      fixtures = await getFixturesByDate(targetDate);
    }

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
    let fixtures = await getFixturesByDateFromOdds(today);
    if (fixtures.length === 0) fixtures = await getFixturesByDate(today);
    const fixture = fixtures.find(f => String(f.id) === String(id));
    if (!fixture) return res.status(404).json({ error: 'Fixture not found.' });
    res.json(fixture);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
