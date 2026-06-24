const express = require('express');
const router = express.Router();
const { getFixturesByDateFromOdds, getAllUpcomingMatches, getMatchResult, settleBetPick } = require('../services/oddsService');

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

// Settle one or more logged bets against real final scores. The frontend's
// bet tracker calls this with the bets it has stored in localStorage (it
// has no server-side bet storage — settlement just needs scores back).
//
// Request body: { bets: [{ id, match: "Home vs Away", market, value }] }
// Response: { results: [{ id, status: 'won'|'lost'|'pending'|'unknown' }] }
router.post('/settle', async (req, res, next) => {
  try {
    const { bets } = req.body;
    if (!Array.isArray(bets) || bets.length === 0) {
      return res.status(400).json({ error: 'bets array is required.' });
    }
    if (bets.length > 50) {
      return res.status(400).json({ error: 'Max 50 bets per settle request.' });
    }

    const results = await Promise.all(bets.map(async (bet) => {
      const parts = (bet.match || '').split(' vs ');
      if (parts.length !== 2) return { id: bet.id, status: 'unknown' };
      const [homeTeam, awayTeam] = parts.map(s => s.trim());

      const result = await getMatchResult(homeTeam, awayTeam);
      if (!result) return { id: bet.id, status: 'pending' }; // not found yet — too far out or untracked league
      if (!result.completed) return { id: bet.id, status: 'pending' };
      if (result.homeScore == null || result.awayScore == null) return { id: bet.id, status: 'pending' };

      const won = settleBetPick(bet.market, bet.value, homeTeam, awayTeam, result.homeScore, result.awayScore);
      if (won === null) return { id: bet.id, status: 'pending' }; // couldn't determine — don't guess
      return {
        id: bet.id,
        status: won ? 'won' : 'lost',
        finalScore: `${result.homeScore}-${result.awayScore}`,
      };
    }));

    res.json({ results });
  } catch (err) {
    next(err);
  }
});

module.exports = router;