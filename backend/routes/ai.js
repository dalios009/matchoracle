const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const NodeCache = require('node-cache');
const { analyseMatch, askScout } = require('../services/aiService');
const { getFixturesByDateFromOdds } = require('../services/oddsService');

const aiLimiter = rateLimit({
  windowMs: 60000,
  max: 10,
  message: { error: 'AI rate limit reached. Please wait a moment.' },
});

const aiCache = new NodeCache({ stdTTL: 1800 });

function formatDate(date) {
  return new Date(date).toISOString().split('T')[0];
}

async function findFixtureById(fixtureId) {
  const today = formatDate(new Date());
  const yesterday = formatDate(new Date(Date.now() - 86400000));
  const tomorrow = formatDate(new Date(Date.now() + 86400000));

  // Check today first (cheap — covers the vast majority of requests)
  let fixtures = await getFixturesByDateFromOdds(today);
  let fixture = fixtures.find(f => String(f.id) === String(fixtureId));
  if (fixture) return fixture;

  // Fall back to yesterday/tomorrow for timezone edge cases
  const [y, t] = await Promise.all([
    getFixturesByDateFromOdds(yesterday),
    getFixturesByDateFromOdds(tomorrow),
  ]);
  fixtures = [...fixtures, ...y, ...t];
  return fixtures.find(f => String(f.id) === String(fixtureId)) || null;
}

router.post('/analyse', aiLimiter, async (req, res, next) => {
  try {
    const { fixtureId } = req.body;
    if (!fixtureId) return res.status(400).json({ error: 'fixtureId is required.' });

    const cKey = `ai:analysis:${fixtureId}`;
    const cached = aiCache.get(cKey);
    if (cached) return res.json(cached);

    const fixture = await findFixtureById(fixtureId);
    if (!fixture || !fixture.oddsData) {
      return res.status(404).json({ error: 'Fixture or odds not found.' });
    }

    const od = fixture.oddsData;
    // Build a "prediction" object shaped the way analyseMatch expects —
    // sourced entirely from oddsService output (the same data the
    // /predictions endpoint and frontend already use), so AI Scout's
    // analysis always matches what the user sees in the match card.
    const prediction = {
      fixtureId: fixture.id,
      score: od.score,
      xG: od.xG,
      probabilities: od.probabilities,
      confidence: od.confidence,
      bestBets: od.bestBets || [],
      valueBets: od.valueBets || [],
      topScores: od.topScores || [],
    };

    const result = await analyseMatch(
      fixture,
      prediction,
      null, // form data not available from oddsService — AI works off market + Poisson + team ratings instead
      null,
      null,
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

    const fixtures = await getFixturesByDateFromOdds(formatDate(new Date()));
    const answer = await askScout(question, fixtures.slice(0, 12));
    res.json({ answer, generatedAt: new Date().toISOString() });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
