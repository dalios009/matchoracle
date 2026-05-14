const axios = require('axios');
const NodeCache = require('node-cache');
const logger = require('../utils/logger');

const cache = new NodeCache({ stdTTL: 300, checkperiod: 60 });

const apiClient = axios.create({
  baseURL: 'https://api-football-v1.p.rapidapi.com/v3',
  timeout: 10000,
  headers: {
    'X-RapidAPI-Key': process.env.FOOTBALL_API_KEY,
    'X-RapidAPI-Host': process.env.FOOTBALL_API_HOST || 'api-football-v1.p.rapidapi.com',
  },
});

const LEAGUE_MAP = {
  pl: { id: 39,  name: 'Premier League',   flag: '🏴󠁧󠁢󠁥󠁮󠁧󠁿' },
  cl: { id: 2,   name: 'Champions League', flag: '⭐' },
  ll: { id: 140, name: 'La Liga',          flag: '🇪🇸' },
  bl: { id: 78,  name: 'Bundesliga',       flag: '🇩🇪' },
  sa: { id: 135, name: 'Serie A',          flag: '🇮🇹' },
  l1: { id: 61,  name: 'Ligue 1',          flag: '🇫🇷' },
};

function formatDate(date) {
  return new Date(date).toISOString().split('T')[0];
}

async function cachedGet(endpoint, params, ttl) {
  const key = `${endpoint}:${JSON.stringify(params)}`;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  const { data } = await apiClient.get(endpoint, { params });
  cache.set(key, data, ttl || 300);
  return data;
}

function normalizeFixture(fix, leagueKey) {
  const { fixture, league, teams, goals } = fix;
  const leagueMeta = LEAGUE_MAP[leagueKey] || {};
  return {
    id: fixture.id,
    leagueKey: leagueKey || 'other',
    leagueName: league.name,
    leagueFlag: leagueMeta.flag || '⚽',
    date: fixture.date,
    time: new Date(fixture.date).toLocaleTimeString('en-GB', {
      hour: '2-digit', minute: '2-digit', timeZone: 'UTC',
    }),
    status: fixture.status.short,
    elapsed: fixture.status.elapsed,
    home: {
      id: teams.home.id,
      name: teams.home.name,
      logo: teams.home.logo,
    },
    away: {
      id: teams.away.id,
      name: teams.away.name,
      logo: teams.away.logo,
    },
    goals: {
      home: goals.home,
      away: goals.away,
    },
  };
}

async function getFixturesByDate(dateStr) {
  const date = dateStr || formatDate(new Date());
  const cKey = `fixtures:${date}`;
  const cached = cache.get(cKey);
  if (cached) return cached;

  const season = new Date().getFullYear();
  const requests = Object.entries(LEAGUE_MAP).map(async ([key, league]) => {
    try {
      const data = await cachedGet('/fixtures', {
        league: league.id, date, season,
      });
      return (data.response || []).map(f => normalizeFixture(f, key));
    } catch (err) {
      logger.error(`Failed to fetch ${key}:`, err.message);
      return [];
    }
  });

  const results = await Promise.allSettled(requests);
  const fixtures = results
    .filter(r => r.status === 'fulfilled')
    .flatMap(r => r.value)
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  cache.set(cKey, fixtures, 300);
  return fixtures;
}

async function getTeamForm(teamId, last = 5) {
  const cKey = `form:${teamId}:${last}`;
  const cached = cache.get(cKey);
  if (cached) return cached;

  try {
    const data = await cachedGet('/fixtures', {
      team: teamId, last, status: 'FT',
    });
    const form = (data.response || []).map(fix => {
      const isHome = fix.teams.home.id === teamId;
      const scored = isHome ? fix.goals.home : fix.goals.away;
      const conceded = isHome ? fix.goals.away : fix.goals.home;
      let result = 'D';
      if (scored > conceded) result = 'W';
      if (scored < conceded) result = 'L';
      return { result, scored, conceded };
    }).reverse();

    const summary = {
      form: form.map(f => f.result),
      avgScored: form.length
        ? +(form.reduce((s, f) => s + f.scored, 0) / form.length).toFixed(2) : 0,
      avgConceded: form.length
        ? +(form.reduce((s, f) => s + f.conceded, 0) / form.length).toFixed(2) : 0,
    };

    cache.set(cKey, summary, 600);
    return summary;
  } catch (err) {
    logger.error('getTeamForm failed:', err.message);
    return null;
  }
}

async function getH2H(homeId, awayId, last = 5) {
  const cKey = `h2h:${homeId}:${awayId}`;
  const cached = cache.get(cKey);
  if (cached) return cached;

  try {
    const data = await cachedGet('/fixtures/headtohead', {
      h2h: `${homeId}-${awayId}`, last, status: 'FT',
    });

    const matches = (data.response || []).map(fix => ({
      homeGoals: fix.goals.home,
      awayGoals: fix.goals.away,
      totalGoals: (fix.goals.home || 0) + (fix.goals.away || 0),
    }));

    const summary = {
      matches,
      avgGoals: matches.length
        ? +(matches.reduce((s, m) => s + m.totalGoals, 0) / matches.length).toFixed(2) : 0,
      homeWins: matches.filter(m => m.homeGoals > m.awayGoals).length,
      draws: matches.filter(m => m.homeGoals === m.awayGoals).length,
      awayWins: matches.filter(m => m.awayGoals > m.homeGoals).length,
      bttsCount: matches.filter(m => m.homeGoals > 0 && m.awayGoals > 0).length,
      over25Count: matches.filter(m => m.totalGoals > 2).length,
    };

    cache.set(cKey, summary, 3600);
    return summary;
  } catch (err) {
    logger.error('getH2H failed:', err.message);
    return null;
  }
}

module.exports = {
  getFixturesByDate,
  getTeamForm,
  getH2H,
  LEAGUE_MAP,
  formatDate,
};
