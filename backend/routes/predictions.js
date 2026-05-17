const express = require('express');
const router = express.Router();
const { generatePrediction } = require('../services/predictionEngine');
const { getFixturesByDate, formatDate } = require('../services/footballApi');
const { findOddsForFixture } = require('../services/oddsService');
const NodeCache = require('node-cache');

const predCache = new NodeCache({ stdTTL: 3600 });

router.post('/', async (req, res, next) => {
  try {
    const { fixtureId, homeId, awayId } = req.body;
    if (!fixtureId || !homeId || !awayId) {
      return res.status(400).json({ error: 'fixtureId, homeId, and awayId are required.' });
    }

    const cKey = `pred:${fixtureId}`;
    const cached = predCache.get(cKey);
    if (cached) return res.json(cached);

    // Find fixture
    const today = formatDate(new Date());
    const yesterday = formatDate(new Date(Date.now() - 86400000));
    const tomorrow = formatDate(new Date(Date.now() + 86400000));
    const [t, y, tm] = await Promise.all([
      getFixturesByDate(today),
      getFixturesByDate(yesterday),
      getFixturesByDate(tomorrow),
    ]);
    const fixture = [...t, ...y, ...tm].find(f => f.id === fixtureId) || {
      id: fixtureId,
      home: { name: 'Home', id: homeId },
      away: { name: 'Away', id: awayId },
      leagueName: 'Football',
    };

    // Try to get real bookmaker odds
    const oddsData = await findOddsForFixture(
      fixture.home.name,
      fixture.away.name
    );

    // Generate prediction — use real odds if available
    const prediction = generatePrediction(fixture, null, null, null, oddsData);
    predCache.set(cKey, prediction);
    res.json(prediction);
  } catch (err) {
    next(err);
  }
});

router.get('/batch', async (req, res, next) => {
  try {
    const date = req.query.date || formatDate(new Date());
    const league = req.query.league;

    let fixtures = await getFixturesByDate(date);
    if (league && league !== 'all') {
      fixtures = fixtures.filter(f => f.leagueKey === league);
    }

    const predictions = {};
    for (const fixture of fixtures) {
      const cKey = `pred:${fixture.id}`;
      const cached = predCache.get(cKey);
      if (cached) {
        predictions[fixture.id] = cached;
        continue;
      }

      const oddsData = await findOddsForFixture(
        fixture.home.name,
        fixture.away.name
      );

      const prediction = generatePrediction(fixture, null, null, null, oddsData);
      predCache.set(cKey, prediction);
      predictions[fixture.id] = prediction;
    }

    res.json({ date, count: Object.keys(predictions).length, predictions });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
