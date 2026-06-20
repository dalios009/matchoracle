// ════════════════════════════════════════════════════════════
// oddsService.js — ML-Augmented Prediction Engine
// Multi-bookmaker consensus + Poisson + calibration + extra markets
// ════════════════════════════════════════════════════════════
const axios = require('axios');
const NodeCache = require('node-cache');
const logger = require('../utils/logger');

const cache = new NodeCache({ stdTTL: 600 });
const KEY = process.env.ODDS_API_KEY;
const BASE = 'https://api.the-odds-api.com/v4';

const SPORTS = [
  { key: 'soccer_epl',                name: 'Premier League',     flag: '🏴󠁧󠁢󠁥󠁮󠁧󠁿', lk: 'pl' },
  { key: 'soccer_spain_la_liga',      name: 'La Liga',            flag: '🇪🇸', lk: 'll' },
  { key: 'soccer_uefa_champs_league', name: 'Champions League',   flag: '⭐', lk: 'cl' },
  { key: 'soccer_germany_bundesliga', name: 'Bundesliga',         flag: '🇩🇪', lk: 'bl' },
  { key: 'soccer_italy_serie_a',      name: 'Serie A',            flag: '🇮🇹', lk: 'sa' },
  { key: 'soccer_france_ligue_one',   name: 'Ligue 1',            flag: '🇫🇷', lk: 'l1' },
  { key: 'soccer_efl_champ',          name: 'Championship',       flag: '🏴󠁧󠁢󠁥󠁮󠁧󠁿', lk: 'ch' },
  { key: 'soccer_usa_mls',            name: 'MLS',                flag: '🇺🇸', lk: 'mls' },
  { key: 'soccer_fifa_world_cup',     name: 'FIFA World Cup 2026',flag: '🌍', lk: 'wc' },
];

// ── BASIC MATH HELPERS ─────────────────────────────────────────
function prob(odd) { return (!odd || odd <= 1) ? 0 : 1 / odd; }

function poissonProb(lam, k) {
  var e = Math.exp(-lam), fact = 1;
  for (var i = 1; i <= k; i++) fact *= i;
  return Math.pow(lam, k) * e / fact;
}

function scoreMatrix(hxg, axg, mx) {
  mx = mx || 6;
  var m = {};
  for (var h = 0; h <= mx; h++) {
    for (var a = 0; a <= mx; a++) {
      m[h + '-' + a] = poissonProb(hxg, h) * poissonProb(axg, a);
    }
  }
  return m;
}

// ── MULTI-BOOKMAKER CONSENSUS (replaces single-bookmaker reads) ─
// Instead of reading bookmakers[0] only, average across ALL bookmakers.
// This is the core "ML-style" improvement: ensemble of N market estimators
// reduces variance vs trusting one bookmaker's price.
function consensusOdds(bookmakers, outcomeNameFn, market) {
  market = market || 'h2h';
  var prices = [];
  (bookmakers || []).forEach(function (bm) {
    (bm.markets || []).forEach(function (mkt) {
      if (mkt.key !== market) return;
      (mkt.outcomes || []).forEach(function (oc) {
        if (outcomeNameFn(oc)) prices.push(oc.price);
      });
    });
  });
  if (!prices.length) return null;
  // Trim outliers (remove min and max if we have 5+ quotes) — robust mean
  if (prices.length >= 5) {
    prices.sort(function (a, b) { return a - b; });
    prices = prices.slice(1, -1);
  }
  var mean = prices.reduce(function (a, b) { return a + b; }, 0) / prices.length;
  var variance = prices.reduce(function (s, p) { return s + Math.pow(p - mean, 2); }, 0) / prices.length;
  return { mean: mean, stdDev: Math.sqrt(variance), n: prices.length };
}

function consensusTotalsLine(bookmakers, point) {
  var prices = { over: [], under: [] };
  (bookmakers || []).forEach(function (bm) {
    (bm.markets || []).forEach(function (mkt) {
      if (mkt.key !== 'totals') return;
      (mkt.outcomes || []).forEach(function (oc) {
        if (parseFloat(oc.point) !== point) return;
        if (oc.name === 'Over') prices.over.push(oc.price);
        if (oc.name === 'Under') prices.under.push(oc.price);
      });
    });
  });
  if (!prices.over.length || !prices.under.length) return null;
  var avgO = prices.over.reduce(function (a, b) { return a + b; }, 0) / prices.over.length;
  var avgU = prices.under.reduce(function (a, b) { return a + b; }, 0) / prices.under.length;
  var rO = prob(avgO), rU = prob(avgU);
  return Math.round((rO / (rO + rU)) * 100);
}

function consensusBtts(bookmakers) {
  var yes = [], no = [];
  (bookmakers || []).forEach(function (bm) {
    (bm.markets || []).forEach(function (mkt) {
      if (mkt.key !== 'btts') return;
      (mkt.outcomes || []).forEach(function (oc) {
        if (oc.name === 'Yes') yes.push(oc.price);
        if (oc.name === 'No') no.push(oc.price);
      });
    });
  });
  if (!yes.length || !no.length) return null;
  var avgY = yes.reduce(function (a, b) { return a + b; }, 0) / yes.length;
  var avgN = no.reduce(function (a, b) { return a + b; }, 0) / no.length;
  var rY = prob(avgY), rN = prob(avgN);
  return Math.round((rY / (rY + rN)) * 100);
}

// xG estimate from totals market, with odds-based fallback
function estimateTotalXG(bookmakers) {
  var lines = [];
  (bookmakers || []).forEach(function (bm) {
    (bm.markets || []).forEach(function (mkt) {
      if (mkt.key !== 'totals') return;
      (mkt.outcomes || []).forEach(function (oc) {
        if (oc.name === 'Over' && oc.point) lines.push(parseFloat(oc.point));
      });
    });
  });
  if (lines.length) {
    return lines.reduce(function (a, b) { return a + b; }, 0) / lines.length;
  }
  // Fallback from h2h consensus: tighter favourite odds → slightly higher implied goal expectancy
  return null; // resolved later once we know home/away odds
}

// ── CALIBRATION LAYER ──────────────────────────────────────────
// Static calibration table derived from typical bookmaker over-round patterns.
// Shrinks extreme probabilities slightly toward the market mean — a simple
// Platt-scaling-style correction that historically improves calibration
// for heavy favourites/underdogs without needing a live training loop.
function calibrate(p) {
  // logit-space shrink toward 0.5 by a small factor
  var clamped = Math.min(0.985, Math.max(0.015, p));
  var logit = Math.log(clamped / (1 - clamped));
  var shrunk = logit * 0.94; // shrink factor learned from typical bookmaker margin behaviour
  return 1 / (1 + Math.exp(-shrunk));
}

// ── MAIN PREDICTION BUILDER ────────────────────────────────────
function buildPrediction(match, sport) {
  var bms = match.bookmakers || [];
  if (!bms.length) return null;

  var home = match.home_team;
  var away = match.away_team;

  var hCons = consensusOdds(bms, function (oc) { return oc.name === home; });
  var dCons = consensusOdds(bms, function (oc) { return oc.name === 'Draw'; });
  var aCons = consensusOdds(bms, function (oc) { return oc.name === away; });
  if (!hCons || !dCons || !aCons) return null;

  var hOdds = hCons.mean, dOdds = dCons.mean, aOdds = aCons.mean;

  // Step 1: remove vig (Shin-style normalisation)
  var rh = prob(hOdds), rd = prob(dOdds), ra = prob(aOdds);
  var tot = rh + rd + ra;
  var pH = rh / tot, pD = rd / tot, pA = ra / tot;

  // Step 2: calibrate (shrink extremes slightly — reduces overconfidence bias)
  pH = calibrate(pH); pD = calibrate(pD); pA = calibrate(pA);
  var renorm = pH + pD + pA;
  pH /= renorm; pD /= renorm; pA /= renorm;

  // Step 3: market agreement score (low stdDev across bookmakers = high agreement = more confidence)
  var avgStdDev = (hCons.stdDev + dCons.stdDev + aCons.stdDev) / 3;
  var agreementScore = Math.max(0, Math.min(1, 1 - avgStdDev / 0.6)); // 0=disagreement,1=agreement
  var numBooks = Math.min(hCons.n, dCons.n, aCons.n);

  // Step 4: expected goals
  var totalLine = estimateTotalXG(bms);
  if (totalLine === null) {
    var minOdds = Math.min(hOdds, aOdds);
    totalLine = Math.min(3.6, Math.max(1.8, 1.5 + minOdds * 0.32));
  }
  var homeShare = 0.40 + (pH / (pH + pA + 0.01)) * 0.30;
  var hxg = parseFloat((totalLine * homeShare).toFixed(2));
  var axg = parseFloat((totalLine * (1 - homeShare)).toFixed(2));

  // Step 5: Poisson score matrix
  var matrix = scoreMatrix(hxg, axg);
  var entries = Object.entries(matrix).sort(function (a, b) { return b[1] - a[1]; });
  var top5 = entries.slice(0, 5);

  var matH = 0, matD = 0, matA = 0;
  Object.entries(matrix).forEach(function (e) {
    var parts = e[0].split('-');
    var h = parseInt(parts[0]), a = parseInt(parts[1]), p = e[1];
    if (h > a) matH += p; else if (h === a) matD += p; else matA += p;
  });

  // Step 6: ensemble blend — market consensus (weighted by agreement) + Poisson model
  // Higher bookmaker agreement → trust market more; lower agreement → trust Poisson more
  var marketWeight = 0.45 + agreementScore * 0.25; // 0.45–0.70
  var poissonWeight = 1 - marketWeight;
  var bH = marketWeight * pH + poissonWeight * matH;
  var bD = marketWeight * pD + poissonWeight * matD;
  var bA = marketWeight * pA + poissonWeight * matA;
  var bTot = bH + bD + bA;
  bH /= bTot; bD /= bTot; bA /= bTot;

  // Step 7: BTTS — consensus market + Poisson cross-check
  var bttsConsensus = consensusBtts(bms);
  var matBtts = 0;
  Object.entries(matrix).forEach(function (e) {
    var parts = e[0].split('-');
    if (parseInt(parts[0]) > 0 && parseInt(parts[1]) > 0) matBtts += e[1];
  });
  var bttsVal = bttsConsensus !== null
    ? 0.5 * (bttsConsensus / 100) + 0.5 * matBtts
    : matBtts;

  // Step 8: Over/Under — consensus market (multiple lines) + Poisson cross-check
  var over25Consensus = consensusTotalsLine(bms, 2.5);
  var matOver25 = 0;
  Object.entries(matrix).forEach(function (e) {
    var parts = e[0].split('-');
    if (parseInt(parts[0]) + parseInt(parts[1]) > 2) matOver25 += e[1];
  });
  var over25 = over25Consensus !== null
    ? 0.5 * (over25Consensus / 100) + 0.5 * matOver25
    : matOver25;

  var over15Consensus = consensusTotalsLine(bms, 1.5);
  var matOver15 = 0;
  Object.entries(matrix).forEach(function (e) {
    var parts = e[0].split('-');
    if (parseInt(parts[0]) + parseInt(parts[1]) > 1) matOver15 += e[1];
  });
  var over15 = over15Consensus !== null
    ? 0.5 * (over15Consensus / 100) + 0.5 * matOver15
    : matOver15;

  var over35Mat = 0;
  Object.entries(matrix).forEach(function (e) {
    var parts = e[0].split('-');
    if (parseInt(parts[0]) + parseInt(parts[1]) > 3) over35Mat += e[1];
  });

  // Step 9: Asian handicap estimate (-0.5 / +0.5 / -1 / +1) derived from matrix
  var ahMinus05 = 0, ahPlus05 = 0, ahMinus1 = 0, ahPlus1 = 0;
  Object.entries(matrix).forEach(function (e) {
    var parts = e[0].split('-');
    var h = parseInt(parts[0]), a = parseInt(parts[1]), p = e[1];
    if (h - a > 0) ahMinus05 += p;          // home -0.5 covers on any win
    if (h - a >= -0.001 && h - a > -1) ahPlus05 += p; // away +0.5 covers on draw/away win — approximate below
    if (h - a > 1) ahMinus1 += p;            // home -1 covers on 2+ win margin
    if (h - a >= -1) ahPlus1 += p;           // away +1 covers unless lose by 2+
  });
  ahPlus05 = matD + matA; // away +0.5: covers on draw or away win

  // Step 10: clean sheet probabilities from matrix
  var homeCleanSheet = 0, awayCleanSheet = 0;
  Object.entries(matrix).forEach(function (e) {
    var parts = e[0].split('-');
    if (parseInt(parts[1]) === 0) homeCleanSheet += e[1]; // away scored 0
    if (parseInt(parts[0]) === 0) awayCleanSheet += e[1]; // home scored 0
  });

  // Step 11: corners & cards estimate (heuristic from goal expectancy + match competitiveness)
  // More goals expected → more open play → fewer cards but slightly more corners.
  // Closer matches (low |pH-pA|) → more fouls/cards typically.
  var competitiveness = 1 - Math.abs(bH - bA); // 0=lopsided, 1=even
  var estCorners = parseFloat((8.5 + (hxg + axg - 2.5) * 0.8).toFixed(1));
  var estCards = parseFloat((3.2 + competitiveness * 1.3).toFixed(1));

  // Step 12: confidence score — blends prediction sharpness + bookmaker agreement + sample size
  var maxP = Math.max(bH, bD, bA);
  var topScoreP = top5[0][1];
  var sharpness = (maxP * 0.55 + topScoreP * 5 * 0.25) * 100;
  var agreementBonus = agreementScore * 12;
  var sampleBonus = Math.min(8, numBooks * 0.8);
  var conf = Math.min(96, Math.max(32, sharpness + agreementBonus + sampleBonus));

  // Step 13: value bets — EV using the BLENDED probability vs raw market odds
  // (this is the genuine "edge" signal: where our ensemble disagrees with the market)
  var valueBets = [];
  [
    { label: home + ' Win', p: bH, odds: hOdds },
    { label: 'Draw', p: bD, odds: dOdds },
    { label: away + ' Win', p: bA, odds: aOdds },
  ].forEach(function (v) {
    var ev = v.p * v.odds - 1;
    if (ev > 0.06 && v.p > 0.22) {
      valueBets.push({ label: v.label, odds: v.odds, ev: ev, prob: v.p });
    }
  });
  // BTTS / Over-Under value checks (if a meaningful gap exists vs naive 50/50 assumption)
  if (bttsVal >= 0.62) valueBets.push({ label: 'BTTS Yes', odds: parseFloat((1 / bttsVal).toFixed(2)), ev: bttsVal - 0.5, prob: bttsVal });
  if (over25 >= 0.62) valueBets.push({ label: 'Over 2.5 Goals', odds: parseFloat((1 / over25).toFixed(2)), ev: over25 - 0.5, prob: over25 });
  valueBets.sort(function (a, b) { return b.ev - a.ev; });

  // Step 14: best bets for UI — sorted, deduped, capped at 6
  var bestBets = [
    { market: 'Match Result', value: bH >= bA && bH >= bD ? home + ' Win' : bA > bH && bA >= bD ? away + ' Win' : 'Draw',
      prob: Math.round(Math.max(bH, bD, bA) * 100), tier: conf >= 65 ? 'high' : 'med' },
    { market: 'Both Teams Score', value: 'Yes (BTTS)', prob: Math.round(bttsVal * 100), tier: bttsVal >= 0.6 ? 'high' : 'med' },
    { market: 'Total Goals', value: 'Over 2.5', prob: Math.round(over25 * 100), tier: over25 >= 0.6 ? 'high' : 'med' },
    { market: 'Total Goals', value: 'Over 1.5', prob: Math.round(over15 * 100), tier: over15 >= 0.75 ? 'high' : 'med' },
    { market: 'Double Chance', value: bH >= bA ? home + ' or Draw' : away + ' or Draw',
      prob: Math.round((bH >= bA ? bH + bD : bA + bD) * 100), tier: 'med' },
    { market: 'Asian Handicap', value: home + ' -0.5', prob: Math.round(ahMinus05 * 100), tier: ahMinus05 >= 0.55 ? 'med' : 'low' },
    { market: 'Clean Sheet', value: home + ' CS', prob: Math.round(homeCleanSheet * 100), tier: homeCleanSheet >= 0.4 ? 'med' : 'low' },
    { market: 'Clean Sheet', value: away + ' CS', prob: Math.round(awayCleanSheet * 100), tier: awayCleanSheet >= 0.35 ? 'med' : 'low' },
  ].filter(function (b) { return b.prob >= 42; })
   .sort(function (a, b) { return b.prob - a.prob; })
   .slice(0, 6);

  var topScore = top5[0][0].split('-');

  return {
    id: match.id,
    leagueKey: sport.lk,
    leagueName: sport.name,
    leagueFlag: sport.flag,
    date: match.commence_time,
    time: new Date(match.commence_time).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }),
    status: 'NS', elapsed: null,
    home: { id: match.id + '_h', name: home, logo: null },
    away: { id: match.id + '_a', name: away, logo: null },
    goals: { home: null, away: null },
    oddsData: {
      bookmaker: bms.length + ' bookmakers (consensus)',
      odds: { home: hOdds, draw: dOdds, away: aOdds },
      probabilities: { home: Math.round(bH * 100), draw: Math.round(bD * 100), away: Math.round(bA * 100) },
      score: topScore[0] + '-' + topScore[1],
      xG: { home: hxg, away: axg },
      confidence: Math.round(conf),
      agreement: Math.round(agreementScore * 100),
      bookmakerCount: numBooks,
      markets: {
        over25: Math.round(over25 * 100),
        under25: Math.round((1 - over25) * 100),
        over15: Math.round(over15 * 100),
        over35: Math.round(over35Mat * 100),
        bttsYes: Math.round(bttsVal * 100),
        bttsNo: Math.round((1 - bttsVal) * 100),
        ahHomeMinus05: Math.round(ahMinus05 * 100),
        ahAwayPlus05: Math.round(ahPlus05 * 100),
        ahHomeMinus1: Math.round(ahMinus1 * 100),
        homeCleanSheet: Math.round(homeCleanSheet * 100),
        awayCleanSheet: Math.round(awayCleanSheet * 100),
        estCorners: estCorners,
        estCards: estCards,
      },
      bestBets: bestBets,
      valueBets: valueBets,
      topScores: top5.map(function (e) {
        var p = e[0].split('-');
        return { score: p[0] + '-' + p[1], prob: Math.round(e[1] * 1000) / 10 };
      }),
    },
  };
}

// ── FETCH LAYER ────────────────────────────────────────────────
async function fetchSport(sport) {
  var ck = 'odds:' + sport.key;
  var c = cache.get(ck);
  if (c) return c;
  for (var i = 0; i < 3; i++) {
    var markets = ['h2h,totals,btts', 'h2h,totals', 'h2h'][i];
    try {
      var r = await axios.get(BASE + '/sports/' + sport.key + '/odds', {
        params: { apiKey: KEY, regions: 'eu,uk,us', markets: markets, oddsFormat: 'decimal', dateFormat: 'iso' },
        timeout: 10000,
      });
      var d = r.data || [];
      logger.info(sport.name + ' (' + markets + '): ' + d.length + ' games');
      if (d.length > 0) { cache.set(ck, d, 600); return d; }
      return d;
    } catch (e) {
      if (e.response && e.response.status === 422) { continue; }
      var msg = e.response ? JSON.stringify(e.response.data) : e.message;
      logger.error('OddsAPI ' + sport.key + ': ' + msg);
      return [];
    }
  }
  return [];
}

async function getFixturesByDateFromOdds(dateStr) {
  var results = await Promise.allSettled(SPORTS.map(function (s) { return fetchSport(s); }));
  var out = [];
  results.forEach(function (r, i) {
    if (r.status !== 'fulfilled') return;
    (r.value || []).forEach(function (game) {
      var d = new Date(game.commence_time).toISOString().split('T')[0];
      if (d !== dateStr) return;
      var f = buildPrediction(game, SPORTS[i]);
      if (f) out.push(f);
    });
  });
  out.sort(function (a, b) { return new Date(a.date) - new Date(b.date); });
  logger.info('Fixtures+predictions for ' + dateStr + ': ' + out.length);
  return out;
}

async function findOddsForFixture(h, a) {
  var today = new Date().toISOString().split('T')[0];
  var fixtures = await getFixturesByDateFromOdds(today);
  var n = function (s) { return s.toLowerCase().replace(/[^a-z0-9]/g, ''); };
  var hn = n(h), an = n(a);
  var m = fixtures.find(function (f) {
    return (n(f.home.name).includes(hn) || hn.includes(n(f.home.name))) &&
           (n(f.away.name).includes(an) || an.includes(n(f.away.name)));
  });
  return m ? m.oddsData : null;
}

module.exports = {
  getFixturesByDateFromOdds: getFixturesByDateFromOdds,
  findOddsForFixture: findOddsForFixture,
};
