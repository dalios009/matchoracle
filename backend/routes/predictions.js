const express = require('express');
const router = express.Router();
const NodeCache = require('node-cache');
const { getTeamForm, getH2H, getFixturesByDate, formatDate } = require('../services/footballApi');
const { generatePrediction } = require('../services/predictionEngine');

const predCache = new NodeCache({ stdTTL: 600 });

router.post('/', async (req, res, next) => {
  try {
    const { fixtureId, homeId, awayId } = req.body;
    if (!fixtureId || !homeId || !awayId) {
      return res.status(400).json({ error: 'fixtureId, homeId, and awayId are required.' });
    }

    const cKey = `pred:${fixtureId}`;
    const cached = predCache.get(cKey);
    if (cached) return res.json(cached);

    const [homeForm, awayForm, h2h] = await Promise.allSettled([
      getTeamForm(homeId, 5),
      getTeamForm(awayId, 5),
      getH2H(homeId, awayId, 5),
    ]);

    const fixtures = await getFixturesByDate(formatDate(new Date()));
    const fixture = fixtures.find(f => f.id === fixtureId);
    if (!fixture) return res.status(404).json({ error: 'Fixture not found.' });

    const prediction = generatePrediction(
      fixture,
      homeForm.status === 'fulfilled' ? homeForm.value : null,
      awayForm.status === 'fulfilled' ? awayForm.value : null,
      h2h.status === 'fulfilled' ? h2h.value : null,
    );

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
    if (league && league !== 'all') fixtures = fixtures.filter(f => f.leagueKey === league);
    fixtures = fixtures.slice(0, 20);

    const results = await Promise.allSettled(
      fixtures.map(async (fixture) => {
        const cKey = `pred:${fixture.id}`;
        const cached = predCache.get(cKey);
        if (cached) return cached;

        const [homeForm, awayForm, h2h] = await Promise.allSettled([
          getTeamForm(fixture.home.id, 5),
          getTeamForm(fixture.away.id, 5),
          getH2H(fixture.home.id, fixture.away.id, 5),
        ]);

        const prediction = generatePrediction(
          fixture,
          homeForm.value || null,
          awayForm.value || null,
          h2h.value || null,
        );
        predCache.set(cKey, prediction);
        return prediction;
      })
    );

    const predictions = {};
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') predictions[fixtures[i].id] = r.value;
    });

    res.json({ date, count: Object.keys(predictions).length, predictions });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
