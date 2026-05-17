const axios = require('axios');
const NodeCache = require('node-cache');
const logger = require('../utils/logger');

const cache = new NodeCache({ stdTTL: 600 });

const ODDS_API_KEY = process.env.ODDS_API_KEY;
const BASE = 'https://api.the-odds-api.com/v4';

const SPORT_KEYS = [
  'soccer_epl',
  'soccer_spain_la_liga',
  'soccer_uefa_champs_league',
  'soccer_germany_bundesliga',
  'soccer_italy_serie_a',
  'soccer_france_ligue_one',
];

async function getOddsForSport(sportKey) {
  const cKey = `odds:${sportKey}`;
  const cached = cache.get(cKey);
  if (cached) return cached;

  try {
    const { data } = await axios.get(`${BASE}/sports/${sportKey}/odds`, {
      params: {
        apiKey: ODDS_API_KEY,
        regions: 'eu',
        markets: 'h2h,totals,btts',
        oddsFormat: 'decimal',
        dateFormat: 'iso',
      },
    });
    cache.set(cKey, data);
    return data;
  } catch (err) {
    logger.error(`getOddsForSport failed for ${sportKey}:`, err.message);
    return [];
  }
}

async function getAllOdds() {
  const cKey = 'odds:all';
  const cached = cache.get(cKey);
  if (cached) return cached;

  const results = await Promise.allSettled(
    SPORT_KEYS.map(key => getOddsForSport(key))
  );

  const all = results
    .filter(r => r.status === 'fulfilled')
    .flatMap(r => r.value || []);

  cache.set(cKey, all, 600);
  return all;
}

// Convert decimal odds to implied probability %
function oddsToProb(decimal) {
  if (!decimal || decimal <= 1) return 0;
  return Math.round((1 / decimal) * 100);
}

// Normalize bookmaker odds for a match
function normalizeMatch(match) {
  const h2h = match.bookmakers?.[0]?.markets?.find(m => m.key === 'h2h');
  const totals = match.bookmakers?.[0]?.markets?.find(m => m.key === 'totals');
  const btts = match.bookmakers?.[0]?.markets?.find(m => m.key === 'btts');

  if (!h2h) return null;

  const homeOdds = h2h.outcomes?.find(o => o.name === match.home_team)?.price;
  const awayOdds = h2h.outcomes?.find(o => o.name === match.away_team)?.price;
  const drawOdds = h2h.outcomes?.find(o => o.name === 'Draw')?.price;

  if (!homeOdds || !awayOdds) return null;

  // Raw probabilities from odds
  const rawHome = oddsToProb(homeOdds);
  const rawDraw = oddsToProb(drawOdds);
  const rawAway = oddsToProb(awayOdds);

  // Normalize to remove bookmaker margin (overround)
  const total = rawHome + rawDraw + rawAway;
  const home = Math.round((rawHome / total) * 100);
  const draw = Math.round((rawDraw / total) * 100);
  const away = 100 - home - draw;

  // Over/Under 2.5
  const over25Outcome = totals?.outcomes?.find(o => o.name === 'Over' && parseFloat(o.point) === 2.5);
  const under25Outcome = totals?.outcomes?.find(o => o.name === 'Under' && parseFloat(o.point) === 2.5);
  const over25 = over25Outcome ? oddsToProb(over25Outcome.price) : null;
  const under25 = under25Outcome ? oddsToProb(under25Outcome.price) : null;

  // BTTS
  const bttsYes = btts?.outcomes?.find(o => o.name === 'Yes')?.price;
  const bttsNo = btts?.outcomes?.find(o => o.name === 'No')?.price;

  return {
    id: match.id,
    homeTeam: match.home_team,
    awayTeam: match.away_team,
    commenceTime: match.commence_time,
    sport: match.sport_key,
    odds: {
      home: homeOdds,
      draw: drawOdds,
      away: awayOdds,
    },
    probabilities: { home, draw, away },
    markets: {
      over25: over25 ? Math.round((over25 / (over25 + (under25||50))) * 100) : null,
      under25: under25 ? Math.round((under25 / (over25||50 + under25)) * 100) : null,
      bttsYes: bttsYes ? oddsToProb(bttsYes) : null,
      bttsNo: bttsNo ? oddsToProb(bttsNo) : null,
    },
    bookmaker: match.bookmakers?.[0]?.title || 'Bookmaker',
  };
}

async function findOddsForFixture(homeName, awayName) {
  const all = await getAllOdds();

  // Fuzzy match team names
  const normalize = str => str.toLowerCase()
    .replace(/fc|cf|sc|ac|us |cd |rc |as |ss |ssc |afc |bfc /gi, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();

  const homeNorm = normalize(homeName);
  const awayNorm = normalize(awayName);

  const match = all.find(m => {
    const mHome = normalize(m.home_team);
    const mAway = normalize(m.away_team);
    return (
      (mHome.includes(homeNorm) || homeNorm.includes(mHome)) &&
      (mAway.includes(awayNorm) || awayNorm.includes(mAway))
    );
  });

  if (!match) return null;
  return normalizeMatch(match);
}

module.exports = { getAllOdds, findOddsForFixture, oddsToProb };
