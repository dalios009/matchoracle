const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const NodeCache = require('node-cache');
const { analyseMatch, askScout } = require('../services/aiService');
const { getTeamForm, getH2H, getFixturesByDate, formatDate } = require('../services/footballApi');
const { generatePrediction } = require('../services/predictionEngine');

const aiLimiter = rateLimit({
  windowMs: 60000,
  max: 10,
  message: { error: 'AI rate limit reached. Please wait a moment.' },
});

const aiCache = new NodeCache({ stdTTL: 1800 });

router.post('/analyse', aiLimiter, async (req, res, next) => {
  try {
    const { fixtureId } = req.body;
    if (!fixtureId) return res.status(400).json({ error: 'fixtureId is required.' });

    const cKey = `ai:analysis:${fixtureId}`;
    const cached = aiCache.get(cKey);
    if (cached) return res.json(cached);

    const fixtures = await getFixturesByDate(formatDate(new Date()));
    const fixture = fixtures.find(f => f.id === parseInt(fixtureId));
    if (!fixture) return res.status(404).json({ error: 'Fixture not found.' });

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

    const result = await analyseMatch(
      fixture,
      prediction,
      homeForm.value || null,
      awayForm.value || null,
      h2h.value || null,
    );

    aiCache.set(cKey, result);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/scout', aiLimiter, async (req, res, next) => {
  try {
    const { question } = req.body;
    if (!question || typeof question !== 'string') {
      return res.status(400).json({ error: 'question is required.' });
    }
    if (question.length > 500) {
      return res.status(400).json({ error: 'Question too long (max 500 chars).' });
    }

    const fixtures = await getFixturesByDate(formatDate(new Date()));
    const answer = await askScout(question, fixtures.slice(0, 12));
    res.json({ answer, generatedAt: new Date().toISOString() });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
