// ════════════════════════════════════════════════════════════
// teamRatings.js — Dixon-Coles style team strength database
// attack  > 1.0 = scores more than league average
// defense < 1.0 = concedes less than league average (better defense)
// ════════════════════════════════════════════════════════════

const LEAGUE_BASELINES = {
  soccer_epl:                        { home: 1.53, away: 1.29 },
  soccer_spain_la_liga:              { home: 1.50, away: 1.24 },
  soccer_germany_bundesliga:         { home: 1.72, away: 1.44 },
  soccer_italy_serie_a:              { home: 1.46, away: 1.25 },
  soccer_france_ligue_one:           { home: 1.44, away: 1.24 },
  soccer_uefa_champs_league:         { home: 1.65, away: 1.40 },
  soccer_uefa_europa_league:         { home: 1.55, away: 1.32 },
  soccer_netherlands_eredivisie:     { home: 1.78, away: 1.44 },
  soccer_portugal_primeira_liga:     { home: 1.55, away: 1.30 },
  soccer_usa_mls:                    { home: 1.55, away: 1.32 },
  soccer_mexico_ligamx:              { home: 1.48, away: 1.28 },
  soccer_brazil_campeonato:          { home: 1.42, away: 1.18 },
  soccer_argentina_primera_division: { home: 1.38, away: 1.15 },
  soccer_efl_champ:                  { home: 1.48, away: 1.22 },
  soccer_saudi_arabia_pro_league:    { home: 1.58, away: 1.35 },
  soccer_fifa_world_cup:             { home: 1.42, away: 1.23 },
  default:                           { home: 1.50, away: 1.28 },
};

const TEAM_RATINGS = {
  // Premier League
  'Arsenal':                  { atk: 1.38, def: 0.68 },
  'Manchester City':          { atk: 1.55, def: 0.62 },
  'Liverpool':                { atk: 1.52, def: 0.70 },
  'Chelsea':                  { atk: 1.15, def: 0.85 },
  'Manchester United':        { atk: 1.05, def: 1.05 },
  'Tottenham Hotspur':        { atk: 1.20, def: 0.95 },
  'Tottenham':                { atk: 1.20, def: 0.95 },
  'Newcastle United':         { atk: 1.18, def: 0.82 },
  'Newcastle':                { atk: 1.18, def: 0.82 },
  'Aston Villa':              { atk: 1.22, def: 0.88 },
  'Brighton':                 { atk: 1.10, def: 0.92 },
  'West Ham United':          { atk: 0.95, def: 1.10 },
  'Brentford':                { atk: 1.05, def: 1.00 },
  'Fulham':                   { atk: 0.92, def: 1.02 },
  'Crystal Palace':           { atk: 0.85, def: 1.05 },
  'Wolves':                   { atk: 0.82, def: 1.08 },
  'Wolverhampton Wanderers':  { atk: 0.82, def: 1.08 },
  'Everton':                  { atk: 0.78, def: 1.12 },
  'Nottingham Forest':        { atk: 0.88, def: 0.95 },
  'Bournemouth':              { atk: 0.90, def: 1.08 },
  'Leicester City':           { atk: 0.85, def: 1.15 },
  'Ipswich Town':             { atk: 0.72, def: 1.25 },
  'Southampton':              { atk: 0.65, def: 1.38 },
  'Sunderland':                { atk: 0.80, def: 1.10 },
  'Leeds United':              { atk: 0.88, def: 1.08 },
  // La Liga
  'Real Madrid':               { atk: 1.62, def: 0.58 },
  'Barcelona':                 { atk: 1.58, def: 0.65 },
  'Atletico Madrid':           { atk: 1.20, def: 0.68 },
  'Sevilla':                   { atk: 0.95, def: 1.02 },
  'Real Sociedad':             { atk: 1.05, def: 0.92 },
  'Villarreal':                { atk: 1.08, def: 0.98 },
  'Athletic Club':             { atk: 0.98, def: 0.95 },
  'Athletic Bilbao':           { atk: 0.98, def: 0.95 },
  'Real Betis':                { atk: 1.00, def: 1.00 },
  'Valencia':                  { atk: 0.88, def: 1.10 },
  'Osasuna':                   { atk: 0.82, def: 1.05 },
  'CA Osasuna':                { atk: 0.82, def: 1.05 },
  'Celta Vigo':                { atk: 0.92, def: 1.12 },
  'Getafe':                    { atk: 0.75, def: 1.02 },
  'Girona':                    { atk: 1.05, def: 1.00 },
  'Rayo Vallecano':            { atk: 0.78, def: 1.08 },
  'Mallorca':                  { atk: 0.72, def: 1.05 },
  'Alaves':                    { atk: 0.68, def: 1.12 },
  'Alavés':                    { atk: 0.68, def: 1.12 },
  'Espanyol':                  { atk: 0.75, def: 1.10 },
  // Bundesliga
  'Bayern Munich':             { atk: 1.80, def: 0.62 },
  'Borussia Dortmund':         { atk: 1.45, def: 0.88 },
  'RB Leipzig':                { atk: 1.35, def: 0.78 },
  'Bayer Leverkusen':          { atk: 1.42, def: 0.72 },
  'Eintracht Frankfurt':       { atk: 1.15, def: 0.98 },
  'Wolfsburg':                 { atk: 0.98, def: 1.02 },
  'Freiburg':                  { atk: 0.92, def: 0.95 },
  'Union Berlin':              { atk: 0.85, def: 1.05 },
  'Borussia Monchengladbach':  { atk: 1.02, def: 1.08 },
  'Stuttgart':                 { atk: 1.10, def: 0.95 },
  // Serie A
  'Inter Milan':                { atk: 1.45, def: 0.65 },
  'Napoli':                     { atk: 1.38, def: 0.72 },
  'AC Milan':                   { atk: 1.28, def: 0.78 },
  'Juventus':                   { atk: 1.15, def: 0.75 },
  'AS Roma':                    { atk: 1.12, def: 0.92 },
  'Lazio':                      { atk: 1.10, def: 0.95 },
  'Atalanta':                   { atk: 1.35, def: 0.88 },
  'Atalanta BC':                { atk: 1.35, def: 0.88 },
  'Fiorentina':                 { atk: 1.05, def: 1.00 },
  'Bologna':                    { atk: 1.00, def: 0.98 },
  'Torino':                     { atk: 0.88, def: 1.05 },
  // Ligue 1
  'Paris Saint-Germain':        { atk: 1.75, def: 0.58 },
  'Paris Saint Germain':        { atk: 1.75, def: 0.58 },
  'Marseille':                  { atk: 1.25, def: 0.92 },
  'Lyon':                       { atk: 1.15, def: 0.98 },
  'Monaco':                     { atk: 1.30, def: 0.88 },
  'Lille':                      { atk: 1.05, def: 0.90 },
  'Nice':                       { atk: 1.02, def: 0.95 },
  'Rennes':                     { atk: 0.95, def: 1.02 },
  'Lens':                       { atk: 1.00, def: 0.98 },
  // World Cup / International
  'France':                     { atk: 1.55, def: 0.62 },
  'Brazil':                     { atk: 1.52, def: 0.65 },
  'England':                    { atk: 1.38, def: 0.68 },
  'Spain':                      { atk: 1.45, def: 0.65 },
  'Germany':                    { atk: 1.42, def: 0.70 },
  'Argentina':                  { atk: 1.48, def: 0.68 },
  'Portugal':                   { atk: 1.40, def: 0.72 },
  'Netherlands':                { atk: 1.35, def: 0.75 },
  'Belgium':                    { atk: 1.28, def: 0.78 },
  'Italy':                      { atk: 1.15, def: 0.72 },
  'Croatia':                    { atk: 1.12, def: 0.82 },
  'Uruguay':                    { atk: 1.10, def: 0.80 },
  'Colombia':                   { atk: 1.08, def: 0.88 },
  'Mexico':                     { atk: 1.00, def: 0.92 },
  'USA':                        { atk: 0.95, def: 0.98 },
  'United States':              { atk: 0.95, def: 0.98 },
  'Austria':                    { atk: 1.05, def: 0.90 },
  'Switzerland':                { atk: 1.05, def: 0.88 },
  'Denmark':                    { atk: 1.08, def: 0.85 },
  'Norway':                     { atk: 1.10, def: 0.95 },
  'Sweden':                     { atk: 1.00, def: 0.92 },
  'Poland':                     { atk: 0.95, def: 0.98 },
  'Serbia':                     { atk: 1.02, def: 0.95 },
  'Turkey':                     { atk: 1.05, def: 1.00 },
  'Morocco':                    { atk: 0.98, def: 0.85 },
  'Senegal':                    { atk: 0.95, def: 0.95 },
  'Japan':                      { atk: 0.98, def: 0.90 },
  'South Korea':                { atk: 0.92, def: 0.98 },
  'Ghana':                      { atk: 0.88, def: 1.05 },
  'Algeria':                    { atk: 0.85, def: 1.02 },
  'Ecuador':                     { atk: 0.90, def: 1.00 },
  'Canada':                      { atk: 0.88, def: 1.05 },
  'Australia':                   { atk: 0.85, def: 1.08 },
  'Saudi Arabia':                { atk: 0.80, def: 1.10 },
  'Iran':                        { atk: 0.78, def: 1.08 },
  'Tunisia':                     { atk: 0.80, def: 1.05 },
  'Panama':                      { atk: 0.72, def: 1.12 },
  'Jordan':                      { atk: 0.70, def: 1.15 },
  'DR Congo':                    { atk: 0.75, def: 1.10 },
  'Nigeria':                     { atk: 0.90, def: 1.02 },
  'Egypt':                       { atk: 0.85, def: 0.98 },
  'Ivory Coast':                 { atk: 0.88, def: 1.00 },
  'Venezuela':                   { atk: 0.85, def: 1.05 },
  'Chile':                       { atk: 0.90, def: 1.00 },
  'Paraguay':                    { atk: 0.82, def: 1.05 },
  'Peru':                        { atk: 0.85, def: 1.02 },
  'New Zealand':                 { atk: 0.70, def: 1.18 },
  'Qatar':                       { atk: 0.68, def: 1.18 },
};

function getTeamRating(name) {
  if (!name) return { atk: 1.0, def: 1.0 };
  if (TEAM_RATINGS[name]) return TEAM_RATINGS[name];
  var nl = name.toLowerCase();
  var keys = Object.keys(TEAM_RATINGS);
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    if (k.toLowerCase().indexOf(nl) !== -1 || nl.indexOf(k.toLowerCase()) !== -1) {
      return TEAM_RATINGS[k];
    }
  }
  return { atk: 1.0, def: 1.0 };
}

function getLeagueBaseline(sportKey) {
  return LEAGUE_BASELINES[sportKey] || LEAGUE_BASELINES.default;
}

// ── CROSS-SOURCE NAME ALIASES ─────────────────────────────────────────────
// The Odds API, football-data.org, and FIFA's own branding don't always
// agree on team names — not just accents (which a simple normalize handles)
// but genuinely different spellings/conventions. These are real mismatches
// found in production, not hypothetical: "Türkiye" (FIFA's official name,
// used by football-data.org) vs "Turkey" (used by The Odds API) is the
// most common one. Without this table, matches involving these teams can
// never be found across sources — a substring check can't fix a different
// word entirely.
var NAME_ALIASES = {
  'turkiye': 'turkey',
  'koreasouth': 'southkorea',
  'koreadprepublic': 'northkorea',
  'usa': 'unitedstates',
  'ivorycoast': 'cotedivoire',
  'czechia': 'czechrepublic',
};

/**
 * Normalize a team name for cross-source matching: strip accents, lowercase,
 * remove non-letters, then apply known aliases so "Türkiye" and "Turkey"
 * (or "Ivory Coast" and "Côte d'Ivoire") resolve to the same canonical form.
 */
function normalizeTeamName(s) {
  var base = (s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // strip accents
    .toLowerCase()
    .replace(/[^a-z]/g, ''); // letters only
  return NAME_ALIASES[base] || base;
}

module.exports = { getTeamRating, getLeagueBaseline, normalizeTeamName, TEAM_RATINGS, LEAGUE_BASELINES };