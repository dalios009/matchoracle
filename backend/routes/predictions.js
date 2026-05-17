const express = require('express');
const router = express.Router();
const { generatePrediction } = require('../services/predictionEngine');
const { getFixturesByDateFromOdds } = require('../services/oddsService');
const { formatDate } = require('../services/footballApi');
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

    // Find fixture with odds data already attached
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

    // Use odds data already in the fixture
    const oddsData = fixture?.oddsData || null;

    const fixtureObj = fixture || {
      id: fixtureId,
      home: { id: homeId, name: String(homeId) },
      away: { id: awayId, name: String(awayId) },
      leagueName: 'Football',
    };

    const prediction = generatePrediction(fixtureObj, null, null, null, oddsData);
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
