const logger = require('../utils/logger');

function formScore(form = []) {
  if (!form.length) return 0.5;
  const weights = [0.4, 0.6, 0.8, 0.9, 1.0];
  const len = form.length;
  let score = 0, totalWeight = 0;
  form.slice(-5).forEach((result, i) => {
    const w = weights[Math.max(0, i + (5 - len))];
    if (result === 'W') score += 1.0 * w;
    else if (result === 'D') score += 0.4 * w;
    totalWeight += w;
  });
  return totalWeight > 0 ? score / totalWeight : 0.5;
}

function calculateWinProbability(homeForm, awayForm, h2hData) {
  const homeStrength = (formScore(homeForm?.form) * 0.35) +
    (Math.min(1, (parseFloat(homeForm?.avgScored) || 1.2) / 3) * 0.125) +
    (Math.max(0, 1 - (parseFloat(homeForm?.avgConceded) || 1.2) / 3) * 0.125) + 0.06;

  const awayStrength = (formScore(awayForm?.form) * 0.35) +
    (Math.min(1, (parseFloat(awayForm?.avgScored) || 1.0) / 3) * 0.125) +
    (Math.max(0, 1 - (parseFloat(awayForm?.avgConceded) || 1.3) / 3) * 0.125);

  let h2hAdjust = 0;
  if (h2hData?.matches?.length >= 2) {
    const total = h2hData.homeWins + h2hData.draws + h2hData.awayWins;
    if (total > 0) h2hAdjust = (h2hData.homeWins / total - 0.5) * 0.20;
  }

  const rawAdv = homeStrength - awayStrength + h2hAdjust + 0.06;
  return 1 / (1 + Math.exp(-rawAdv * 3));
}

function splitProbabilities(homeWinProb) {
  const evenness = 1 - Math.abs(homeWinProb - 0.5) * 2;
  const drawBase = 0.22 + evenness * 0.12;
  const remaining = 1 - drawBase;
  return {
    home: Math.round(homeWinProb * remaining * 100),
    draw: Math.round(drawBase * 100),
    away: Math.round((1 - homeWinProb) * remaining * 100),
  };
}

function predictScore(homeForm, awayForm) {
  const homeXG = Math.max(0.5, (parseFloat(homeForm?.avgScored) || 1.3) *
    (1 / Math.max(0.5, parseFloat(awayForm?.avgConceded) || 1.3)) * 1.1);
  const awayXG = Math.max(0.5, (parseFloat(awayForm?.avgScored) || 1.1) *
    (1 / Math.max(0.5, parseFloat(homeForm?.avgConceded) || 1.1)) * 0.9);
  return { home: Math.round(homeXG), away: Math.round(awayXG), homeXG: +homeXG.toFixed(2), awayXG: +awayXG.toFixed(2) };
}

function generateBetMarkets(probs, scoreData, homeForm, awayForm, h2hData) {
  const homeName = homeForm?.name || 'Home';
  const awayName = awayForm?.name || 'Away';
  const avgGoals = (scoreData.homeXG + scoreData.awayXG);
  const homeScoringRate = Math.min(0.95, (parseFloat(homeForm?.avgScored) || 1.3) / 2.5);
  const awayScoringRate = Math.min(0.95, (parseFloat(awayForm?.avgScored) || 1.1) / 2.5);
  const bttsProb = Math.round(homeScoringRate * awayScoringRate * 100);
  const h2hAvg = h2hData?.avgGoals || avgGoals;
  const over25Prob = Math.round(Math.min(85, Math.max(25, (h2hAvg > 2.5 ? 65 : h2hAvg > 2 ? 55 : 40) + (avgGoals - 2.5) * 10)));
  const dcHome = Math.min(92, probs.home + probs.draw);
  const dcAway = Math.min(92, probs.away + probs.draw);

  return [
    { id: 'match_result', label: 'Match Result', options: [
      { value: `${homeName} Win`, prob: probs.home, tier: probs.home >= 55 ? 'high' : 'med' },
      { value: 'Draw', prob: probs.draw, tier: 'med' },
      { value: `${awayName} Win`, prob: probs.away, tier: probs.away >= 55 ? 'high' : 'med' },
    ]},
    { id: 'btts', label: 'Both Teams Score', options: [
      { value: 'Yes (BTTS)', prob: bttsProb, tier: bttsProb >= 65 ? 'high' : 'med' },
      { value: 'No', prob: 100 - bttsProb, tier: 'med' },
    ]},
    { id: 'goals', label: 'Total Goals', options: [
      { value: 'Over 2.5', prob: over25Prob, tier: over25Prob >= 65 ? 'high' : 'med' },
      { value: 'Under 2.5', prob: 100 - over25Prob, tier: 'med' },
    ]},
    { id: 'double_chance', label: 'Double Chance', options: [
      { value: `${homeName} or Draw`, prob: dcHome, tier: dcHome >= 70 ? 'high' : 'med' },
      { value: `${awayName} or Draw`, prob: dcAway, tier: dcAway >= 70 ? 'high' : 'med' },
    ]},
  ];
}

function calcConfidence(homeForm, awayForm, h2hData, probs) {
  let c = 50;
  if (homeForm?.form?.length >= 4) c += 5;
  if (awayForm?.form?.length >= 4) c += 5;
  if (h2hData?.matches?.length >= 3) c += 8;
  c += (Math.max(probs.home, probs.draw, probs.away) - 33) * 0.8;
  if (homeForm?.form?.slice(-3).every(r => r === 'W')) c += 6;
  return Math.round(Math.min(88, Math.max(42, c)));
}

function generateInsights(homeForm, awayForm, h2hData, scoreData, probs) {
  const insights = [];
  const homeName = homeForm?.name || 'Home';
  const awayName = awayForm?.name || 'Away';

  if (homeForm?.form?.slice(-3).filter(r => r === 'W').length >= 2)
    insights.push({ icon: '🔥', text: `${homeName} in strong recent form.` });
  if (awayForm?.form?.slice(-3).filter(r => r === 'W').length >= 2)
    insights.push({ icon: '⚡', text: `${awayName} arriving in good shape.` });

  const avgGoals = scoreData.homeXG + scoreData.awayXG;
  if (avgGoals > 2.8)
    insights.push({ icon: '⚽', text: `High scoring game expected — ${avgGoals.toFixed(1)} total xG.` });
  else if (avgGoals < 2.0)
    insights.push({ icon: '🛡️', text: `Tight match expected — only ${avgGoals.toFixed(1)} combined xG.` });

  if (h2hData?.matches?.length >= 3) {
    const bttsRate = Math.round((h2hData.bttsCount / h2hData.matches.length) * 100);
    if (bttsRate >= 60)
      insights.push({ icon: '📊', text: `BTTS in ${bttsRate}% of last ${h2hData.matches.length} H2H meetings.` });
  }

  if (probs.home >= 58)
    insights.push({ icon: '📈', text: `Model gives home side a ${probs.home}% win probability.` });
  else if (probs.away >= 55)
    insights.push({ icon: '📈', text: `Away side projected at ${probs.away}% — strong away favourite.` });
  else
    insights.push({ icon: '⚖️', text: `Evenly matched — draw is genuine at ${probs.draw}%.` });

  return insights.slice(0, 4);
}

function generatePrediction(fixture, homeForm, awayForm, h2hData) {
  try {
    const homeWinProb = calculateWinProbability(homeForm, awayForm, h2hData);
    const probs = splitProbabilities(homeWinProb);
    const scoreData = predictScore(homeForm, awayForm);
    const markets = generateBetMarkets(probs, scoreData, homeForm, awayForm, h2hData);
    const confidence = calcConfidence(homeForm, awayForm, h2hData, probs);
    const insights = generateInsights(homeForm, awayForm, h2hData, scoreData, probs);
    const bestBets = markets
      .flatMap(m => m.options.map(o => ({ market: m.label, ...o })))
      .filter(o => o.prob >= 48 && o.tier !== 'low')
      .sort((a, b) => b.prob - a.prob)
      .slice(0, 6);
    return {
      fixtureId: fixture.id,
      score: `${scoreData.home}-${scoreData.away}`,
      xG: { home: scoreData.homeXG, away: scoreData.awayXG },
      probabilities: probs,
      confidence,
      markets,
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
