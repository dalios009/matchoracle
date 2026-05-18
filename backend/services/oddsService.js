const axios = require('axios');
const NodeCache = require('node-cache');
const logger = require('../utils/logger');

const cache = new NodeCache({ stdTTL: 600 });
const ODDS_API_KEY = process.env.ODDS_API_KEY;
const BASE = 'https://api.the-odds-api.com/v4';

const SPORTS = [
  { key: 'soccer_epl',                name: 'Premier League',   flag: '🏴󠁧󠁢󠁥', leagueKey: 'pl' },
  { key: 'soccer_spain_la_liga',      name: 'La Liga',          flag: '🇪🇸', leagueKey: 'll' },
  { key: 'soccer_uefa_champs_league', name: 'Champions League', flag: '⭐', leagueKey: 'cl' },
  { key: 'soccer_germany_bundesliga', name: 'Bundesliga',       flag: '🇩🇪', leagueKey: 'bl' },
  { key: 'soccer_italy_serie_a',      name: 'Serie A',          flag: '🇮', leagueKey: 'sa' },
  { key: 'soccer_france_ligue_one',   name: 'Ligue 1',          flag: '🇫🇷', leagueKey: 'l1' },
];

function oddsToProb(decimal) {
  if (!decimal || decimal <= 1) return 0;
  return 1 / decimal;
}

function processMatch(match, sport) {
  const bm = match.bookmakers?.[0];
  if (!bm) return null;

  const h2h = bm.markets?.find(m => m.key === 'h2h');
  const totals = bm.markets?.find(m => m.key === 'totals');
  const bttsMarket = bm.markets?.find(m => m.key === 'btts');

  if (!h2h) return null;

  const homeOdds = h2h.outcomes?.find(o => o.name === match.home_team)?.price;
  const awayOdds = h2h.outcomes?.find(o => o.name === match.away_team)?.price;
  const drawOdds = h2h.outcomes?.find(o => o.name === 'Draw')?.price;

  if (!homeOdds || !awayOdds || !drawOdds) return null;

  // Remove bookmaker margin (overround)
  const rawH = oddsToProb(homeOdds);
  const rawD = oddsToProb(drawOdds);
  const rawA = oddsToProb(awayOdds);
  const total = rawH + rawD + rawA;

  const homeProb = Math.round((rawH / total) * 100);
  const drawProb = Math.round((rawD / total) * 100);
  const awayProb = 100 - homeProb - drawProb;

  // Over/Under 2.5
  const over25odds = totals?.outcomes?.find(
    o => o.name === 'Over' && parseFloat(o.point) === 2.5
  )?.price;
  const under25odds = totals?.outcomes?.find(
    o => o.name === 'Under' && parseFloat(o.point) === 2.5
  )?.price;
  let over25Prob = null;
  if (over25odds && under25odds) {
    const rO = oddsToProb(over25odds);
    const rU = oddsToProb(under25odds);
    over25Prob = Math.round((rO / (rO + rU)) * 100);
  }

  // BTTS
  const bttsYesOdds = bttsMarket?.outcomes?.find(o => o.name === 'Yes')?.price;
  const bttsNoOdds = bttsMarket?.outcomes?.find(o => o.name === 'No')?.price;
  let bttsProb = null;
  if (bttsYesOdds && bttsNoOdds) {
    const rY = oddsToProb(bttsYesOdds);
    const rN = oddsToProb(bttsNoOdds);
    bttsProb = Math.round((rY / (rY + rN)) * 100);
  }

  // xG estimate from win probability
  const homeXG = homeProb >= 65 ? 2.0
    : homeProb >= 52 ? 1.6
    : homeProb >= 42 ? 1.3
    : homeProb >= 32 ? 1.0
    : 0.8;
  const awayXG = awayProb >= 60 ? 1.8
    : awayProb >= 48 ? 1.4
    : awayProb >= 38 ? 1.1
    : awayProb >= 28 ? 0.8
    : 0.6;

  const commenceTime = new Date(match.commence_time);

  return {
    id: match.id,
    leagueKey: sport.leagueKey,
    leagueName: sport.name,
    leagueFlag: sport.flag,
    date: match.commence_time,
    time: commenceTime.toLocaleTimeString('en-GB', {
      hour: '2-digit', minute: '2-digit', timeZone: 'UTC',
    }),
    status: 'NS',
    elapsed: null,
    home: { id: match.id + '_h', name: match.home_team, logo: null },
    away: { id: match.id + '_a', name: match.away_team, logo: null },
    goals: { home: null, away: null },
    oddsData: {
      bookmaker: bm.title,
      odds: { home: homeOdds, draw: drawOdds, away: awayOdds },
      probabilities: { home: homeProb, draw: drawProb, away: awayProb },
      markets: {
        over25: over25Prob,
        under25: over25Prob ? 100 - over25Prob : null,
        over15: over25Prob ? Math.min(90, over25Prob + 18) : null,
        bttsYes: bttsProb,
        bttsNo: bttsProb ? 100 - bttsProb : null,
      },
      xG: { home: homeXG, away: awayXG },
    },
  };
}

async function fetchSportOdds(sport, dateStr) {
  const cKey = `odds:${sport.key}`;
  const cached = cache.get(cKey);
  
  let data = cached;
  
  if (!data) {
    try {
      const response = await axios.get(`${BASE}/sports/${sport.key}/odds`, {
        params: {
          apiKey: ODDS_API_KEY,
          regions: 'eu',
          markets: 'h2h',
          oddsFormat: 'decimal',
          dateFormat: 'iso',
        },
        timeout: 10000,
      });
      data = response.data || [];
      if (data.length > 0) cache.set(cKey, data, 600);
      logger.info(`${sport.name}: fetched ${data.length} raw matches`);
    } catch (err) {
      const errMsg = err.response?.data 
        ? JSON.stringify(err.response.data) 
        : err.message;
      logger.error(`Odds API failed for ${sport.key}: ${errMsg}`);
      return [];
    }
  }

  // Filter by date
  const fixtures = data
    .filter(m => {
      const mDate = new Date(m.commence_time).toISOString().split('T')[0];
      return mDate === dateStr;
    })
    .map(m => processMatch(m, sport))
    .filter(Boolean);

  return fixtures;
}
  } catch (err) {
    logger.error(`Odds API failed for ${sport.key}:`, err.response?.data || err.message);
    return [];
  }
}

async function getFixturesByDateFromOdds(dateStr) {
  const results = await Promise.allSettled(
    SPORTS.map(sport => fetchSportOdds(sport, dateStr))
  );

  const fixtures = results
    .filter(r => r.status === 'fulfilled')
    .flatMap(r => r.value)
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  logger.info(`Total fixtures for ${dateStr}: ${fixtures.length}`);
  return fixtures;
}

async function findOddsForFixture(homeName, awayName) {
  const today = new Date().toISOString().split('T')[0];
  const fixtures = await getFixturesByDateFromOdds(today);

  const norm = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const hN = norm(homeName);
  const aN = norm(awayName);

  const match = fixtures.find(f =>
    (norm(f.home.name).includes(hN) || hN.includes(norm(f.home.name))) &&
    (norm(f.away.name).includes(aN) || aN.includes(norm(f.away.name)))
  );

  return match?.oddsData || null;
}

module.exports = { getFixturesByDateFromOdds, findOddsForFixture };
