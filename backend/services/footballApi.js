const axios = require('axios');
const NodeCache = require('node-cache');
const logger = require('../utils/logger');

const cache = new NodeCache({ stdTTL: 300, checkperiod: 60 });

const apiClient = axios.create({
  baseURL: 'https://v3.football.api-sports.io',
  timeout: 10000,
});

apiClient.interceptors.request.use(config => {
  config.headers = {
    'x-apisports-key': process.env.FOOTBALL_API_KEY,
  };
  return config;
});

const LEAGUE_MAP = {
  39:  { key: 'pl', name: 'Premier League',   flag: '🏴󠁧󠁢󠁥󠁮󠁧󠁿' },
  2:   { key: 'cl', name: 'Champions League', flag: '⭐' },
  140: { key: 'll', name: 'La Liga',          flag: '🇪🇸' },
  78:  { key: 'bl', name: 'Bundesliga',       flag: '🇩🇪' },
  135: { key: 'sa', name: 'Serie A',          flag: '🇮🇹' },
  61:  { key: 'l1', name: 'Ligue 1',          flag: '🇫🇷' },
  3:   { key: 'uel', name: 'UEFA Europa',     flag: '🟠' },
  848: { key: 'uecl', name: 'UEFA Conf',      flag: '🔵' },
  88:  { key: 'ere', name: 'Eredivisie',      flag: '🇳🇱' },
  94:  { key: 'pl2', name: 'Primeira Liga',   flag: '🇵🇹' },
};

function formatDate(date) {
  return new Date(date).toISOString().split('T')[0];
}

function normalizeFixture(fix) {
  const { fixture, league, teams, goals } = fix;
  const leagueMeta = LEAGUE_MAP[league.id] || {};
  return {
    id: fixture.id,
    leagueKey: leagueMeta.key || 'other',
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

  try {
    logger.info(`Fetching fixtures for date: ${date}`);
    const { data } = await apiClient.get('/fixtures', {
      params: { date },
    });

    if (data.errors && Object.keys(data.errors).length > 0) {
      logger.error('API errors:', data.errors);
      return [];
    }

    const fixtures = (data.response || [])
      .filter(fix => LEAGUE_MAP[fix.league.id])
      .map(fix => normalizeFixture(fix))
      .sort((a, b) => new Date(a.date) - new Date(b.date));

    logger.info(`Found ${fixtures.length} fixtures for ${date}`);
    cache.set(cKey, fixtures, 300);
    return fixtures;
  } catch (err) {
    logger.error('getFixturesByDate failed:', err.message);
    return [];
  }
}

async function getTeamForm(teamId, last = 5) {
  const cKey = `form:${teamId}:${last}`;
  const cached = cache.get(cKey);
  if (cached) return cached;

  try {
    const { data } = await apiClient.get('/fixtures', {
      params: { team: teamId, last, status: 'FT' },
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
    const { data } = await apiClient.get('/fixtures/headtohead', {
      params: { h2h: `${homeId}-${awayId}`, last },
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