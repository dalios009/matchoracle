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

const LEAGUE_META = {
  soccer_epl:                  { key:'pl',  name:'Premier League',   flag:'🏴󠁧󠁢󠁥󠁮󠁧󠁿' },
  soccer_spain_la_liga:        { key:'ll',  name:'La Liga',          flag:'🇪🇸' },
  soccer_uefa_champs_league:   { key:'cl',  name:'Champions League', flag:'⭐' },
  soccer_germany_bundesliga:   { key:'bl',  name:'Bundesliga',       flag:'🇩🇪' },
  soccer_italy_serie_a:        { key:'sa',  name:'Serie A',          flag:'🇮🇹' },
  soccer_france_ligue_one:     { key:'l1',  name:'Ligue 1',          flag:'🇫🇷' },
};

function oddsToProb(decimal) {
  if (!decimal || decimal <= 1) return 0;
  return 1 / decimal;
}

function normalize(str) {
  return str.toLowerCase()
    .replace(/\bfc\b|\baf\b|\bcf\b|\bsc\b|\bac\b|\bus\b|\bcd\b|\brc\b|\bas\b|\bss\b|\bssc\b/gi, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

async function fetchOddsForSport(sportKey) {
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
      timeout: 8000,
    });
    cache.set(cKey, data || []);
    logger.info(`Fetched ${(data||[]).length} matches for ${sportKey}`);
    return data || [];
  } catch (err) {
    logger.error(`Odds API failed for ${sportKey}:`, err.message);
    return [];
  }
}

async function getAllUpcomingMatches() {
  const cKey = 'odds:all:matches';
  const cached = cache.get(cKey);
  if (cached) return cached;

  const results = await Promise.allSettled(
    SPORT_KEYS.map(key => fetchOddsForSport(key))
  );

  const all = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      const sportKey = SPORT_KEYS[i];
      const meta = LEAGUE_META[sportKey] || {};
      (r.value || []).forEach(match => {
        all.push({ ...match, sportKey, leagueMeta: meta });
      });
    }
  });

  // Sort by time
  all.sort((a, b) => new Date(a.commence_time) - new Date(b.commence_time));
  cache.set(cKey, all, 600);
  return all;
}

function processMatch(match) {
  const h2h = match.bookmakers?.[0]?.markets?.find(m => m.key === 'h2h');
  const totals = match.bookmakers?.[0]?.markets?.find(m => m.key === 'totals');
  const bttsMarket = match.bookmakers?.[0]?.markets?.find(m => m.key === 'btts');

  if (!h2h) return null;

  const homeOdds = h2h.outcomes?.find(o => o.name === match.home_team)?.price;
  const awayOdds = h2h.outcomes?.find(o => o.name === match.away_team)?.price;
  const drawOdds = h2h.outcomes?.find(o => o.name === 'Draw')?.price;

  if (!homeOdds || !awayOdds || !drawOdds) return null;

  // Remove bookmaker margin
  const rawHome = oddsToProb(homeOdds);
  const rawDraw = oddsToProb(drawOdds);
  const rawAway = oddsToProb(awayOdds);
  const total = rawHome + rawDraw + rawAway;

  const homeProb = Math.round((rawHome / total) * 100);
  const drawProb = Math.round((rawDraw / total) * 100);
  const awayProb = 100 - homeProb - drawProb;

  // Over/Under 2.5
  const over25 = totals?.outcomes?.find(o => o.name === 'Over' && parseFloat(o.point) === 2.5)?.price;
  const under25 = totals?.outcomes?.find(o => o.name === 'Under' && parseFloat(o.point) === 2.5)?.price;
  const over25Prob = over25 && under25
    ? Math.round((oddsToProb(over25) / (oddsToProb(over25) + oddsToProb(under25))) * 100)
    : null;

  // Over 1.5
  const over15 = totals?.outcomes?.find(o => o.name === 'Over' && parseFloat(o.point) === 1.5)?.price;
  const over15Prob = over15 ? Math.min(92, Math.round(oddsToProb(over15) * 110)) : null;

  // BTTS
  const bttsYesOdds = bttsMarket?.outcomes?.find(o => o.name === 'Yes')?.price;
  const bttsNoOdds = bttsMarket?.outcomes?.find(o => o.name === 'No')?.price;
  const bttsYesProb = bttsYesOdds && bttsNoOdds
    ? Math.round((oddsToProb(bttsYesOdds) / (oddsToProb(bttsYesOdds) + oddsToProb(bttsNoOdds))) * 100)
    : null;

  // xG estimate from probabilities
  const homeXG = homeProb >= 60 ? 1.8
    : homeProb >= 50 ? 1.5
    : homeProb >= 40 ? 1.2
    : 0.9;
  const awayXG = awayProb >= 55 ? 1.6
    : awayProb >= 45 ? 1.3
    : awayProb >= 35 ? 1.0
    : 0.7;

  const meta = match.leagueMeta || {};
  const commenceTime = new Date(match.commence_time);

  return {
    id: match.id, // Odds API string ID — used as primary ID now
    leagueKey: meta.key || 'other',
    leagueName: meta.name || match.sport_title || 'Football',
    leagueFlag: meta.flag || '⚽',
    date: match.commence_time,
    time: commenceTime.toLocaleTimeString('en-GB', {
      hour: '2-digit', minute: '2-digit', timeZone: 'UTC',
    }),
    status: 'NS',
    elapsed: null,
    home: { id: match.home_team, name: match.home_team, logo: null },
    away: { id: match.away_team, name: match.away_team, logo: null },
    goals: { home: null, away: null },
    // Odds data attached
    oddsData: {
      bookmaker: match.bookmakers?.[0]?.title || 'Bookmaker',
      odds: { home: homeOdds, draw: drawOdds, away: awayOdds },
      probabilities: { home: homeProb, draw: drawProb, away: awayProb },
      markets: {
        over25: over25Prob,
        under25: over25Prob ? 100 - over25Prob : null,
        over15: over15Prob,
        bttsYes: bttsYesProb,
        bttsNo: bttsYesProb ? 100 - bttsYesProb : null,
      },
      xG: { home: homeXG, away: awayXG },
    },
  };
}

async function getFixturesByDateFromOdds(dateStr) {
  const all = await getAllUpcomingMatches();

  const fixtures = all
    .map(m => processMatch(m))
    .filter(Boolean)
    .filter(f => {
      const fDate = new Date(f.date).toISOString().split('T')[0];
      return fDate === dateStr;
    });

  logger.info(`Found ${fixtures.length} odds fixtures for ${dateStr}`);
  return fixtures;
}

async function findOddsForFixture(homeName, awayName) {
  const all = await getAllUpcomingMatches();
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
  const processed = processMatch(match);
  return processed?.oddsData || null;
}

module.exports = {
  getFixturesByDateFromOdds,
  findOddsForFixture,
  getAllUpcomingMatches,
  oddsToProb,
};
