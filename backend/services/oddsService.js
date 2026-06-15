const axios = require('axios');
const NodeCache = require('node-cache');
const logger = require('../utils/logger');

const cache = new NodeCache({ stdTTL: 600 });
const KEY = process.env.ODDS_API_KEY;
const BASE = 'https://api.the-odds-api.com/v4';

const SPORTS = [
  { key: 'soccer_epl',                name: 'Premier League',   flag: '🏴󠁧󠁢󠁥󠁮󠁧󠁿', lk: 'pl' },
  { key: 'soccer_spain_la_liga',      name: 'La Liga',          flag: '🇪🇸', lk: 'll' },
  { key: 'soccer_uefa_champs_league', name: 'Champions League', flag: '⭐', lk: 'cl' },
  { key: 'soccer_germany_bundesliga', name: 'Bundesliga',       flag: '🇩🇪', lk: 'bl' },
  { key: 'soccer_italy_serie_a',      name: 'Serie A',          flag: '🇮🇹', lk: 'sa' },
  { key: 'soccer_france_ligue_one',   name: 'Ligue 1',          flag: '🇫🇷', lk: 'l1' },
  { key: 'soccer_efl_champ',         name: 'Championship',     flag: '🏴󠁧󠁢󠁥󠁮󠁧󠁿', lk: 'ch' },
  { key: 'soccer_usa_mls',           name: 'MLS',              flag: '🇺🇸', lk: 'mls' },
  { key: 'soccer_fifa_world_cup', name: 'FIFA World Cup 2026', flag: '🌍', lk: 'wc' },
];
const LOGOS = {
  'Arsenal':'https://media.api-sports.io/football/teams/42.png',
  'Chelsea':'https://media.api-sports.io/football/teams/49.png',
  'Manchester City':'https://media.api-sports.io/football/teams/50.png',
  'Liverpool':'https://media.api-sports.io/football/teams/40.png',
  'Manchester United':'https://media.api-sports.io/football/teams/33.png',
  'Tottenham Hotspur':'https://media.api-sports.io/football/teams/47.png',
  'Newcastle United':'https://media.api-sports.io/football/teams/34.png',
  'Aston Villa':'https://media.api-sports.io/football/teams/66.png',
  'West Ham United':'https://media.api-sports.io/football/teams/48.png',
  'Brighton':'https://media.api-sports.io/football/teams/51.png',
  'Brentford':'https://media.api-sports.io/football/teams/55.png',
  'Fulham':'https://media.api-sports.io/football/teams/36.png',
  'Crystal Palace':'https://media.api-sports.io/football/teams/52.png',
  'Wolves':'https://media.api-sports.io/football/teams/39.png',
  'Everton':'https://media.api-sports.io/football/teams/45.png',
  'Nottingham Forest':'https://media.api-sports.io/football/teams/65.png',
  'Bournemouth':'https://media.api-sports.io/football/teams/35.png',
  'Burnley':'https://media.api-sports.io/football/teams/44.png',
  'Luton':'https://media.api-sports.io/football/teams/1359.png',
  'Sheffield United':'https://media.api-sports.io/football/teams/62.png',
  'Sunderland':'https://media.api-sports.io/football/teams/60.png',
  'Leeds United':'https://media.api-sports.io/football/teams/63.png',
  'Real Madrid':'https://media.api-sports.io/football/teams/541.png',
  'Barcelona':'https://media.api-sports.io/football/teams/529.png',
  'Atletico Madrid':'https://media.api-sports.io/football/teams/530.png',
  'Sevilla':'https://media.api-sports.io/football/teams/536.png',
  'Real Betis':'https://media.api-sports.io/football/teams/543.png',
  'Real Sociedad':'https://media.api-sports.io/football/teams/548.png',
  'Athletic Bilbao':'https://media.api-sports.io/football/teams/531.png',
  'Athletic Club':'https://media.api-sports.io/football/teams/531.png',
  'Villarreal':'https://media.api-sports.io/football/teams/533.png',
  'Valencia':'https://media.api-sports.io/football/teams/532.png',
  'Osasuna':'https://media.api-sports.io/football/teams/727.png',
  'CA Osasuna':'https://media.api-sports.io/football/teams/727.png',
  'Getafe':'https://media.api-sports.io/football/teams/546.png',
  'Celta Vigo':'https://media.api-sports.io/football/teams/538.png',
  'Girona':'https://media.api-sports.io/football/teams/547.png',
  'Rayo Vallecano':'https://media.api-sports.io/football/teams/728.png',
  'Alaves':'https://media.api-sports.io/football/teams/542.png',
  'Alavés':'https://media.api-sports.io/football/teams/542.png',
  'Espanyol':'https://media.api-sports.io/football/teams/540.png',
  'Mallorca':'https://media.api-sports.io/football/teams/798.png',
  'Bayern Munich':'https://media.api-sports.io/football/teams/157.png',
  'Borussia Dortmund':'https://media.api-sports.io/football/teams/165.png',
  'RB Leipzig':'https://media.api-sports.io/football/teams/173.png',
  'Bayer Leverkusen':'https://media.api-sports.io/football/teams/168.png',
  'Eintracht Frankfurt':'https://media.api-sports.io/football/teams/169.png',
  'Wolfsburg':'https://media.api-sports.io/football/teams/161.png',
  'Freiburg':'https://media.api-sports.io/football/teams/160.png',
  'Union Berlin':'https://media.api-sports.io/football/teams/182.png',
  'Paris Saint Germain':'https://media.api-sports.io/football/teams/85.png',
  'Marseille':'https://media.api-sports.io/football/teams/81.png',
  'Lyon':'https://media.api-sports.io/football/teams/80.png',
  'Monaco':'https://media.api-sports.io/football/teams/91.png',
  'Lille':'https://media.api-sports.io/football/teams/79.png',
  'Nice':'https://media.api-sports.io/football/teams/84.png',
  'Lens':'https://media.api-sports.io/football/teams/116.png',
  'Rennes':'https://media.api-sports.io/football/teams/94.png',
  'Nantes':'https://media.api-sports.io/football/teams/83.png',
  'Inter Milan':'https://media.api-sports.io/football/teams/505.png',
  'AC Milan':'https://media.api-sports.io/football/teams/489.png',
  'Juventus':'https://media.api-sports.io/football/teams/496.png',
  'Napoli':'https://media.api-sports.io/football/teams/492.png',
  'AS Roma':'https://media.api-sports.io/football/teams/497.png',
  'Lazio':'https://media.api-sports.io/football/teams/487.png',
  'Atalanta BC':'https://media.api-sports.io/football/teams/499.png',
  'Atalanta':'https://media.api-sports.io/football/teams/499.png',
  'Fiorentina':'https://media.api-sports.io/football/teams/502.png',
  'Bologna':'https://media.api-sports.io/football/teams/500.png',
  'Torino':'https://media.api-sports.io/football/teams/503.png',
  'Udinese':'https://media.api-sports.io/football/teams/494.png',
  'Sassuolo':'https://media.api-sports.io/football/teams/488.png',
  'Lecce':'https://media.api-sports.io/football/teams/867.png',
  'Cagliari':'https://media.api-sports.io/football/teams/490.png',
  'Genoa':'https://media.api-sports.io/football/teams/495.png',
};

function getLogo(name) {
  return LOGOS[name] || null;
}
function prob(odd) { return (!odd || odd <= 1) ? 0 : 1 / odd; }

function avgOdds(bookmakers, name, market) {
  var prices = [];
  bookmakers.forEach(function(bm) {
    (bm.markets || []).forEach(function(mkt) {
      if (mkt.key !== market) return;
      (mkt.outcomes || []).forEach(function(oc) {
        if (oc.name === name) prices.push(oc.price);
      });
    });
  });
  return prices.length ? prices.reduce(function(a,b){return a+b;},0)/prices.length : null;
}

function xgFromTotals(bookmakers) {
  var lines = [];
  bookmakers.forEach(function(bm) {
    (bm.markets || []).forEach(function(mkt) {
      if (mkt.key !== 'totals') return;
      (mkt.outcomes || []).forEach(function(oc) {
        if (oc.name === 'Over' && oc.point) lines.push(oc.point);
      });
    });
  });
  return lines.length ? lines.reduce(function(a,b){return a+b;},0)/lines.length : 2.5;
}

function bttsProb(bookmakers) {
  var prices = [];
  bookmakers.forEach(function(bm) {
    (bm.markets || []).forEach(function(mkt) {
      if (mkt.key !== 'btts') return;
      (mkt.outcomes || []).forEach(function(oc) {
        if (oc.name === 'Yes') prices.push(oc.price);
      });
    });
  });
  if (!prices.length) return null;
  var avg = prices.reduce(function(a,b){return a+b;},0)/prices.length;
  return 1/avg;
}

function poissonProb(lam, k) {
  var e = Math.exp(-lam), fact = 1;
  for (var i = 1; i <= k; i++) fact *= i;
  return Math.pow(lam, k) * e / fact;
}

function scoreMatrix(hxg, axg) {
  var matrix = {};
  for (var h = 0; h <= 6; h++) {
    for (var a = 0; a <= 6; a++) {
      matrix[h+'-'+a] = poissonProb(hxg, h) * poissonProb(axg, a);
    }
  }
  return matrix;
}

function buildPrediction(game, sport) {
  var bms = game.bookmakers || [];
  if (!bms.length) return null;

  var home = game.home_team;
  var away = game.away_team;

  var hOdds = avgOdds(bms, home, 'h2h');
  var dOdds = avgOdds(bms, 'Draw', 'h2h');
  var aOdds = avgOdds(bms, away, 'h2h');
  if (!hOdds || !dOdds || !aOdds) return null;

  // Remove vig (Shin method)
  var rh = prob(hOdds), rd = prob(dOdds), ra = prob(aOdds);
  var tot = rh + rd + ra;
  var pH = rh/tot, pD = rd/tot, pA = ra/tot;

  // xG from totals
  var totalLine = xgFromTotals(bms);
  var homeShare = pH/(pH+pA+0.01);
  homeShare = 0.4 + homeShare*0.3;
  var hxg = totalLine * homeShare;
  var axg = totalLine * (1-homeShare);

  // Score matrix
  var matrix = scoreMatrix(hxg, axg);
  var entries = Object.entries(matrix).sort(function(a,b){return b[1]-a[1];});
  var top3 = entries.slice(0,3);

  // Result probs from matrix
  var matH=0, matD=0, matA=0;
  Object.entries(matrix).forEach(function(e) {
    var parts = e[0].split('-');
    var h=parseInt(parts[0]), a=parseInt(parts[1]), p=e[1];
    if(h>a) matH+=p; else if(h===a) matD+=p; else matA+=p;
  });

  // Blend 60% market + 40% Poisson
  var bH = 0.6*pH + 0.4*matH;
  var bD = 0.6*pD + 0.4*matD;
  var bA = 0.6*pA + 0.4*matA;
  var bTot = bH+bD+bA;
  bH/=bTot; bD/=bTot; bA/=bTot;

  // BTTS
  var btts = bttsProb(bms);
  var matBtts = 0;
  Object.entries(matrix).forEach(function(e) {
    var parts = e[0].split('-');
    if(parseInt(parts[0])>0 && parseInt(parts[1])>0) matBtts+=e[1];
  });
  var bttsVal = btts ? 0.5*btts + 0.5*matBtts : matBtts;

  // Over/Under
  var over25 = 0;
  Object.entries(matrix).forEach(function(e) {
    var parts = e[0].split('-');
    if(parseInt(parts[0])+parseInt(parts[1])>2) over25+=e[1];
  });

  // Confidence
  var maxP = Math.max(bH,bD,bA);
  var topScoreP = top3[0][1];
  var conf = Math.min(99, Math.max(30, (maxP*0.65 + topScoreP*5*0.35)*100));

  // Value bets
  var valueBets = [];
  [['Home Win',bH,hOdds],['Draw',bD,dOdds],['Away Win',bA,aOdds]].forEach(function(v) {
    var ev = v[1]*v[2]-1;
    if(ev>0.08 && v[1]>0.25) valueBets.push(v[0]+' @ '+v[2].toFixed(2)+' (EV: +'+Math.round(ev*100)+'%)');
  });

  // Best bets for UI
  var bestBets = [
    { market:'Match Result', value: bH>=bA&&bH>=bD ? home+' Win' : bA>bH&&bA>=bD ? away+' Win' : 'Draw',
      prob: Math.round(Math.max(bH,bD,bA)*100), tier: conf>=65?'high':'med' },
    { market:'Both Teams Score', value:'Yes (BTTS)', prob:Math.round(bttsVal*100), tier:bttsVal>=0.55?'high':'med' },
    { market:'Over/Under', value:'Over 2.5', prob:Math.round(over25*100), tier:over25>=0.6?'high':'med' },
    { market:'Over/Under', value:'Under 2.5', prob:Math.round((1-over25)*100), tier:(1-over25)>=0.55?'med':'low' },
    { market:'Double Chance', value:bH>=bA?home+' or Draw':'Away or Draw',
      prob:Math.round((bH>=bA?bH+bD:bA+bD)*100), tier:'med' },
  ].filter(function(b){return b.prob>=45;}).sort(function(a,b){return b.prob-a.prob;}).slice(0,6);

  var scoreStr = top3[0][0];
  var scoreParts = scoreStr.split('-');

  return {
    id: game.id,
    leagueKey: sport.lk,
    leagueName: sport.name,
    leagueFlag: sport.flag,
    date: game.commence_time,
    time: new Date(game.commence_time).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',timeZone:'UTC'}),
    status: 'NS', elapsed: null,
    home: { id: game.id+'_h', name: home, logo: getLogo(home) },
    away: { id: game.id+'_a', name: away, logo: getLogo(away) },
    goals: { home: null, away: null },
    oddsData: {
      bookmaker: bms[0] ? bms[0].title : 'Bookmaker',
      odds: { home: hOdds, draw: dOdds, away: aOdds },
      probabilities: { home: Math.round(bH*100), draw: Math.round(bD*100), away: Math.round(bA*100) },
      score: scoreParts[0]+'-'+scoreParts[1],
      xG: { home: parseFloat(hxg.toFixed(2)), away: parseFloat(axg.toFixed(2)) },
      confidence: Math.round(conf),
      markets: {
        over25: Math.round(over25*100),
        under25: Math.round((1-over25)*100),
        over15: Math.min(90, Math.round(over25*100)+18),
        bttsYes: Math.round(bttsVal*100),
        bttsNo: 100-Math.round(bttsVal*100),
      },
      bestBets: bestBets,
      valueBets: valueBets,
      topScores: top3.map(function(e){return {score:e[0],prob:Math.round(e[1]*100*10)/10};}),
    },
  };
}

async function fetchSport(sport) {
  var ck = 'odds:'+sport.key;
  var c = cache.get(ck);
  if (c) return c;
  for (var i=0; i<3; i++) {
    var markets = ['h2h,totals,btts','h2h,totals','h2h'][i];
    try {
      var r = await axios.get(BASE+'/sports/'+sport.key+'/odds', {
        params: { apiKey: KEY, regions: 'eu', markets: markets, oddsFormat: 'decimal', dateFormat: 'iso' },
        timeout: 10000,
      });
      var d = r.data || [];
      logger.info(sport.name+' ('+markets+'): '+d.length+' games');
      if (d.length > 0) { cache.set(ck, d, 600); return d; }
      return d;
    } catch(e) {
      var msg = e.response ? JSON.stringify(e.response.data) : e.message;
      if (e.response && e.response.status === 422) { continue; }
      logger.error('OddsAPI '+sport.key+': '+msg);
      return [];
    }
  }
  return [];
}

async function getFixturesByDateFromOdds(dateStr) {
  var results = await Promise.allSettled(SPORTS.map(function(s){ return fetchSport(s); }));
  var out = [];
  results.forEach(function(r, i) {
    if (r.status !== 'fulfilled') return;
    (r.value || []).forEach(function(game) {
      var d = new Date(game.commence_time).toISOString().split('T')[0];
      if (d !== dateStr) return;
      var f = buildPrediction(game, SPORTS[i]);
      if (f) out.push(f);
    });
  });
  out.sort(function(a,b){ return new Date(a.date)-new Date(b.date); });
  logger.info('Fixtures+predictions for '+dateStr+': '+out.length);
  return out;
}

async function findOddsForFixture(h, a) {
  var today = new Date().toISOString().split('T')[0];
  var fixtures = await getFixturesByDateFromOdds(today);
  var n = function(s){ return s.toLowerCase().replace(/[^a-z0-9]/g,''); };
  var hn = n(h), an = n(a);
  var m = fixtures.find(function(f){
    return (n(f.home.name).includes(hn)||hn.includes(n(f.home.name))) &&
           (n(f.away.name).includes(an)||an.includes(n(f.away.name)));
  });
  return m ? m.oddsData : null;
}

module.exports = { getFixturesByDateFromOdds: getFixturesByDateFromOdds, findOddsForFixture: findOddsForFixture };
