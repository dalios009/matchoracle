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
  { key: 'soccer_italy_serie_a',      name: 'Serie A',          flag: '🇮🇹', leagueKey: 'sa' },
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
  if (!h2h) return null;
  const homeOdds = h2h.outcomes?.find(o => o.name === match.home_team)?.price;
  const awayOdds = h2h.outcomes?.find(o => o.name === match.away_team)?.price;
  const drawOdds = h2h.outcomes?.find(o => o.name === 'Draw')?.price;
  if (!homeOdds || !awayOdds || !drawOdds) return null;
  const rawH = oddsToProb(homeOdds);
  const rawD = oddsToProb(drawOdds);
  const rawA = oddsToProb(awayOdds);
  const total = rawH + rawD + rawA;
  const homeProb = Math.round((rawH / total) * 100);
  const drawProb = Math.round((rawD / total) * 100);
  const awayProb = 100 - homeProb - drawProb;
  const homeXG = homeProb >= 65 ? 2.0 : homeProb >= 52 ? 1.6 : homeProb >= 42 ? 1.3 : homeProb >= 32 ? 1.0 : 0.8;
  const awayXG = awayProb >= 60 ? 1.8 : awayProb >= 48 ? 1.4 : awayProb >= 38 ? 1.1 : awayProb >= 28 ? 0.8 : 0.6;
  const commenceTime = new Date(match.commence_time);
  return {
    id: match.id,
    leagueKey: sport.leagueKey,
    leagueName: sport.name,
    leagueFlag: sport.flag,
    date: match.commence_time,
    time: commenceTime.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }),
    status: 'NS',
    elapsed: null,
    home: { id: match.id + '_h', name: match.home_team, logo: null },
    away: { id: match.id + '_a', name: match.away_team, logo: null },
    goals: { home: null, away: null },
    oddsData: {
      bookmaker: bm.title,
      odds: { home: homeOdds, draw: drawOdds, away: awayOdds },
      probabilities: { home: homeProb, draw: drawProb, away: awayProb },
      markets: { over25: null, under25: null, over15: null, bttsYes: null, bttsNo: null },
      xG: { home: homeXG, away: awayXG },
    },
  };
}

async function fetchSportOdds(sport) {
  const cKey = 'odds:' + sport.key;
  const cached = cache.get(cKey);
  if (cached) return cached;
  try {
    const response = await axios.get(BASE + '/sports/' + sport.key + '/odds', {
      params: { apiKey: ODDS_API_KEY, regions: 'eu', markets: 'h2h', oddsFormat: 'decimal', dateFormat: 'iso' },
      timeout: 10000,
    });
    const data = response.data || [];
    logger.info(sport.name + ': fetched ' + data.length + ' matches');
    if (data.length > 0) cache.set(cKey, data, 600);
    return data;
  } catch (err) {
    const msg = err.response ? JSON.stringify(err.response.data) : err.message;
    logger.error('Odds API failed for ' + sport.key + ': ' + msg);
    return [];
  }
}

async function getFixturesByDateFromOdds(dateStr) {
  const results = await Promise.allSettled(SPORTS.map(function(sport) { return fetchSportOdds(sport); }));
  const fixtures = [];
  results.forEach(function(r, i) {
    if (r.status !== 'fulfilled') return;
    const sportMeta = SPORTS[i];
    (r.value || []).forEach(function(match) {
      const mDate = new Date(match.commence_time).toISOString().split('T')[0];
      if (mDate !== dateStr) return;
      const fixture = processMatch(match, sportMeta);
      if (fixture) fixtures.push(fixture);
    });
  });
  fixtures.sort(function(a, b) { return new Date(a.date) - new Date(b.date); });
  logger.info('Total fixtures for ' + dateStr + ': ' + fixtures.length);
  return fixtures;
}

async function findOddsForFixture(homeName, awayName) {
  const today = new Date().toISOString().split('T')[0];
  const fixtures = await getFixturesByDateFromOdds(today);
  const norm = function(s) { return s.toLowerCase().replace(/[^a-z0-9]/g, ''); };
  const hN = norm(homeName);
  const aN = norm(awayName);
  const match = fixtures.find(function(f) {
    return (norm(f.home.name).includes(hN) || hN.includes(norm(f.home.name))) &&
           (norm(f.away.name).includes(aN) || aN.includes(norm(f.away.name)));
  });
  return match ? match.oddsData : null;
}

module.exports = { getFixturesByDateFromOdds: getFixturesByDateFromOdds, findOddsForFixture: findOddsForFixture };
