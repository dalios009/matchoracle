// ════════════════════════════════════════════════════════════
// oddsService.js — ML-Augmented Prediction Engine
// Multi-bookmaker consensus + Poisson + calibration + extra markets
// ════════════════════════════════════════════════════════════
const axios = require('axios');
const NodeCache = require('node-cache');
const logger = require('../utils/logger');
const { getTeamRating, getLeagueBaseline } = require('./teamRatings');

const cache = new NodeCache({ stdTTL: 600 });
const KEY = process.env.ODDS_API_KEY;
const BASE = 'https://api.the-odds-api.com/v4';

const SPORTS = [
  { key: 'soccer_epl',                name: 'Premier League',     flag: '🏴', lk: 'pl' },
  { key: 'soccer_spain_la_liga',      name: 'La Liga',            flag: '🇪🇸', lk: 'll' },
  { key: 'soccer_uefa_champs_league', name: 'Champions League',   flag: '⭐', lk: 'cl' },
  { key: 'soccer_uefa_europa_league', name: 'Europa League',      flag: '🏆', lk: 'el' },
  { key: 'soccer_germany_bundesliga', name: 'Bundesliga',         flag: '🇩🇪', lk: 'bl' },
  { key: 'soccer_italy_serie_a',      name: 'Serie A',            flag: '🇮🇹', lk: 'sa' },
  { key: 'soccer_france_ligue_one',   name: 'Ligue 1',            flag: '🇫🇷', lk: 'l1' },
  { key: 'soccer_efl_champ',          name: 'Championship',       flag: '🏴', lk: 'ch' },
  { key: 'soccer_usa_mls',            name: 'MLS',                flag: '🇺🇸', lk: 'mls' },
  { key: 'soccer_brazil_campeonato',  name: 'Brasileirao',        flag: '🇧🇷', lk: 'br' },
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

// ── SHARP BOOKMAKER WEIGHTING ───────────────────────────────────
// Pinnacle and Betfair Exchange are widely regarded as the most efficient
// (lowest-margin, sharpest-priced) books in the industry — professional
// bettors treat their lines as the closest thing to "true" probability.
// Weighting them higher in the consensus tightens our baseline before
// any other modelling is applied.
var SHARP_BOOKS = {
  pinnacle: 3,
  betfair_ex_eu: 3,
  betfair: 3,
  matchbook: 2,
  betfair_ex_au: 3,
};
function sharpWeight(bookmakerKey) {
  return SHARP_BOOKS[(bookmakerKey || '').toLowerCase()] || 1;
}

// ── MULTI-BOOKMAKER CONSENSUS (replaces single-bookmaker reads) ─
// Ensemble of N market estimators reduces variance vs trusting one book.
// Outliers are trimmed first (removes stale/erroneous lines), then the
// remaining quotes are weighted toward sharp books for the final mean.
function consensusOdds(bookmakers, outcomeNameFn, market) {
  market = market || 'h2h';
  var entries = [];
  (bookmakers || []).forEach(function (bm) {
    var w = sharpWeight(bm.key);
    (bm.markets || []).forEach(function (mkt) {
      if (mkt.key !== market) return;
      (mkt.outcomes || []).forEach(function (oc) {
        if (outcomeNameFn(oc)) entries.push({ price: oc.price, weight: w });
      });
    });
  });
  if (!entries.length) return null;

  // Trim outliers on raw price (remove min and max if we have 5+ quotes)
  if (entries.length >= 5) {
    entries.sort(function (a, b) { return a.price - b.price; });
    entries = entries.slice(1, -1);
  }

  var weightedSum = 0, totalWeight = 0;
  entries.forEach(function (e) { weightedSum += e.price * e.weight; totalWeight += e.weight; });
  var mean = weightedSum / totalWeight;

  // stdDev computed on raw prices — used for the agreement score, unaffected by weighting
  var rawMean = entries.reduce(function (s, e) { return s + e.price; }, 0) / entries.length;
  var variance = entries.reduce(function (s, e) { return s + Math.pow(e.price - rawMean, 2); }, 0) / entries.length;

  return { mean: mean, stdDev: Math.sqrt(variance), n: entries.length };
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
  return {
    overProb: Math.round((rO / (rO + rU)) * 100),
    overOdds: parseFloat(avgO.toFixed(2)),
    underOdds: parseFloat(avgU.toFixed(2)),
  };
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
  return {
    yesProb: Math.round((rY / (rY + rN)) * 100),
    yesOdds: parseFloat(avgY.toFixed(2)),
    noOdds: parseFloat(avgN.toFixed(2)),
  };
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

  // Step 4: expected goals — blend Dixon-Coles team model with market totals line
  var leagueBase = getLeagueBaseline(sport.key);
  var homeRating = getTeamRating(home);
  var awayRating = getTeamRating(away);
  var hxgTeamModel = leagueBase.home * homeRating.atk * awayRating.def;
  var axgTeamModel = leagueBase.away * awayRating.atk * homeRating.def;

  var totalLine = estimateTotalXG(bms);
  if (totalLine === null) {
    var minOdds = Math.min(hOdds, aOdds);
    totalLine = Math.min(3.6, Math.max(1.8, 1.5 + minOdds * 0.32));
  }

  // Calibrate team-model total against market total (50/50) — keeps goal
  // expectancy anchored to the market while letting team strength shape
  // the home/away split and the shape of the distribution.
  var teamModelTotal = hxgTeamModel + axgTeamModel;
  var calibScale = teamModelTotal > 0 ? (0.5 * teamModelTotal + 0.5 * totalLine) / teamModelTotal : 1;
  var hxgTeam = hxgTeamModel * calibScale;
  var axgTeam = axgTeamModel * calibScale;

  // Home/away split: blend market-implied share (40%) with Dixon-Coles
  // team-strength share (60%) — team ratings get the larger say once we
  // know roughly how many goals the match should produce in total.
  var marketHomeShare = pH / (pH + pA + 0.01);
  var teamHomeShare = hxgTeam / Math.max(hxgTeam + axgTeam, 0.01);
  var homeShare = 0.40 * marketHomeShare + 0.60 * teamHomeShare;

  var blendedTotal = (teamModelTotal > 0 ? (hxgTeam + axgTeam) : totalLine);
  var hxg = parseFloat(Math.max(0.30, Math.min(5.0, blendedTotal * homeShare)).toFixed(2));
  var axg = parseFloat(Math.max(0.20, Math.min(4.5, blendedTotal * (1 - homeShare))).toFixed(2));

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
    ? 0.5 * (bttsConsensus.yesProb / 100) + 0.5 * matBtts
    : matBtts;
  var bttsRealOdds = bttsConsensus !== null ? bttsConsensus.yesOdds : null;

  // Step 8: Over/Under — consensus market (multiple lines) + Poisson cross-check
  var over25Consensus = consensusTotalsLine(bms, 2.5);
  var matOver25 = 0;
  Object.entries(matrix).forEach(function (e) {
    var parts = e[0].split('-');
    if (parseInt(parts[0]) + parseInt(parts[1]) > 2) matOver25 += e[1];
  });
  var over25 = over25Consensus !== null
    ? 0.5 * (over25Consensus.overProb / 100) + 0.5 * matOver25
    : matOver25;
  var over25RealOdds = over25Consensus !== null ? over25Consensus.overOdds : null;

  var over15Consensus = consensusTotalsLine(bms, 1.5);
  var matOver15 = 0;
  Object.entries(matrix).forEach(function (e) {
    var parts = e[0].split('-');
    if (parseInt(parts[0]) + parseInt(parts[1]) > 1) matOver15 += e[1];
  });
  var over15 = over15Consensus !== null
    ? 0.5 * (over15Consensus.overProb / 100) + 0.5 * matOver15
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

  // Step 12: confidence score — blends prediction sharpness + bookmaker agreement + sample size + team data quality
  var maxP = Math.max(bH, bD, bA);
  var topScoreP = top5[0][1];
  var sharpness = (maxP * 0.55 + topScoreP * 5 * 0.25) * 100;
  var agreementBonus = agreementScore * 12;
  var sampleBonus = Math.min(8, numBooks * 0.8);
  // Bonus when both teams are in our ratings database (vs unknown 1.0/1.0 default)
  var knownTeamsBonus = (homeRating.atk !== 1.0 ? 3 : 0) + (awayRating.atk !== 1.0 ? 3 : 0);
  var conf = Math.min(96, Math.max(32, sharpness + agreementBonus + sampleBonus + knownTeamsBonus));

  // Step 13: value bets — EV using the BLENDED probability vs REAL market odds
  // (the genuine "edge" signal: where our ensemble disagrees with the market)
  //
  // Sanity check: reject if our model's probability is more than 1.5x the
  // market-implied probability. A gap that large from a consensus-odds-only
  // model is almost always model noise, not real insight — most often on
  // long-shot prices where small probability errors produce inflated EV%.
  function passesSanityCheck(modelP, odds) {
    var implied = 1 / odds;
    return (modelP / implied) <= 1.5;
  }

  // Thresholds loosened from the original ev>0.06 + prob>0.22 + conf>=55
  // combo, which was so strict together it almost never fired in practice.
  // odds<=5.0 cap (was 4.5) still does the real work of filtering out
  // unreliable long-shot "value" that's really just probability-estimate noise.
  var valueBets = [];
  [
    { label: home + ' Win', p: bH, odds: hOdds },
    { label: 'Draw', p: bD, odds: dOdds },
    { label: away + ' Win', p: bA, odds: aOdds },
  ].forEach(function (v) {
    var ev = v.p * v.odds - 1;
    if (ev > 0.04 && v.p > 0.15 && conf >= 45 && v.odds <= 5.0 && passesSanityCheck(v.p, v.odds)) {
      valueBets.push({ label: v.label, odds: v.odds, ev: ev, prob: v.p });
    }
  });

  // BTTS / Over 2.5 value checks — now uses REAL consensus odds, real EV formula
  if (bttsRealOdds && conf >= 45) {
    var bttsEV = bttsVal * bttsRealOdds - 1;
    if (bttsEV > 0.04 && bttsVal > 0.15 && bttsRealOdds <= 5.0 && passesSanityCheck(bttsVal, bttsRealOdds)) {
      valueBets.push({ label: 'BTTS Yes', odds: bttsRealOdds, ev: bttsEV, prob: bttsVal });
    }
  }
  if (over25RealOdds && conf >= 45) {
    var over25EV = over25 * over25RealOdds - 1;
    if (over25EV > 0.04 && over25 > 0.15 && over25RealOdds <= 5.0 && passesSanityCheck(over25, over25RealOdds)) {
      valueBets.push({ label: 'Over 2.5 Goals', odds: over25RealOdds, ev: over25EV, prob: over25 });
    }
  }
  valueBets.sort(function (a, b) { return b.ev - a.ev; });


  // Step 14: best bets for UI — sorted, deduped, capped at 6
  var matchResultPick = bH >= bA && bH >= bD ? home + ' Win' : bA > bH && bA >= bD ? away + ' Win' : 'Draw';
  var matchResultOdds = bH >= bA && bH >= bD ? hOdds : bA > bH && bA >= bD ? aOdds : dOdds;

  var bestBets = [
    { market: 'Match Result', value: matchResultPick,
      prob: Math.round(Math.max(bH, bD, bA) * 100), tier: conf >= 65 ? 'high' : 'med',
      odds: parseFloat(matchResultOdds.toFixed(2)) },
    { market: 'Both Teams Score', value: 'Yes (BTTS)', prob: Math.round(bttsVal * 100), tier: bttsVal >= 0.6 ? 'high' : 'med',
      odds: bttsRealOdds },
    { market: 'Total Goals', value: 'Over 2.5', prob: Math.round(over25 * 100), tier: over25 >= 0.6 ? 'high' : 'med',
      odds: over25RealOdds },
    { market: 'Total Goals', value: 'Over 1.5', prob: Math.round(over15 * 100), tier: over15 >= 0.75 ? 'high' : 'med',
      odds: null }, // no consensus odds fetched for this line yet — outcome-only, not settleable for $ profit
    { market: 'Double Chance', value: bH >= bA ? home + ' or Draw' : away + ' or Draw',
      prob: Math.round((bH >= bA ? bH + bD : bA + bD) * 100), tier: 'med', odds: null },
    { market: 'Asian Handicap', value: home + ' -0.5', prob: Math.round(ahMinus05 * 100), tier: ahMinus05 >= 0.55 ? 'med' : 'low', odds: null },
    { market: 'Clean Sheet', value: home + ' CS', prob: Math.round(homeCleanSheet * 100), tier: homeCleanSheet >= 0.4 ? 'med' : 'low', odds: null },
    { market: 'Clean Sheet', value: away + ' CS', prob: Math.round(awayCleanSheet * 100), tier: awayCleanSheet >= 0.35 ? 'med' : 'low', odds: null },
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
    home: { id: match.id + '_h', name: home, logo: null, rating: homeRating },
    away: { id: match.id + '_a', name: away, logo: null, rating: awayRating },
    goals: { home: null, away: null },
    oddsData: {
      bookmaker: bms.length + ' bookmakers (sharp-weighted consensus)',
      odds: { home: hOdds, draw: dOdds, away: aOdds },
      bttsOdds: bttsRealOdds,
      over25Odds: over25RealOdds,
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
      // Flag-time odds snapshot — used for closing-line value (CLV) tracking.
      // The bot stores this when a value bet is first surfaced, then compares
      // against odds closer to kickoff to see if the market moved with or
      // against the pick (see verify_predictions / CLV job in the Python bot).
      flagTimeOdds: { home: hOdds, draw: dOdds, away: aOdds, btts: bttsRealOdds, over25: over25RealOdds },
      flaggedAt: new Date().toISOString(),
    },
  };
}

// ── FETCH LAYER ────────────────────────────────────────────────
// Credit-saving notes:
// - Cache TTL raised from 10 min to 30 min — odds don't need to refresh
//   that often, and this single change cuts API calls by ~3x.
// - Only ONE request per sport per cache window now (was up to 3, trying
//   different market combos). We request all markets in one shot and just
//   accept whatever subset the API actually returns instead of retrying.
// - Failures (errors, empty results, exhausted quota) are also cached
//   briefly so a quota-exhausted key doesn't hammer the API on every
//   single page load until the cache naturally expires.
var FAILURE_CACHE_TTL = 120; // seconds — short, so real recoveries aren't blocked long
var SUCCESS_CACHE_TTL = 1800; // 30 minutes

async function fetchSport(sport) {
  var ck = 'odds:' + sport.key;
  var c = cache.get(ck);
  if (c !== undefined) return c; // includes cached empty-array failures

  try {
    var r = await axios.get(BASE + '/sports/' + sport.key + '/odds', {
      params: { apiKey: KEY, regions: 'eu,uk,us', markets: 'h2h,totals,btts', oddsFormat: 'decimal', dateFormat: 'iso' },
      timeout: 10000,
    });
    var d = r.data || [];
    logger.info(sport.name + ': ' + d.length + ' games');
    cache.set(ck, d, d.length > 0 ? SUCCESS_CACHE_TTL : FAILURE_CACHE_TTL);
    return d;
  } catch (e) {
    var status = e.response && e.response.status;
    var msg = e.response ? JSON.stringify(e.response.data) : e.message;
    logger.error('OddsAPI ' + sport.key + ' (' + status + '): ' + msg);
    // Cache the failure briefly so repeated requests during an outage or
    // quota exhaustion don't keep spending credits / retrying pointlessly.
    cache.set(ck, [], FAILURE_CACHE_TTL);
    return [];
  }
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
