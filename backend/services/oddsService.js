const axios = require('axios');
const NodeCache = require('node-cache');
const logger = require('../utils/logger');
const cache = new NodeCache({ stdTTL: 600 });
const KEY = process.env.ODDS_API_KEY;
const BASE = 'https://api.the-odds-api.com/v4';
const SPORTS = [
  {key:'soccer_epl',name:'Premier League',flag:'🏴󠁧󠁢󠁥󠁮󠁧󠁿',lk:'pl'},
  {key:'soccer_spain_la_liga',name:'La Liga',flag:'🇪🇸',lk:'ll'},
  {key:'soccer_uefa_champs_league',name:'Champions League',flag:'⭐',lk:'cl'},
  {key:'soccer_germany_bundesliga',name:'Bundesliga',flag:'🇩🇪',lk:'bl'},
  {key:'soccer_italy_serie_a',name:'Serie A',flag:'🇮🇹',lk:'sa'},
  {key:'soccer_france_ligue_one',name:'Ligue 1',flag:'🇫🇷',lk:'l1'},
];
function prob(odd){return(!odd||odd<=1)?0:1/odd;}
function toFixture(m,s){
  const bm=m.bookmakers&&m.bookmakers[0];
  if(!bm)return null;
  const h2h=bm.markets&&bm.markets.find(function(x){return x.key==='h2h';});
  if(!h2h)return null;
  const ho=h2h.outcomes&&h2h.outcomes.find(function(o){return o.name===m.home_team;});
  const ao=h2h.outcomes&&h2h.outcomes.find(function(o){return o.name===m.away_team;});
  const dr=h2h.outcomes&&h2h.outcomes.find(function(o){return o.name==='Draw';});
  if(!ho||!ao||!dr)return null;
  const rh=prob(ho.price),rd=prob(dr.price),ra=prob(ao.price),tot=rh+rd+ra;
  const hp=Math.round(rh/tot*100),dp=Math.round(rd/tot*100),ap=100-hp-dp;
  const hxg=hp>=65?2.0:hp>=52?1.6:hp>=42?1.3:hp>=32?1.0:0.8;
  const axg=ap>=60?1.8:ap>=48?1.4:ap>=38?1.1:ap>=28?0.8:0.6;
  const score_h=hp>=65?2:hp>=50?1:hp>=38?1:0;
  const score_a=ap>=60?2:ap>=48?1:ap>=35?1:0;
  return{
    id:m.id,leagueKey:s.lk,leagueName:s.name,leagueFlag:s.flag,
    date:m.commence_time,
    time:new Date(m.commence_time).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',timeZone:'UTC'}),
    status:'NS',elapsed:null,
    home:{id:m.id+'_h',name:m.home_team,logo:null},
    away:{id:m.id+'_a',name:m.away_team,logo:null},
    goals:{home:null,away:null},
    oddsData:{
      bookmaker:bm.title,
      odds:{home:ho.price,draw:dr.price,away:ao.price},
      probabilities:{home:hp,draw:dp,away:ap},
      score:score_h+'-'+score_a,
      markets:{over25:null,under25:null,over15:null,bttsYes:null,bttsNo:null},
      xG:{home:hxg,away:axg},
    },
  };
}
async function fetchSport(s){
  const ck='odds:'+s.key;
  const c=cache.get(ck);
  if(c)return c;
  try{
    const r=await axios.get(BASE+'/sports/'+s.key+'/odds',{
      params:{apiKey:KEY,regions:'eu',markets:'h2h',oddsFormat:'decimal',dateFormat:'iso'},
      timeout:10000,
    });
    const d=r.data||[];
    logger.info(s.name+': '+d.length+' matches');
    if(d.length>0)cache.set(ck,d,600);
    return d;
  }catch(e){
    logger.error('OddsAPI '+s.key+': '+(e.response?JSON.stringify(e.response.data):e.message));
    return[];
  }
}
async function getFixturesByDateFromOdds(dateStr){
  const res=await Promise.allSettled(SPORTS.map(function(s){return fetchSport(s);}));
  const out=[];
  res.forEach(function(r,i){
    if(r.status!=='fulfilled')return;
    (r.value||[]).forEach(function(m){
      const d=new Date(m.commence_time).toISOString().split('T')[0];
      if(d!==dateStr)return;
      const f=toFixture(m,SPORTS[i]);
      if(f)out.push(f);
    });
  });
  out.sort(function(a,b){return new Date(a.date)-new Date(b.date);});
  logger.info('Fixtures for '+dateStr+': '+out.length);
  return out;
}
async function findOddsForFixture(h,a){
  const today=new Date().toISOString().split('T')[0];
  const fixtures=await getFixturesByDateFromOdds(today);
  const n=function(s){return s.toLowerCase().replace(/[^a-z0-9]/g,'');};
  const hn=n(h),an=n(a);
  const m=fixtures.find(function(f){
    return(n(f.home.name).includes(hn)||hn.includes(n(f.home.name)))&&
           (n(f.away.name).includes(an)||an.includes(n(f.away.name)));
  });
  return m?m.oddsData:null;
}
module.exports={getFixturesByDateFromOdds:getFixturesByDateFromOdds,findOddsForFixture:findOddsForFixture};
