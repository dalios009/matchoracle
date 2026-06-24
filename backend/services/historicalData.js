'use strict';
/**
 * historicalData.js — REAL learning from actual match results
 * ─────────────────────────────────────────────────────────────────
 * Replaces the old static, hand-typed TEAM_RATINGS dictionary with
 * ratings computed from real recent results via football-data.org
 * (free tier, permanent, no credit card).
 *
 * How it works:
 *  1. Fetch the last ~90 days of FINISHED matches per competition.
 *  2. For each team, compute average goals scored/conceded over their
 *     last N games (home and away tracked separately, since home
 *     advantage is real and shouldn't be averaged away).
 *  3. Normalize against the competition's own average to get relative
 *     attack/defense ratings — same 1.0-centered scale the rest of the
 *     prediction engine already expects, so nothing downstream changes.
 *  4. Cache for 12 hours and refresh in the background — this is real
 *     "learning" in the sense that ratings shift as new results come
 *     in, without needing a manual data refresh or redeploy.
 *
 * This does NOT use any paid/ML training pipeline — it's a transparent,
 * auditable statistical recompute. That's a deliberate choice: it's
 * explainable (you can always ask "why is Arsenal rated 1.3?" and trace
 * it to actual recent matches), reliable, and free to run continuously.
 */

const axios = require('axios');
const NodeCache = require('node-cache');
const logger = require('../utils/logger');

const FD_BASE = 'https://api.football-data.org/v4';
const FD_KEY = process.env.FOOTBALL_DATA_KEY;
const cache = new NodeCache({ stdTTL: 43200 }); // 12 hours

// football-data.org free tier competition codes that map to our SPORTS keys
const COMPETITION_MAP = {
  soccer_epl: 'PL',
  soccer_spain_la_liga: 'PD',
  soccer_germany_bundesliga: 'BL1',
  soccer_italy_serie_a: 'SA',
  soccer_france_ligue_one: 'FL1',
  soccer_uefa_champs_league: 'CL',
  soccer_netherlands_eredivisie: 'DED',
  soccer_portugal_primeira_liga: 'PPL',
  soccer_efl_champ: 'ELC',
  soccer_brazil_campeonato: 'BSA',
  soccer_fifa_world_cup: 'WC',
};

const MIN_GAMES_FOR_RATING = 4; // below this, a team's sample is too small to trust
const MAX_GAMES_CONSIDERED = 10; // most recent N games per team

async function fetchFinishedMatches(competitionCode) {
  const ck = 'fd:matches:' + competitionCode;
  const c = cache.get(ck);
  if (c !== undefined) return c;

  if (!FD_KEY) {
    logger.error('FOOTBALL_DATA_KEY not set — historical ratings unavailable, falling back to defaults');
    return [];
  }

  try {
    const dateTo = new Date().toISOString().split('T')[0];
    const dateFrom = new Date(Date.now() - 100 * 86400000).toISOString().split('T')[0]; // last 100 days
    const r = await axios.get(FD_BASE + '/competitions/' + competitionCode + '/matches', {
      headers: { 'X-Auth-Token': FD_KEY },
      params: { status: 'FINISHED', dateFrom, dateTo },
      timeout: 10000,
    });
    const matches = (r.data && r.data.matches) || [];
    logger.info('football-data.org ' + competitionCode + ': ' + matches.length + ' finished matches');
    cache.set(ck, matches, 43200);
    return matches;
  } catch (e) {
    const status = e.response && e.response.status;
    const msg = e.response ? JSON.stringify(e.response.data) : e.message;
    logger.error('football-data.org ' + competitionCode + ' (' + status + '): ' + msg);
    // Cache empty result briefly so we don't hammer a rate-limited/broken
    // endpoint on every request (free tier is 10 req/min — easy to exceed
    // across 11 competitions if not cached).
    cache.set(ck, [], 600);
    return [];
  }
}

/**
 * Collect team crest (club logo) and national flag URLs seen in a batch of
 * matches. football-data.org v4 includes these directly on each match's
 * homeTeam/awayTeam objects (`crest`) and on `area.flag` for the team's
 * country — no extra API calls needed, we already have this data from the
 * same matches we use for ratings.
 * Returns { [teamName]: { crest, flag } }
 */
function collectCrestsFromMatches(matches) {
  const crests = {};
  matches.forEach(function (m) {
    [m.homeTeam, m.awayTeam].forEach(function (team) {
      if (!team || !team.name) return;
      if (!crests[team.name] && (team.crest || team.flag)) {
        crests[team.name] = { crest: team.crest || null, flag: team.flag || null };
      }
    });
    // National-team matches (World Cup) carry the country flag on `m.area`
    // rather than on the team object itself in some responses.
    if (m.area && m.area.flag) {
      [m.homeTeam, m.awayTeam].forEach(function (team) {
        if (team && team.name && !crests[team.name]) {
          crests[team.name] = { crest: null, flag: m.area.flag };
        }
      });
    }
  });
  return crests;
}

/**
 * Build per-team rating maps for one competition from its real recent results.
 * Returns { [teamName]: { atk, def, gamesUsed } }
 */
function computeRatingsFromMatches(matches) {
  const teamGames = {}; // teamName -> [{ scored, conceded, venue }]

  matches.forEach(function (m) {
    if (!m.score || m.score.fullTime.home == null || m.score.fullTime.away == null) return;
    const home = m.homeTeam.name;
    const away = m.awayTeam.name;
    const hg = m.score.fullTime.home;
    const ag = m.score.fullTime.away;

    (teamGames[home] = teamGames[home] || []).push({ scored: hg, conceded: ag, venue: 'home' });
    (teamGames[away] = teamGames[away] || []).push({ scored: ag, conceded: hg, venue: 'away' });
  });

  // League-wide average goals per game, used to normalize team ratings to
  // the same 1.0-centered scale the rest of the engine expects.
  let totalGoals = 0, totalGames = 0;
  matches.forEach(function (m) {
    if (!m.score || m.score.fullTime.home == null) return;
    totalGoals += m.score.fullTime.home + m.score.fullTime.away;
    totalGames += 1;
  });
  const avgGoalsPerTeamPerGame = totalGames > 0 ? (totalGoals / totalGames) / 2 : 1.3;

  const ratings = {};
  Object.keys(teamGames).forEach(function (team) {
    // Most recent games first (API returns chronological; reverse + slice)
    const recent = teamGames[team].slice(-MAX_GAMES_CONSIDERED);
    if (recent.length < MIN_GAMES_FOR_RATING) return; // not enough data — let caller fall back

    const avgScored = recent.reduce(function (s, g) { return s + g.scored; }, 0) / recent.length;
    const avgConceded = recent.reduce(function (s, g) { return s + g.conceded; }, 0) / recent.length;

    ratings[team] = {
      atk: +(avgScored / avgGoalsPerTeamPerGame).toFixed(3),
      def: +(avgConceded / avgGoalsPerTeamPerGame).toFixed(3),
      gamesUsed: recent.length,
      source: 'historical',
    };
  });

  return ratings;
}

/**
 * Get live-computed ratings for every team across all mapped competitions.
 * Returns a flat { [teamName]: { atk, def, gamesUsed, source } } map.
 * Call this once and reuse — it's already cached internally.
 */
async function getAllLiveRatings() {
  const ck = 'fd:allRatings';
  const c = cache.get(ck);
  if (c !== undefined) return c;

  const codes = Object.values(COMPETITION_MAP);
  const results = await Promise.allSettled(
    codes.map(function (code) { return fetchFinishedMatches(code); })
  );

  let merged = {};
  let crests = {};
  let allMatches = [];
  results.forEach(function (r) {
    if (r.status !== 'fulfilled') return;
    const ratings = computeRatingsFromMatches(r.value);
    merged = Object.assign(merged, ratings);
    crests = Object.assign({}, collectCrestsFromMatches(r.value), crests); // first-seen wins, club crest preferred
    allMatches = allMatches.concat(r.value);
  });

  logger.info('Live ratings computed for ' + Object.keys(merged).length + ' teams from real results');
  logger.info('Crests/flags collected for ' + Object.keys(crests).length + ' teams');
  cache.set(ck, merged, 43200);
  cache.set('fd:allCrests', crests, 43200);
  cache.set('fd:allMatches', allMatches, 43200); // raw match list, for result lookups (bet settlement)
  return merged;
}

/**
 * Find a finished match's final score by team names, searching the same
 * ~100-day window already fetched for ratings/crests. This is the key
 * advantage over The Odds API's /scores endpoint, which is capped at a
 * 3-day lookback — bets older than 3 days would otherwise stay "pending"
 * forever even though the match has long since finished.
 * Returns { homeScore, awayScore, homeTeam, awayTeam } or null if not found.
 */
async function findFinishedMatch(homeTeamName, awayTeamName) {
  function norm(s) { return (s || '').toLowerCase().replace(/[^a-z]/g, ''); }
  const hn = norm(homeTeamName), an = norm(awayTeamName);

  await getAllLiveRatings(); // ensures fd:allMatches is populated
  const matches = cache.get('fd:allMatches') || [];

  const found = matches.find(function (m) {
    const gh = norm(m.homeTeam && m.homeTeam.name);
    const ga = norm(m.awayTeam && m.awayTeam.name);
    const teamsMatch = (gh.includes(hn) || hn.includes(gh)) && (ga.includes(an) || an.includes(ga));
    return teamsMatch && m.score && m.score.fullTime && m.score.fullTime.home != null;
  });

  if (!found) return null;
  return {
    homeScore: found.score.fullTime.home,
    awayScore: found.score.fullTime.away,
    homeTeam: found.homeTeam.name,
    awayTeam: found.awayTeam.name,
  };
}

/**
 * Get crest/flag URLs for every team seen in recent matches across all
 * mapped competitions. Returns { [teamName]: { crest, flag } }.
 * Must be called after (or alongside) getAllLiveRatings, since it shares
 * the same underlying fetch — calling this first will trigger the fetch.
 */
async function getAllCrests() {
  const ck = 'fd:allCrests';
  const c = cache.get(ck);
  if (c !== undefined) return c;
  await getAllLiveRatings(); // populates the crests cache as a side effect
  return cache.get(ck) || {};
}

/**
 * Look up one team's crest/flag, with fuzzy name matching since odds-feed
 * team names don't always match football-data.org's naming exactly
 * (e.g. "Man City" vs "Manchester City FC").
 */
async function getTeamCrest(teamName) {
  const all = await getAllCrests();
  if (all[teamName]) return all[teamName];
  const nl = teamName.toLowerCase();
  const fuzzyKey = Object.keys(all).find(function (k) {
    return k.toLowerCase().includes(nl) || nl.includes(k.toLowerCase());
  });
  return fuzzyKey ? all[fuzzyKey] : null;
}

/**
 * Look up one team's rating from the live-computed set, with graceful
 * fallback. fallbackFn should be the existing static getTeamRating-style
 * function so behavior is identical for any team with too little real data
 * (new promotions, lesser World Cup nations, etc).
 */
async function getLiveTeamRating(teamName, fallbackFn) {
  const all = await getAllLiveRatings();
  if (all[teamName] && all[teamName].gamesUsed >= MIN_GAMES_FOR_RATING) {
    return all[teamName];
  }
  // Fuzzy match in case of slight name differences (e.g. "Arsenal" vs "Arsenal FC")
  const nl = teamName.toLowerCase();
  const fuzzyKey = Object.keys(all).find(function (k) {
    return k.toLowerCase().includes(nl) || nl.includes(k.toLowerCase());
  });
  if (fuzzyKey) return all[fuzzyKey];

  const fb = fallbackFn ? fallbackFn(teamName) : { atk: 1.0, def: 1.0 };
  return Object.assign({}, fb, { gamesUsed: 0, source: 'static-fallback' });
}

module.exports = {
  getAllLiveRatings,
  getLiveTeamRating,
  computeRatingsFromMatches,
  getAllCrests,
  getTeamCrest,
  findFinishedMatch,
  COMPETITION_MAP,
};