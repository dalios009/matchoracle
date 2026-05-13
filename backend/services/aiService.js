const Anthropic = require('@anthropic-ai/sdk');
const NodeCache = require('node-cache');
const logger = require('../utils/logger');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const aiCache = new NodeCache({ stdTTL: 1800 });

const SYSTEM_PROMPT = `You are MatchOracle AI Scout — a sharp, data-driven football betting analyst.
Rules:
- Respond in 3-5 concise sentences max
- Always reference specific statistics provided
- Give ONE concrete recommended bet at the end
- Use percentages and numbers when available
- Be honest about uncertainty
- Plain text only, no markdown
- Never recommend risky accumulators unprompted
- Tone: professional but approachable`;

function buildMatchPrompt(fixture, prediction, homeForm, awayForm, h2hData) {
  return [
    `Match: ${fixture.home.name} vs ${fixture.away.name}`,
    `League: ${fixture.leagueName} | Date: ${fixture.date}`,
    ``,
    `FORM (last 5):`,
    `${fixture.home.name}: ${(homeForm?.form||[]).join('-')||'N/A'} | Avg scored: ${homeForm?.avgScored??'N/A'} | Avg conceded: ${homeForm?.avgConceded??'N/A'}`,
    `${fixture.away.name}: ${(awayForm?.form||[]).join('-')||'N/A'} | Avg scored: ${awayForm?.avgScored??'N/A'} | Avg conceded: ${awayForm?.avgConceded??'N/A'}`,
    ``,
    `PREDICTION:`,
    `Score: ${prediction.score} | xG: ${prediction.xG.home} - ${prediction.xG.away}`,
    `Win%: ${fixture.home.name} ${prediction.probabilities.home}% | Draw ${prediction.probabilities.draw}% | ${fixture.away.name} ${prediction.probabilities.away}%`,
    `Confidence: ${prediction.confidence}%`,
    ``,
    `TOP BETS:`,
    ...(prediction.bestBets||[]).map(b => `- ${b.market}: ${b.value} @ ${b.prob}%`),
    ``,
    h2hData ? `H2H: Avg goals ${h2hData.avgGoals} | BTTS ${h2hData.bttsCount}/${h2hData.matches?.length||0} | Over 2.5: ${h2hData.over25Count}/${h2hData.matches?.length||0}` : '',
  ].filter(Boolean).join('\n');
}

async function analyseMatch(fixture, prediction, homeForm, awayForm, h2hData) {
  const cKey = `ai:match:${fixture.id}`;
  const cached = aiCache.get(cKey);
  if (cached) return cached;

  const prompt = buildMatchPrompt(fixture, prediction, homeForm, awayForm, h2hData);
  logger.info(`[AI] Analysing: ${fixture.home.name} vs ${fixture.away.name}`);

  const message = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 300,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: `Analyse this match and give your best bet:\n\n${prompt}` }],
  });

  const text = message.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
  const result = { analysis: text, generatedAt: new Date().toISOString() };
  aiCache.set(cKey, result);
  return result;
}

async function askScout(question, todayMatches = []) {
  const matchContext = todayMatches.slice(0, 10).map(m =>
    `${m.home.name} vs ${m.away.name} (${m.leagueName}, ${m.time})`
  ).join('\n');

  const fullPrompt = `Today's matches:\n${matchContext || 'No matches available.'}\n\nUser question: ${question}`;
  logger.info(`[AI Scout] Question: "${question.slice(0, 80)}"`);

  const message = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 350,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: fullPrompt }],
  });

  return message.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
}

module.exports = { analyseMatch, askScout };
