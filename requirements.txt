const express = require('express');
const router = express.Router();
const { getFixturesByDateFromOdds } = require('../services/oddsService');
const NodeCache = require('node-cache');

const predCache = new NodeCache({ stdTTL: 3600 });

function formatDate(date) {
  return new Date(date).toISOString().split('T')[0];
}

router.post('/', async (req, res, next) => {
  try {
    const { fixtureId } = req.body;
    if (!fixtureId) return res.status(400).json({ error: 'fixtureId is required.' });

    const cKey = 'pred:' + fixtureId;
    const cached = predCache.get(cKey);
    if (cached) return res.json(cached);

    const today = formatDate(new Date());
    const tomorrow = formatDate(new Date(Date.now() + 86400000));
    const yesterday = formatDate(new Date(Date.now() - 86400000));

    const [t, tm, y] = await Promise.all([
      getFixturesByDateFromOdds(today),
      getFixturesByDateFromOdds(tomorrow),
      getFixturesByDateFromOdds(yesterday),
    ]);

    const fixture = [...t, ...tm, ...y].find(f => String(f.id) === String(fixtureId));
    if (!fixture || !fixture.oddsData) {
      return res.status(404).json({ error: 'Fixture or odds not found.' });
    }

    const od = fixture.oddsData;
    const prediction = {
      fixtureId: fixture.id,
      score: od.score || '1-1',
      xG: od.xG || { home: 1.2, away: 0.9 },
      probabilities: od.probabilities,
      confidence: od.confidence || 60,
      bestBets: od.bestBets || [],
      valueBets: od.valueBets || [],
      topScores: od.topScores || [],
      markets: [
        { id: 'result', label: 'Match Result', options: [
          { value: fixture.home.name+' Win', prob: od.probabilities.home, tier: od.probabilities.home>=55?'high':'med' },
          { value: 'Draw', prob: od.probabilities.draw, tier: 'med' },
          { value: fixture.away.name+' Win', prob: od.probabilities.away, tier: od.probabilities.away>=50?'high':'med' },
        ]},
        { id: 'goals', label: 'Total Goals', options: [
          { value: 'Over 2.5', prob: od.markets.over25||50, tier: (od.markets.over25||50)>=60?'high':'med' },
          { value: 'Under 2.5', prob: od.markets.under25||50, tier: (od.markets.under25||50)>=55?'med':'low' },
          { value: 'Over 1.5', prob: od.markets.over15||68, tier: 'med' },
        ]},
        { id: 'btts', label: 'Both Teams Score', options: [
          { value: 'Yes (BTTS)', prob: od.markets.bttsYes||50, tier: (od.markets.bttsYes||50)>=60?'high':'med' },
          { value: 'No', prob: od.markets.bttsNo||50, tier: 'med' },
        ]},
        { id: 'dc', label: 'Double Chance', options: [
          { value: fixture.home.name+' or Draw', prob: Math.min(92,od.probabilities.home+od.probabilities.draw), tier: 'high' },
          { value: fixture.away.name+' or Draw', prob: Math.min(92,od.probabilities.away+od.probabilities.draw), tier: 'med' },
        ]},
      ],
      insights: [
        { icon: '📊', text: fixture.home.name+' win probability: '+od.probabilities.home+'% | Draw: '+od.probabilities.draw+'% | '+fixture.away.name+': '+od.probabilities.away+'%' },
        { icon: '⚽', text: 'Expected goals: '+fixture.home.name+' '+od.xG.home+' xG — '+fixture.away.name+' '+od.xG.away+' xG' },
        { icon: '🎯', text: 'Top predicted scores: '+(od.topScores||[]).slice(0,3).map(function(s){return s.score+' ('+s.prob+'%)';}).join(' | ') },
        { icon: '💎', text: od.valueBets&&od.valueBets.length ? 'Value bet: '+od.valueBets[0] : 'BTTS Yes at '+od.markets.bttsYes+'% — Over 2.5 at '+od.markets.over25+'%' },
      ],
      bookmaker: od.bookmaker,
      bookmakerOdds: od.odds,
      generatedAt: new Date().toISOString(),
    };

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
    if (league && league !== 'all') fixtures = fixtures.filter(f => f.leagueKey === league);

    const predictions = {};
    for (const fixture of fixtures) {
      if (!fixture.oddsData) continue;
      const cKey = 'pred:' + fixture.id;
      const cached = predCache.get(cKey);
      if (cached) { predictions[fixture.id] = cached; continue; }
      const od = fixture.oddsData;
      predictions[fixture.id] = {
        fixtureId: fixture.id,
        score: od.score || '1-1',
        xG: od.xG,
        probabilities: od.probabilities,
        confidence: od.confidence || 60,
        bestBets: od.bestBets || [],
        generatedAt: new Date().toISOString(),
      };
      predCache.set(cKey, predictions[fixture.id]);
    }
    res.json({ date, count: Object.keys(predictions).length, predictions });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
