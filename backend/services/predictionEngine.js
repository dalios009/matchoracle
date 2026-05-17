const logger = require('../utils/logger');

// Real team strength based on known league positions and career stats
// This gives genuinely different predictions per team
const TEAM_PROFILES = {
  // La Liga
  529: { name: 'Barcelona',       attack: 9.2, defense: 8.1, homeStr: 8.8, form: 0.78 },
  541: { name: 'Real Madrid',     attack: 9.0, defense: 8.3, homeStr: 8.9, form: 0.75 },
  530: { name: 'Atletico Madrid', attack: 7.8, defense: 8.8, homeStr: 8.2, form: 0.72 },
  548: { name: 'Real Sociedad',   attack: 7.2, defense: 7.0, homeStr: 7.4, form: 0.61 },
  532: { name: 'Valencia',        attack: 6.2, defense: 5.8, homeStr: 6.8, form: 0.45 },
  533: { name: 'Villarreal',      attack: 7.0, defense: 6.5, homeStr: 7.1, form: 0.58 },
  536: { name: 'Sevilla',         attack: 6.8, defense: 6.2, homeStr: 7.0, form: 0.52 },
  547: { name: 'Girona',          attack: 7.5, defense: 6.8, homeStr: 7.3, form: 0.65 },
  728: { name: 'Rayo Vallecano',  attack: 5.8, defense: 5.5, homeStr: 6.2, form: 0.48 },
  531: { name: 'Athletic Bilbao', attack: 6.9, defense: 7.1, homeStr: 7.4, form: 0.63 },
  540: { name: 'Espanyol',        attack: 6.1, defense: 5.9, homeStr: 6.5, form: 0.50 },
  723: { name: 'Alaves',          attack: 5.5, defense: 5.8, homeStr: 6.0, form: 0.44 },
  724: { name: 'Getafe',          attack: 5.6, defense: 6.0, homeStr: 6.3, form: 0.51 },
  798: { name: 'Mallorca',        attack: 5.4, defense: 6.2, homeStr: 6.1, form: 0.47 },
  718: { name: 'Oviedo',          attack: 5.0, defense: 5.2, homeStr: 5.8, form: 0.41 },
  // Premier League
  42:  { name: 'Arsenal',         attack: 8.8, defense: 8.5, homeStr: 8.6, form: 0.76 },
  50:  { name: 'Man City',        attack: 9.1, defense: 8.2, homeStr: 8.7, form: 0.74 },
  40:  { name: 'Liverpool',       attack: 8.9, defense: 8.0, homeStr: 8.5, form: 0.73 },
  49:  { name: 'Chelsea',         attack: 7.8, defense: 7.5, homeStr: 7.9, form: 0.65 },
  66:  { name: 'Aston Villa',     attack: 7.6, defense: 7.2, homeStr: 7.8, form: 0.64 },
  33:  { name: 'Man United',      attack: 7.0, defense: 6.8, homeStr: 7.5, form: 0.55 },
  51:  { name: 'Brighton',        attack: 7.4, defense: 7.0, homeStr: 7.2, form: 0.62 },
  73:  { name: 'Tottenham',       attack: 7.5, defense: 6.5, homeStr: 7.4, form: 0.58 },
  52:  { name: 'Crystal Palace',  attack: 6.2, defense: 6.5, homeStr: 6.8, form: 0.50 },
  // Champions League
  157: { name: 'Bayern Munich',   attack: 9.3, defense: 8.4, homeStr: 9.0, form: 0.80 },
  489: { name: 'AC Milan',        attack: 8.0, defense: 7.8, homeStr: 8.2, form: 0.68 },
  505: { name: 'Inter Milan',     attack: 8.2, defense: 8.5, homeStr: 8.4, form: 0.72 },
  496: { name: 'Juventus',        attack: 7.5, defense: 7.8, homeStr: 7.8, form: 0.63 },
  // Bundesliga
  165: { name: 'Dortmund',        attack: 8.2, defense: 7.0, homeStr: 8.0, form: 0.66 },
  173: { name: 'RB Leipzig',      attack: 7.8, defense: 7.5, homeStr: 7.6, form: 0.65 },
  // Ligue 1
  85:  { name: 'Paris SG',        attack: 9.4, defense: 8.6, homeStr: 9.1, form: 0.82 },
  80:  { name: 'Lyon',            attack: 7.2, defense: 6.8, homeStr: 7.4, form: 0.58 },
  81:  { name: 'Marseille',       attack: 7.5, defense: 7.0, homeStr: 7.6, form: 0.62 },
  116: { name: 'Lens',            attack: 6.8, defense: 6.5, homeStr: 7.0, form: 0.55 },
};

const DEFAULT_PROFILE = { attack: 6.0, defense: 6.0, homeStr: 6.5, form: 0.50 };

function getProfile(teamId) {
  return TEAM_PROFILES[teamId] || DEFAULT_PROFILE;
}

function calcProbabilities(homeProfile, awayProfile) {
  // Home advantage factor
  const HOME_BONUS = 1.15;

  // Expected goals using attack vs defense ratings
  const homeXG = ((homeProfile.attack / 10) * (1 - awayProfile.defense / 14) * HOME_BONUS * 2.2);
  const awayXG = ((awayProfile.attack / 10) * (1 - homeProfile.defense / 14) * 1.9);

  const hXG = Math.max(0.4, Math.min(3.5, homeXG));
  const aXG = Math.max(0.3, Math.min(3.0, awayXG));

  // Form adjustment
  const formDiff = (homeProfile.form - awayProfile.form) * 0.3;

  // Raw win probability using strength difference + home advantage
  const strengthDiff = (homeProfile.homeStr - awayProfile.attack * 0.85) / 10 + formDiff;
  const sigmoid = x => 1 / (1 + Math.exp(-x * 2.5));
  const homeWinRaw = sigmoid(strengthDiff + 0.08);

  // Draw probability — higher when teams are evenly matched
  const evenness = 1 - Math.abs(homeWinRaw - 0.5) * 1.8;
  const drawBase = Math.max(0.18, Math.min(0.32, 0.22 + evenness * 0.10));

  const remaining = 1 - drawBase;
  const homeWin = Math.round(homeWinRaw * remaining * 100);
  const awayWin = Math.round((1 - homeWinRaw) * remaining * 100);
  const draw = 100 - homeWin - awayWin;

  return {
    home: Math.max(10, homeWin),
    draw: Math.max(12, draw),
    away: Math.max(8, awayWin),
    hXG: +hXG.toFixed(2),
    aXG: +aXG.toFixed(2),
  };
}

function calcBettingMarkets(probs, hXG, aXG, homeProfile, awayProfile) {
  const totalXG = hXG + aXG;

  // Over/Under based on expected goals
  const over25 = Math.round(Math.min(82, Math.max(25,
    totalXG > 3.0 ? 72 : totalXG > 2.5 ? 60 : totalXG > 2.0 ? 45 : 30
  )));
  const over15 = Math.round(Math.min(90, over25 + 18));
  const under25 = 100 - over25;

  // BTTS — both teams need decent attack ratings
  const homeScoringChance = Math.min(0.88, homeProfile.attack / 11);
  const awayScoringChance = Math.min(0.82, awayProfile.attack / 11.5);
  const btts = Math.round(homeScoringChance * awayScoringChance * 100);

  // Double chance
  const dcHome = Math.min(93, probs.home + probs.draw);
  const dcAway = Math.min(90, probs.away + probs.draw);

  // Asian handicap -0.5 home (home wins by 1+)
  const ahHome = Math.round(probs.home * 0.88);

  // Clean sheet
  const homeCS = Math.round(Math.max(12, Math.min(55,
    (awayProfile.attack < 7 ? 45 : awayProfile.attack < 8 ? 35 : 22)
  )));
  const awayCS = Math.round(Math.max(10, Math.min(48,
    (homeProfile.attack < 7 ? 40 : homeProfile.attack < 8 ? 28 : 18)
  )));

  // 1st half under 1.5
  const htUnder = Math.round(Math.min(78, Math.max(38, 65 - (totalXG - 2.5) * 8)));

  return {
    over25, over15, under25, btts,
    nobtts: 100 - btts,
    dcHome, dcAway, ahHome,
    homeCS, awayCS, htUnder,
  };
}

function getBestBets(probs, markets, homeName, awayName) {
  const all = [
    { market: 'Match Result',    value: `${homeName} Win`,      prob: probs.home,         tier: probs.home >= 60 ? 'high' : probs.home >= 48 ? 'med' : 'low' },
    { market: 'Match Result',    value: 'Draw',                 prob: probs.draw,         tier: probs.draw >= 30 ? 'med' : 'low' },
    { market: 'Match Result',    value: `${awayName} Win`,      prob: probs.away,         tier: probs.away >= 55 ? 'high' : probs.away >= 42 ? 'med' : 'low' },
    { market: 'Over/Under',      value: 'Over 2.5 Goals',       prob: markets.over25,     tier: markets.over25 >= 65 ? 'high' : markets.over25 >= 50 ? 'med' : 'low' },
    { market: 'Over/Under',      value: 'Under 2.5 Goals',      prob: markets.under25,    tier: markets.under25 >= 60 ? 'high' : markets.under25 >= 48 ? 'med' : 'low' },
    { market: 'Over/Under',      value: 'Over 1.5 Goals',       prob: markets.over15,     tier: markets.over15 >= 70 ? 'high' : 'med' },
    { market: 'Both Teams Score',value: 'Yes (BTTS)',           prob: markets.btts,       tier: markets.btts >= 65 ? 'high' : markets.btts >= 50 ? 'med' : 'low' },
    { market: 'Both Teams Score',value: 'No BTTS',              prob: markets.nobtts,     tier: markets.nobtts >= 58 ? 'med' : 'low' },
    { market: 'Double Chance',   value: `${homeName} or Draw`,  prob: markets.dcHome,     tier: markets.dcHome >= 72 ? 'high' : 'med' },
    { market: 'Double Chance',   value: `${awayName} or Draw`,  prob: markets.dcAway,     tier: markets.dcAway >= 68 ? 'high' : 'med' },
    { market: 'Asian Handicap',  value: `${homeName} -0.5`,     prob: markets.ahHome,     tier: markets.ahHome >= 58 ? 'med' : 'low' },
    { market: 'Clean Sheet',     value: `${homeName} CS`,       prob: markets.homeCS,     tier: markets.homeCS >= 42 ? 'med' : 'low' },
    { market: 'Clean Sheet',     value: `${awayName} CS`,       prob: markets.awayCS,     tier: markets.awayCS >= 38 ? 'med' : 'low' },
    { market: 'Half Time',       value: 'Under 1.5 Goals HT',  prob: markets.htUnder,    tier: markets.htUnder >= 58 ? 'med' : 'low' },
  ];

  // Return top 6 by probability, excluding very low ones
  return all
    .filter(b => b.prob >= 45)
    .sort((a, b) => b.prob - a.prob)
    .slice(0, 6);
}

function getInsights(probs, markets, hXG, aXG, homeProfile, awayProfile, homeName, awayName) {
  const insights = [];
  const totalXG = hXG + aXG;

  // Team strength insight
  const strengthGap = homeProfile.attack - awayProfile.attack;
  if (probs.home >= 60) {
    insights.push({ icon: '📈', text: `${homeName} are clear favourites at ${probs.home}% — strong home record and superior squad depth.` });
  } else if (probs.away >= 55) {
    insights.push({ icon: '⚡', text: `${awayName} are the away favourites at ${probs.away}% — travelling in better form.` });
  } else {
    insights.push({ icon: '⚖️', text: `Evenly matched contest — ${homeName} ${probs.home}% vs ${awayName} ${probs.away}%. Draw at ${probs.draw}% is realistic.` });
  }

  // Goals insight
  if (totalXG >= 2.8) {
    insights.push({ icon: '⚽', text: `High-scoring game expected — combined xG of ${totalXG.toFixed(1)}. Over 2.5 Goals at ${markets.over25}% is the standout market.` });
  } else if (totalXG <= 2.0) {
    insights.push({ icon: '🛡️', text: `Tight, low-scoring match expected — xG of only ${totalXG.toFixed(1)} total. Under 2.5 Goals at ${markets.under25}% looks strong.` });
  } else {
    insights.push({ icon: '🎯', text: `Moderate scoring expected — xG ${totalXG.toFixed(1)}. Over 1.5 Goals at ${markets.over15}% is the safest goals market.` });
  }

  // BTTS insight
  if (markets.btts >= 62) {
    insights.push({ icon: '🔄', text: `Both teams have potent attacks — BTTS Yes at ${markets.btts}% is well-backed. ${homeName} xG ${hXG} vs ${awayName} xG ${aXG}.` });
  } else if (markets.nobtts >= 58) {
    insights.push({ icon: '🔒', text: `At least one team likely kept quiet — BTTS No at ${markets.nobtts}%. ${awayName} attack rating suggests they may struggle to score.` });
  }

  // Best value bet
  const bestBet = getBestBets(probs, markets, homeName, awayName)[0];
  if (bestBet) {
    insights.push({ icon: '💡', text: `Best value: ${bestBet.market} — ${bestBet.value} at ${bestBet.prob}% probability. Most reliable market for this fixture.` });
  }

  return insights.slice(0, 4);
}

function calcConfidence(homeProfile, awayProfile, probs) {
  let conf = 48;

  // Known team profiles give more confidence
  const homeKnown = !!TEAM_PROFILES[homeProfile.id];
  const awayKnown = !!TEAM_PROFILES[awayProfile.id];
  if (homeKnown) conf += 8;
  if (awayKnown) conf += 8;

  // Clear favourite increases confidence
  const maxProb = Math.max(probs.home, probs.draw, probs.away);
  conf += (maxProb - 33) * 0.6;

  // Big strength gap = more confidence
  const gap = Math.abs(homeProfile.attack - awayProfile.attack);
  conf += gap * 1.5;

  return Math.round(Math.min(87, Math.max(45, conf)));
}

function generatePrediction(fixture, homeFormData, awayFormData, h2hData) {
  try {
    const homeId = fixture.home?.id;
    const awayId = fixture.away?.id;
    const homeName = fixture.home?.name || 'Home';
    const awayName = fixture.away?.name || 'Away';

    const homeProfile = { ...getProfile(homeId), id: homeId, name: homeName };
    const awayProfile = { ...getProfile(awayId), id: awayId, name: awayName };

    // Use real form data if available to adjust profiles
    if (homeFormData?.avgScored) {
      homeProfile.attack = (homeProfile.attack + homeFormData.avgScored * 2.5) / 2;
    }
    if (awayFormData?.avgScored) {
      awayProfile.attack = (awayProfile.attack + awayFormData.avgScored * 2.5) / 2;
    }

    const probs = calcProbabilities(homeProfile, awayProfile);
    const markets = calcBettingMarkets(probs, probs.hXG, probs.aXG, homeProfile, awayProfile);
    const bestBets = getBestBets(probs, markets, homeName, awayName);
    const insights = getInsights(probs, markets, probs.hXG, probs.aXG, homeProfile, awayProfile, homeName, awayName);
    const confidence = calcConfidence(homeProfile, awayProfile, probs);

    // Score prediction — use xG rounded, not always 1-1
    const homeGoals = Math.round(probs.hXG);
    const awayGoals = Math.round(probs.aXG);

    return {
      fixtureId: fixture.id,
      score: `${homeGoals}-${awayGoals}`,
      xG: { home: probs.hXG, away: probs.aXG },
      probabilities: {
        home: probs.home,
        draw: probs.draw,
        away: probs.away,
      },
      confidence,
      markets: [
        { id: 'result',  label: 'Match Result',     options: [
          { value: `${homeName} Win`, prob: probs.home,  tier: probs.home >= 58 ? 'high' : 'med' },
          { value: 'Draw',            prob: probs.draw,  tier: 'med' },
          { value: `${awayName} Win`, prob: probs.away,  tier: probs.away >= 52 ? 'high' : 'med' },
        ]},
        { id: 'goals',   label: 'Total Goals',      options: [
          { value: 'Over 2.5',        prob: markets.over25,  tier: markets.over25 >= 62 ? 'high' : 'med' },
          { value: 'Under 2.5',       prob: markets.under25, tier: markets.under25 >= 58 ? 'high' : 'med' },
          { value: 'Over 1.5',        prob: markets.over15,  tier: 'med' },
        ]},
        { id: 'btts',    label: 'Both Teams Score', options: [
          { value: 'Yes (BTTS)',       prob: markets.btts,    tier: markets.btts >= 62 ? 'high' : 'med' },
          { value: 'No',              prob: markets.nobtts,  tier: markets.nobtts >= 55 ? 'med' : 'low' },
        ]},
        { id: 'dc',      label: 'Double Chance',    options: [
          { value: `${homeName} or Draw`, prob: markets.dcHome, tier: markets.dcHome >= 70 ? 'high' : 'med' },
          { value: `${awayName} or Draw`, prob: markets.dcAway, tier: markets.dcAway >= 65 ? 'high' : 'med' },
        ]},
      ],
      bestBets,
      insights,
      generatedAt: new Date().toISOString(),
    };
  } catch (err) {
    logger.error('generatePrediction error:', err.message);
    throw err;
  }
}

module.exports = { generatePrediction };
