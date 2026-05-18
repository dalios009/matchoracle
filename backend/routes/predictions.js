const express = require('express');
const router = express.Router();
const { generatePrediction } = require('../services/predictionEngine');
const { getFixturesByDateFromOdds } = require('../services/oddsService');
const NodeCache = require('node-cache');

const predCache = new NodeCache({ stdTTL: 3600 });

function formatDate(date) {
  return new Date(date).toISOString().split('T')[0];
}

router.post('/', async (req, res, next) => {
  try {
    const { fixtureId, homeId, awayId } = req.body;
    if (!fixtureId) {
      return res.status(400).json({ error: 'fixtureId is required.' });
    }

    const cKey = `pred:${fixtureId}`;
    const cached = predCache.get(cKey);
    if (cached) return res.json(cached);

    // Search today + tomorrow + yesterday
    const today = formatDate(new Date());
    const tomorrow = formatDate(new Date(Date.now() + 86400000));
    const yesterday = formatDate(new Date(Date.now() - 86400000));

    const [t, tm, y] = await Promise.all([
      getFixturesByDateFromOdds(today),
      getFixturesByDateFromOdds(tomorrow),
      getFixturesByDateFromOdds(yesterday),
    ]);

    const allFixtures = [...t, ...tm, ...y];
    const fixture = allFixtures.find(f => String(f.id) === String(fixtureId));

    if (!fixture) {
      return res.status(404).json({ error: 'Fixture not found in odds data.' });
    }

    // Odds data is already attached to the fixture
    const prediction = generatePrediction(fixture, null, null, null, fixture.oddsData);
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

    let fixtures = await getFixturesByDateFromOdds(date);
    if (league && league !== 'all') {
      fixtures = fixtures.filter(f => f.leagueKey === league);
    }

    const predictions = {};
    for (const fixture of fixtures) {
      const cKey = `pred:${fixture.id}`;
      const cached = predCache.get(cKey);
      if (cached) { predictions[fixture.id] = cached; continue; }

      const prediction = generatePrediction(
        fixture, null, null, null, fixture.oddsData || null
      );
      predCache.set(cKey, prediction);
      predictions[fixture.id] = prediction;
    }

    res.json({ date, count: Object.keys(predictions).length, predictions });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
