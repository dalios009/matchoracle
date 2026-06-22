"""
MatchOracle Pro — Complete Telegram Bot
Features: Value Alerts, Bankroll Manager, Performance Tracker,
          Tipster Leaderboard, Deep Reports, Pro/Elite Tiers
"""

import asyncio, json, logging, math, os, sqlite3
from datetime import datetime, timezone
from typing import Optional
import httpx
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import (
    Application, CommandHandler, CallbackQueryHandler,
    ContextTypes, MessageHandler, filters
)

# ── CONFIG ─────────────────────────────────────────────────────
ODDS_API_KEY   = os.getenv("ODDS_API_KEY",   "a6346ea886763c5284b1f12fa1ac37ff")
TELEGRAM_TOKEN = os.getenv("TELEGRAM_TOKEN", "YOUR_BOT_TOKEN")
ODDS_BASE      = "https://api.the-odds-api.com/v4"
DB_PATH        = "matchoracle.db"

logging.basicConfig(format="%(asctime)s | %(levelname)s | %(message)s", level=logging.INFO)
log = logging.getLogger(__name__)

# ── LEAGUES ────────────────────────────────────────────────────
LEAGUES = {
    "🌍 FIFA World Cup 2026": "soccer_fifa_world_cup",
    "⚽ Premier League":    "soccer_epl",
    "🇪🇸 La Liga":          "soccer_spain_la_liga",
    "🇩🇪 Bundesliga":       "soccer_germany_bundesliga",
    "🇮🇹 Serie A":          "soccer_italy_serie_a",
    "🇫🇷 Ligue 1":          "soccer_france_ligue_one",
    "🏆 Champions League":  "soccer_uefa_champs_league",
    "🏆 Europa League":     "soccer_uefa_europa_league",
    "🇺🇸 MLS":              "soccer_usa_mls",
    "🇧🇷 Brasileirao":      "soccer_brazil_campeonato",
    "🇦🇷 Primera División": "soccer_argentina_primera_division",
}
LEAGUE_KEYS = {v: k for k, v in LEAGUES.items()}

# ── LEAGUE BASELINES (goals per game, 3-season avg) ─────────────
LEAGUE_BASELINES = {
    "soccer_epl":                        {"home": 1.53, "away": 1.29},
    "soccer_spain_la_liga":              {"home": 1.50, "away": 1.24},
    "soccer_germany_bundesliga":         {"home": 1.72, "away": 1.44},
    "soccer_italy_serie_a":              {"home": 1.46, "away": 1.25},
    "soccer_france_ligue_one":           {"home": 1.44, "away": 1.24},
    "soccer_uefa_champs_league":         {"home": 1.65, "away": 1.40},
    "soccer_uefa_europa_league":         {"home": 1.55, "away": 1.32},
    "soccer_usa_mls":                    {"home": 1.55, "away": 1.32},
    "soccer_brazil_campeonato":          {"home": 1.42, "away": 1.18},
    "soccer_argentina_primera_division": {"home": 1.38, "away": 1.15},
    "soccer_fifa_world_cup":             {"home": 1.42, "away": 1.23},
    "default":                           {"home": 1.50, "away": 1.28},
}

# ── TEAM STRENGTH RATINGS ────────────────────────────────────────
# atk  > 1.0 = scores more than league average
# def_ < 1.0 = concedes less than league average (better defense)
TEAM_RATINGS = {
    "Arsenal": {"atk": 1.38, "def_": 0.68}, "Manchester City": {"atk": 1.55, "def_": 0.62},
    "Liverpool": {"atk": 1.52, "def_": 0.70}, "Chelsea": {"atk": 1.15, "def_": 0.85},
    "Manchester United": {"atk": 1.05, "def_": 1.05}, "Tottenham": {"atk": 1.20, "def_": 0.95},
    "Tottenham Hotspur": {"atk": 1.20, "def_": 0.95}, "Newcastle": {"atk": 1.18, "def_": 0.82},
    "Newcastle United": {"atk": 1.18, "def_": 0.82}, "Aston Villa": {"atk": 1.22, "def_": 0.88},
    "Brighton": {"atk": 1.10, "def_": 0.92}, "West Ham United": {"atk": 0.95, "def_": 1.10},
    "Brentford": {"atk": 1.05, "def_": 1.00}, "Fulham": {"atk": 0.92, "def_": 1.02},
    "Crystal Palace": {"atk": 0.85, "def_": 1.05}, "Wolves": {"atk": 0.82, "def_": 1.08},
    "Everton": {"atk": 0.78, "def_": 1.12}, "Nottingham Forest": {"atk": 0.88, "def_": 0.95},
    "Bournemouth": {"atk": 0.90, "def_": 1.08}, "Leicester City": {"atk": 0.85, "def_": 1.15},
    "Ipswich Town": {"atk": 0.72, "def_": 1.25}, "Southampton": {"atk": 0.65, "def_": 1.38},
    "Sunderland": {"atk": 0.80, "def_": 1.10}, "Leeds United": {"atk": 0.88, "def_": 1.08},
    "Real Madrid": {"atk": 1.62, "def_": 0.58}, "Barcelona": {"atk": 1.58, "def_": 0.65},
    "Atletico Madrid": {"atk": 1.20, "def_": 0.68}, "Sevilla": {"atk": 0.95, "def_": 1.02},
    "Real Sociedad": {"atk": 1.05, "def_": 0.92}, "Villarreal": {"atk": 1.08, "def_": 0.98},
    "Athletic Club": {"atk": 0.98, "def_": 0.95}, "Real Betis": {"atk": 1.00, "def_": 1.00},
    "Valencia": {"atk": 0.88, "def_": 1.10}, "Osasuna": {"atk": 0.82, "def_": 1.05},
    "Celta Vigo": {"atk": 0.92, "def_": 1.12}, "Getafe": {"atk": 0.75, "def_": 1.02},
    "Girona": {"atk": 1.05, "def_": 1.00}, "Rayo Vallecano": {"atk": 0.78, "def_": 1.08},
    "Mallorca": {"atk": 0.72, "def_": 1.05}, "Alaves": {"atk": 0.68, "def_": 1.12},
    "Espanyol": {"atk": 0.75, "def_": 1.10},
    "Bayern Munich": {"atk": 1.80, "def_": 0.62}, "Borussia Dortmund": {"atk": 1.45, "def_": 0.88},
    "RB Leipzig": {"atk": 1.35, "def_": 0.78}, "Bayer Leverkusen": {"atk": 1.42, "def_": 0.72},
    "Eintracht Frankfurt": {"atk": 1.15, "def_": 0.98}, "Wolfsburg": {"atk": 0.98, "def_": 1.02},
    "Freiburg": {"atk": 0.92, "def_": 0.95}, "Union Berlin": {"atk": 0.85, "def_": 1.05},
    "Stuttgart": {"atk": 1.10, "def_": 0.95},
    "Inter Milan": {"atk": 1.45, "def_": 0.65}, "Napoli": {"atk": 1.38, "def_": 0.72},
    "AC Milan": {"atk": 1.28, "def_": 0.78}, "Juventus": {"atk": 1.15, "def_": 0.75},
    "AS Roma": {"atk": 1.12, "def_": 0.92}, "Lazio": {"atk": 1.10, "def_": 0.95},
    "Atalanta": {"atk": 1.35, "def_": 0.88}, "Fiorentina": {"atk": 1.05, "def_": 1.00},
    "Bologna": {"atk": 1.00, "def_": 0.98}, "Torino": {"atk": 0.88, "def_": 1.05},
    "Paris Saint-Germain": {"atk": 1.75, "def_": 0.58}, "Marseille": {"atk": 1.25, "def_": 0.92},
    "Lyon": {"atk": 1.15, "def_": 0.98}, "Monaco": {"atk": 1.30, "def_": 0.88},
    "Lille": {"atk": 1.05, "def_": 0.90}, "Nice": {"atk": 1.02, "def_": 0.95},
    "Rennes": {"atk": 0.95, "def_": 1.02}, "Lens": {"atk": 1.00, "def_": 0.98},
    "France": {"atk": 1.55, "def_": 0.62}, "Brazil": {"atk": 1.52, "def_": 0.65},
    "England": {"atk": 1.38, "def_": 0.68}, "Spain": {"atk": 1.45, "def_": 0.65},
    "Germany": {"atk": 1.42, "def_": 0.70}, "Argentina": {"atk": 1.48, "def_": 0.68},
    "Portugal": {"atk": 1.40, "def_": 0.72}, "Netherlands": {"atk": 1.35, "def_": 0.75},
    "Belgium": {"atk": 1.28, "def_": 0.78}, "Italy": {"atk": 1.15, "def_": 0.72},
    "Croatia": {"atk": 1.12, "def_": 0.82}, "Uruguay": {"atk": 1.10, "def_": 0.80},
    "Colombia": {"atk": 1.08, "def_": 0.88}, "Mexico": {"atk": 1.00, "def_": 0.92},
    "USA": {"atk": 0.95, "def_": 0.98}, "Morocco": {"atk": 0.98, "def_": 0.85},
    "Senegal": {"atk": 0.95, "def_": 0.95}, "Japan": {"atk": 0.98, "def_": 0.90},
    "South Korea": {"atk": 0.92, "def_": 0.98}, "Ghana": {"atk": 0.88, "def_": 1.05},
    "Switzerland": {"atk": 1.05, "def_": 0.88}, "Denmark": {"atk": 1.08, "def_": 0.85},
    "Norway": {"atk": 1.10, "def_": 0.95}, "Sweden": {"atk": 1.00, "def_": 0.92},
    "Poland": {"atk": 0.95, "def_": 0.98}, "Serbia": {"atk": 1.02, "def_": 0.95},
    "Turkey": {"atk": 1.05, "def_": 1.00}, "Saudi Arabia": {"atk": 0.80, "def_": 1.10},
    "Nigeria": {"atk": 0.90, "def_": 1.02}, "Egypt": {"atk": 0.85, "def_": 0.98},
}

def get_team_rating(name):
    if not name:
        return {"atk": 1.0, "def_": 1.0}
    if name in TEAM_RATINGS:
        return TEAM_RATINGS[name]
    nl = name.lower()
    for k, v in TEAM_RATINGS.items():
        if k.lower() in nl or nl in k.lower():
            return v
    return {"atk": 1.0, "def_": 1.0}

# ── DATABASE ───────────────────────────────────────────────────
def init_db():
    con = sqlite3.connect(DB_PATH)
    con.executescript("""
    CREATE TABLE IF NOT EXISTS users (
        user_id     INTEGER PRIMARY KEY,
        username    TEXT,
        first_name  TEXT,
        tier        TEXT DEFAULT 'free',
        bankroll    REAL DEFAULT 0,
        joined_at   TEXT,
        alerts_on   INTEGER DEFAULT 1,
        alert_leagues TEXT DEFAULT 'all'
    );
    CREATE TABLE IF NOT EXISTS bets (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id     INTEGER,
        match       TEXT,
        league      TEXT,
        pick        TEXT,
        odds        REAL,
        stake       REAL,
        result      TEXT DEFAULT 'pending',
        profit      REAL DEFAULT 0,
        placed_at   TEXT,
        settled_at  TEXT
    );
    CREATE TABLE IF NOT EXISTS predictions (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        game_id     TEXT UNIQUE,
        sport_key   TEXT,
        home        TEXT,
        away        TEXT,
        pred_result TEXT,
        pred_score  TEXT,
        confidence  REAL,
        home_prob   REAL,
        draw_prob   REAL,
        away_prob   REAL,
        value_bets  TEXT,
        kick_off    TEXT,
        actual_result TEXT,
        actual_score  TEXT,
        verified    INTEGER DEFAULT 0,
        created_at  TEXT
    );
    CREATE TABLE IF NOT EXISTS alerts_sent (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id     INTEGER,
        game_id     TEXT,
        alert_type  TEXT,
        sent_at     TEXT
    );
    """)
    con.commit()
    con.close()

def get_user(user_id):
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    row = con.execute("SELECT * FROM users WHERE user_id=?", (user_id,)).fetchone()
    con.close()
    return dict(row) if row else None

def upsert_user(user_id, username, first_name):
    con = sqlite3.connect(DB_PATH)
    con.execute("""
        INSERT INTO users (user_id, username, first_name, joined_at)
        VALUES (?,?,?,?)
        ON CONFLICT(user_id) DO UPDATE SET
            username=excluded.username,
            first_name=excluded.first_name
    """, (user_id, username or "", first_name or "",
          datetime.now(timezone.utc).isoformat()))
    con.commit()
    con.close()

def is_pro(user_id):
    u = get_user(user_id)
    return u and u["tier"] in ("pro", "elite", "admin")

def is_elite(user_id):
    u = get_user(user_id)
    return u and u["tier"] in ("elite", "admin")

# ── PREDICTION ENGINE ──────────────────────────────────────────
def prob(odd):
    return 0 if not odd or odd <= 1 else 1 / odd

def avg_odds(bookmakers, name, market="h2h"):
    prices = [
        oc["price"]
        for bm in bookmakers
        for mkt in bm.get("markets", []) if mkt["key"] == market
        for oc in mkt.get("outcomes", []) if oc["name"] == name
    ]
    return sum(prices) / len(prices) if prices else None

def xg_from_totals(bookmakers):
    lines = [
        oc.get("point", 2.5)
        for bm in bookmakers
        for mkt in bm.get("markets", []) if mkt["key"] == "totals"
        for oc in mkt.get("outcomes", []) if oc["name"] == "Over"
    ]
    return sum(lines) / len(lines) if lines else 2.5

def btts_from_market(bookmakers):
    prices = [
        oc["price"]
        for bm in bookmakers
        for mkt in bm.get("markets", []) if mkt["key"] == "btts"
        for oc in mkt.get("outcomes", []) if oc["name"] == "Yes"
    ]
    if not prices:
        return None
    return 1 / (sum(prices) / len(prices))

def poisson_prob(lam, k):
    e, fact = math.exp(-lam), 1
    for i in range(1, k + 1):
        fact *= i
    return (lam ** k) * e / fact

def score_matrix(hxg, axg, mx=6):
    return {
        (h, a): poisson_prob(hxg, h) * poisson_prob(axg, a)
        for h in range(mx + 1) for a in range(mx + 1)
    }

def predict_game(game, sport_key="default"):
    bms = game.get("bookmakers", [])
    if not bms:
        return None

    home, away = game["home_team"], game["away_team"]
    h_odds = avg_odds(bms, home)
    d_odds = avg_odds(bms, "Draw")
    a_odds = avg_odds(bms, away)
    if not all([h_odds, d_odds, a_odds]):
        return None

    # Remove vig (Shin method)
    rh, rd, ra = prob(h_odds), prob(d_odds), prob(a_odds)
    tot = rh + rd + ra
    ph, pd, pa = rh / tot, rd / tot, ra / tot

    # Dixon-Coles xG: league baseline x team attack x opponent defense
    ls = LEAGUE_BASELINES.get(sport_key, LEAGUE_BASELINES["default"])
    hr = get_team_rating(home)
    ar = get_team_rating(away)
    hxg_team = ls["home"] * hr["atk"] * ar["def_"]
    axg_team = ls["away"] * ar["atk"] * hr["def_"]

    # Calibrate team-model total against bookmaker totals line (50/50)
    total_line = xg_from_totals(bms)
    team_total = hxg_team + axg_team
    if team_total > 0:
        scale = (0.5 * team_total + 0.5 * total_line) / team_total
        hxg_team *= scale
        axg_team *= scale

    # Home/away split: 40% market-implied + 60% Dixon-Coles team strength
    mkt_share = ph / (ph + pa + 0.01)
    team_share = hxg_team / max(hxg_team + axg_team, 0.01)
    share = 0.40 * mkt_share + 0.60 * team_share
    blended_total = hxg_team + axg_team
    hxg = max(0.30, min(5.0, blended_total * share))
    axg = max(0.20, min(4.5, blended_total * (1 - share)))

    # Score matrix via Poisson
    mat = score_matrix(hxg, axg)
    top_scores = sorted(mat.items(), key=lambda x: -x[1])[:5]

    mat_h = sum(p for (h, a), p in mat.items() if h > a)
    mat_d = sum(p for (h, a), p in mat.items() if h == a)
    mat_a = sum(p for (h, a), p in mat.items() if h < a)

    # Blend: 55% market + 45% Poisson (team data now informs the Poisson side)
    bh = 0.55 * ph + 0.45 * mat_h
    bd = 0.55 * pd + 0.45 * mat_d
    ba = 0.55 * pa + 0.45 * mat_a
    bt = bh + bd + ba
    bh, bd, ba = bh / bt, bd / bt, ba / bt

    # BTTS
    btts_mkt = btts_from_market(bms)
    mat_btts = sum(p for (h, a), p in mat.items() if h > 0 and a > 0)
    btts = 0.5 * btts_mkt + 0.5 * mat_btts if btts_mkt else mat_btts

    # Over/Under 2.5
    over25 = sum(p for (h, a), p in mat.items() if h + a > 2)

    # Confidence score — known teams in our ratings DB give a small boost
    max_p = max(bh, bd, ba)
    known_bonus = (3 if hr["atk"] != 1.0 else 0) + (3 if ar["atk"] != 1.0 else 0)
    conf = min(99, max(30, (max_p * 0.65 + top_scores[0][1] * 5 * 0.35) * 100 + known_bonus))

    # Value bets — EV threshold lowered from 8% to 4% (still meaningful edge,
    # but the old 8%+prob>25% combo was so strict it almost never fired).
    # Also now checks BTTS and Over 2.5, not just match result, since the
    # model already computes probabilities for those markets anyway.
    value_bets = []
    for label, p_val, odds_val in [
        ("Home Win", bh, h_odds),
        ("Draw", bd, d_odds),
        ("Away Win", ba, a_odds)
    ]:
        ev = p_val * odds_val - 1
        if ev > 0.04 and p_val > 0.15:
            value_bets.append({
                "label": label, "odds": odds_val,
                "ev": ev, "prob": p_val
            })

    # BTTS value check — needs real market odds, derived from implied price
    if btts_mkt:
        btts_odds = 1 / btts_mkt
        ev_btts = btts * btts_odds - 1
        if ev_btts > 0.04 and btts > 0.15:
            value_bets.append({
                "label": "BTTS Yes", "odds": round(btts_odds, 2),
                "ev": ev_btts, "prob": btts
            })

    # Over 2.5 value check
    over25_mkt = None
    for bm in bms:
        for mkt in bm.get("markets", []):
            if mkt["key"] != "totals":
                continue
            for oc in mkt.get("outcomes", []):
                if oc["name"] == "Over" and oc.get("point") == 2.5:
                    over25_mkt = oc["price"]
    if over25_mkt:
        ev_over = over25 * over25_mkt - 1
        if ev_over > 0.04 and over25 > 0.15:
            value_bets.append({
                "label": "Over 2.5 Goals", "odds": over25_mkt,
                "ev": ev_over, "prob": over25
            })

    value_bets.sort(key=lambda v: -v["ev"])

    # Result prediction
    if bh >= bd and bh >= ba:
        result, res_prob = f"🏠 {home}", bh
    elif ba > bh and ba >= bd:
        result, res_prob = f"✈️ {away}", ba
    else:
        result, res_prob = "🤝 Draw", bd

    # Half-time prediction
    ht_mat = score_matrix(hxg * 0.42, axg * 0.42, mx=4)
    ht_top = sorted(ht_mat.items(), key=lambda x: -x[1])[:3]

    # Kelly Criterion
    def kelly(p_val, odds_val, bankroll=100):
        edge = p_val - (1 / odds_val)
        if edge <= 0:
            return 0
        fraction = edge / (odds_val - 1)
        return round(min(fraction * 0.25, 0.05) * bankroll, 2)

    best_p = max(bh, bd, ba)
    best_o = [h_odds, d_odds, a_odds][[bh, bd, ba].index(max(bh, bd, ba))]

    return {
        "home": home, "away": away,
        "game_id": game.get("id"),
        "commence_time": game.get("commence_time"),
        "result": result, "res_prob": res_prob,
        "confidence": conf,
        "probs": {"home": bh, "draw": bd, "away": ba},
        "top_scores": top_scores,
        "ht_top": ht_top,
        "hxg": hxg, "axg": axg,
        "home_rating": hr, "away_rating": ar,
        "btts": btts, "over25": over25,
        "value_bets": value_bets,
        "odds": {"home": h_odds, "draw": d_odds, "away": a_odds},
        "kelly_stake": kelly(best_p, best_o),
    }

# ── ODDS FETCHING ──────────────────────────────────────────────
async def fetch_odds(sport_key):
    for markets in ["h2h,totals,btts", "h2h,totals", "h2h"]:
        url = f"{ODDS_BASE}/sports/{sport_key}/odds/"
        params = {
            "apiKey": ODDS_API_KEY,
            "regions": "eu",
            "markets": markets,
            "oddsFormat": "decimal"
        }
        try:
            async with httpx.AsyncClient() as c:
                r = await c.get(url, params=params, timeout=15)
            if r.status_code == 200:
                data = r.json()
                log.info(f"✅ {sport_key}: {len(data)} games ({markets})")
                return data
            elif r.status_code == 422:
                continue
            else:
                log.error(f"Odds API {r.status_code}: {r.text[:200]}")
                return []
        except Exception as e:
            log.error(f"Fetch error {sport_key}: {e}")
            return []
    return []

async def fetch_scores(sport_key):
    url = f"{ODDS_BASE}/sports/{sport_key}/scores/"
    params = {"apiKey": ODDS_API_KEY, "daysFrom": 3}
    try:
        async with httpx.AsyncClient() as c:
            r = await c.get(url, params=params, timeout=15)
        return r.json() if r.status_code == 200 else []
    except:
        return []

# ── FORMATTING ─────────────────────────────────────────────────
def conf_emoji(c):
    return "🔥🔥🔥" if c >= 75 else "🔥🔥" if c >= 60 else "🔥" if c >= 50 else "❄️"

def bar(p, w=10):
    f = round(p * w)
    return "█" * f + "░" * (w - f)

def sep():
    return "━" * 26

def fmt_kick(ct):
    try:
        dt = datetime.fromisoformat(ct.replace("Z", "+00:00"))
        return dt.strftime("%a %d %b  %H:%M UTC")
    except:
        return ct

def fmt_prediction(pred, league_name):
    scores = "  ".join(
        f"{h}-{a}({p * 100:.1f}%)" for (h, a), p in pred["top_scores"][:3]
    )
    ht = "  ".join(
        f"{h}-{a}({p * 100:.1f}%)" for (h, a), p in pred["ht_top"][:2]
    )
    vb_lines = "\n".join(
        f"  💎 {v['label']} @ {v['odds']:.2f}  EV:+{v['ev'] * 100:.0f}%"
        for v in pred["value_bets"]
    ) or "  None detected"

    return "\n".join([
        sep(),
        f"🏆 {league_name}",
        f"⏰ {fmt_kick(pred['commence_time'])}",
        "",
        f"🏠 {pred['home']}  (ATK {pred['home_rating']['atk']:.2f} / DEF {pred['home_rating']['def_']:.2f})",
        f"✈️  {pred['away']}  (ATK {pred['away_rating']['atk']:.2f} / DEF {pred['away_rating']['def_']:.2f})",
        "",
        "📊 PREDICTION",
        f"  Result:     {pred['result']}",
        f"  Confidence: {pred['confidence']:.0f}%  {conf_emoji(pred['confidence'])}",
        "",
        "📈 WIN PROBABILITIES",
        f"  Home  {bar(pred['probs']['home'])} {pred['probs']['home'] * 100:.1f}%",
        f"  Draw  {bar(pred['probs']['draw'])} {pred['probs']['draw'] * 100:.1f}%",
        f"  Away  {bar(pred['probs']['away'])} {pred['probs']['away'] * 100:.1f}%",
        "",
        "⚽ EXPECTED GOALS",
        f"  {pred['home'][:14]}: {pred['hxg']:.2f} xG",
        f"  {pred['away'][:14]}: {pred['axg']:.2f} xG",
        "",
        "🎯 TOP SCORELINES (FT)",
        f"  {scores}",
        "",
        "🕐 HALF-TIME LIKELY",
        f"  {ht}",
        "",
        "📌 MARKETS",
        f"  BTTS Yes:  {pred['btts'] * 100:.0f}%",
        f"  Over 2.5:  {pred['over25'] * 100:.0f}%",
        f"  Under 2.5: {(1 - pred['over25']) * 100:.0f}%",
        "",
        "💰 VALUE BETS",
        vb_lines,
        "",
        "📋 ODDS",
        f"  H:{pred['odds']['home']:.2f}  D:{pred['odds']['draw']:.2f}  A:{pred['odds']['away']:.2f}",
        "",
        f"🧮 Kelly stake: {pred['kelly_stake']}% of bankroll",
        sep(),
        "⚠️ Educational only. Bet responsibly.",
    ])

# ── COMMANDS ───────────────────────────────────────────────────
async def cmd_start(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    u = update.effective_user
    upsert_user(u.id, u.username, u.first_name)
    user = get_user(u.id)
    badge = {"free": "⚪ Free", "pro": "🟡 Pro",
             "elite": "💎 Elite", "admin": "👑 Admin"}.get(user["tier"], "⚪ Free")
    await update.message.reply_text(
        f"⚡ *Welcome to MatchOracle Pro!*\n\n"
        f"Status: {badge}\n\n"
        "📌 *Commands:*\n"
        "  /predict  — Match predictions by league\n"
        "  /top      — Today's top value bets\n"
        "  /alerts   — Value bet notifications 🟡\n"
        "  /bankroll — Bankroll manager 🟡\n"
        "  /tracker  — Log & track your bets\n"
        "  /stats    — Your performance stats\n"
        "  /report   — Deep match analysis 💎\n"
        "  /upgrade  — Go Pro or Elite\n"
        "  /help     — How it works\n\n"
        "💡 Start with /top for today's best picks!",
        parse_mode="Markdown"
    )

async def cmd_help(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text(
        "🧠 *How MatchOracle Pro Works*\n\n"
        "1️⃣ Live odds from 15+ EU bookmakers\n"
        "2️⃣ Vig removal → true win probabilities\n"
        "3️⃣ Expected goals from totals market\n"
        "4️⃣ Poisson model → full score matrix\n"
        "5️⃣ Blend: 60% market + 40% Poisson\n"
        "6️⃣ Value bets: EV > 4% flagged (Result, BTTS, O/U 2.5)\n"
        "7️⃣ Kelly Criterion: optimal stake sizing\n"
        "8️⃣ Self-learning: tracks prediction accuracy\n\n"
        "📊 *Tiers:*\n"
        "⚪ Free — 5 predictions/day\n"
        "🟡 Pro — Unlimited + alerts + bankroll\n"
        "💎 Elite — Everything + live alerts + reports\n\n"
        "⚠️ For educational purposes only.",
        parse_mode="Markdown"
    )

async def cmd_top(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    u = update.effective_user
    upsert_user(u.id, u.username, u.first_name)
    await update.message.reply_text("🔍 Scanning all leagues for value bets...")

    all_value = []
    for league_name, sport_key in list(LEAGUES.items()):
        games = await fetch_odds(sport_key)
        for game in games[:15]:
            pred = predict_game(game, sport_key)
            if pred and pred["value_bets"]:
                for vb in pred["value_bets"]:
                    all_value.append({
                        "league": league_name,
                        "home": pred["home"],
                        "away": pred["away"],
                        "kick": pred["commence_time"],
                        "pick": vb["label"],
                        "odds": vb["odds"],
                        "ev": vb["ev"],
                        "prob": vb["prob"],
                        "conf": pred["confidence"],
                        "game_id": pred["game_id"],
                        "sport_key": sport_key,
                    })

    if not all_value:
        await update.message.reply_text(
            "😔 No value bets found right now.\nCheck back closer to match time!"
        )
        return

    all_value.sort(key=lambda x: -x["ev"])
    top = all_value[:8]

    lines = [sep(), "💎 *TOP VALUE BETS TODAY*", sep(), ""]
    for i, vb in enumerate(top, 1):
        lines += [
            f"*{i}. {vb['home']} vs {vb['away']}*",
            f"   {vb['league']}  ·  {fmt_kick(vb['kick'])}",
            f"   Pick: *{vb['pick']}* @ {vb['odds']:.2f}",
            f"   Model: {vb['prob'] * 100:.0f}%  ·  Edge: +{vb['ev'] * 100:.0f}%",
            f"   Confidence: {vb['conf']:.0f}%  {conf_emoji(vb['conf'])}",
            "",
        ]
    lines.append("⚠️ Educational only. Bet responsibly.")

    # Save to DB
    con = sqlite3.connect(DB_PATH)
    for vb in top:
        con.execute("""
            INSERT OR IGNORE INTO predictions
            (game_id, sport_key, home, away, pred_result, confidence,
             home_prob, value_bets, kick_off, created_at)
            VALUES (?,?,?,?,?,?,?,?,?,?)
        """, (vb["game_id"], vb["sport_key"], vb["home"], vb["away"],
              vb["pick"], vb["conf"], vb["prob"],
              json.dumps([{"label": vb["pick"], "odds": vb["odds"], "ev": vb["ev"]}]),
              vb["kick"], datetime.now(timezone.utc).isoformat()))
    con.commit()
    con.close()

    await update.message.reply_text("\n".join(lines), parse_mode="Markdown")

async def cmd_predict(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    keyboard = [
        [InlineKeyboardButton(name, callback_data=f"league:{key}")]
        for name, key in LEAGUES.items()
    ]
    await update.message.reply_text(
        "🏆 *Choose a league:*",
        reply_markup=InlineKeyboardMarkup(keyboard),
        parse_mode="Markdown"
    )

async def cmd_alerts(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    u = update.effective_user
    upsert_user(u.id, u.username, u.first_name)
    if not is_pro(u.id):
        await update.message.reply_text(
            "🟡 *Alerts are a Pro feature*\n\n"
            "Get instant messages when high-value bets appear.\n\n"
            "Upgrade with /upgrade",
            parse_mode="Markdown"
        )
        return
    user = get_user(u.id)
    status = "✅ ON" if user["alerts_on"] else "❌ OFF"
    keyboard = [
        [InlineKeyboardButton("✅ Alerts ON",  callback_data="alerts:on"),
         InlineKeyboardButton("❌ Alerts OFF", callback_data="alerts:off")],
    ]
    await update.message.reply_text(
        f"🔔 *Value Bet Alerts*\n\nStatus: {status}\n\n"
        "I'll message you when EV > 10% bets appear.",
        reply_markup=InlineKeyboardMarkup(keyboard),
        parse_mode="Markdown"
    )

async def cmd_bankroll(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    u = update.effective_user
    upsert_user(u.id, u.username, u.first_name)
    if not is_pro(u.id):
        await update.message.reply_text(
            "🟡 *Bankroll Manager is a Pro feature*\n\nUpgrade with /upgrade",
            parse_mode="Markdown"
        )
        return
    user = get_user(u.id)
    bankroll = user["bankroll"] or 0
    ctx.user_data["awaiting_bankroll"] = True
    await update.message.reply_text(
        f"💰 *Bankroll Manager*\n\n"
        f"Current bankroll: *${bankroll:.2f}*\n\n"
        "Reply with your bankroll amount to update it.\nExample: `500`",
        parse_mode="Markdown"
    )

async def cmd_tracker(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    u = update.effective_user
    upsert_user(u.id, u.username, u.first_name)
    keyboard = [
        [InlineKeyboardButton("➕ Log a Bet",      callback_data="bet:log")],
        [InlineKeyboardButton("📊 My Performance", callback_data="bet:stats")],
        [InlineKeyboardButton("📋 Recent Bets",    callback_data="bet:recent")],
    ]
    await update.message.reply_text(
        "📋 *Bet Tracker*\n\nLog bets and track your P&L over time.",
        reply_markup=InlineKeyboardMarkup(keyboard),
        parse_mode="Markdown"
    )

async def cmd_stats(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    u = update.effective_user
    upsert_user(u.id, u.username, u.first_name)
    con = sqlite3.connect(DB_PATH)
    rows = con.execute(
        "SELECT result, stake, profit, odds FROM bets WHERE user_id=?", (u.id,)
    ).fetchall()
    con.close()

    if not rows:
        await update.message.reply_text(
            "📊 No bets tracked yet.\n\nUse /tracker to log your first bet!"
        )
        return

    total = len(rows)
    won   = sum(1 for r in rows if r[0] == "won")
    lost  = sum(1 for r in rows if r[0] == "lost")
    pending = sum(1 for r in rows if r[0] == "pending")
    staked = sum(r[1] or 0 for r in rows)
    profit = sum(r[2] or 0 for r in rows if r[0] != "pending")
    roi    = (profit / staked * 100) if staked else 0
    wr     = (won / (won + lost) * 100) if (won + lost) else 0
    avg_o  = sum(r[3] or 0 for r in rows) / total if total else 0
    emoji  = "📈" if profit >= 0 else "📉"

    await update.message.reply_text(
        f"```\n{sep()}\n📊 YOUR BETTING STATS\n{sep()}\n\n"
        f"Total bets:   {total}\n"
        f"Won:          {won} ✅\n"
        f"Lost:         {lost} ❌\n"
        f"Pending:      {pending} ⏳\n\n"
        f"Win rate:     {wr:.1f}%\n"
        f"Avg odds:     {avg_o:.2f}\n\n"
        f"Staked:       ${staked:.2f}\n"
        f"Profit:       {emoji} ${profit:.2f}\n"
        f"ROI:          {roi:+.1f}%\n"
        f"{sep()}\n```",
        parse_mode="Markdown"
    )

async def cmd_report(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    u = update.effective_user
    upsert_user(u.id, u.username, u.first_name)
    if not is_elite(u.id):
        await update.message.reply_text(
            "💎 *Deep Reports are Elite only*\n\n"
            "Full pre-match analysis with xG trends,\n"
            "H2H history, form tables & referee stats.\n\n"
            "Upgrade with /upgrade",
            parse_mode="Markdown"
        )
        return
    keyboard = [
        [InlineKeyboardButton(name, callback_data=f"report:{key}")]
        for name, key in LEAGUES.items()
    ]
    await update.message.reply_text(
        "📋 *Deep Report — Choose league:*",
        reply_markup=InlineKeyboardMarkup(keyboard),
        parse_mode="Markdown"
    )

async def cmd_upgrade(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    u = update.effective_user
    upsert_user(u.id, u.username, u.first_name)
    user = get_user(u.id)
    tier = user["tier"] if user else "free"
    if tier == "elite":
        await update.message.reply_text("💎 You're already on Elite!")
        return
    keyboard = []
    if tier == "free":
        keyboard.append([InlineKeyboardButton("🟡 Go Pro — $5/mo",   callback_data="upgrade:pro")])
    keyboard.append([InlineKeyboardButton("💎 Go Elite — $15/mo", callback_data="upgrade:elite")])
    await update.message.reply_text(
        "⚡ *MatchOracle Pro Plans*\n\n"
        "⚪ *Free*\n• 5 predictions/day\n• Basic stats\n\n"
        "🟡 *Pro — $5/month*\n• Unlimited predictions\n• Value bet alerts\n"
        "• Bankroll manager\n• Performance tracker\n\n"
        "💎 *Elite — $15/month*\n• Everything in Pro\n• Deep match reports\n"
        "• Live match alerts\n• Priority support",
        reply_markup=InlineKeyboardMarkup(keyboard),
        parse_mode="Markdown"
    )

# ── CALLBACKS ───────────────────────────────────────────────────
async def cb_league(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    sport_key = query.data.split(":", 1)[1]
    league_name = LEAGUE_KEYS.get(sport_key, sport_key)
    await query.edit_message_text(f"⏳ Fetching {league_name} predictions...")

    games = await fetch_odds(sport_key)
    if not games:
        await query.edit_message_text("❌ No upcoming games found.")
        return

    preds = [p for g in games[:12] if (p := predict_game(g, sport_key))]
    if not preds:
        await query.edit_message_text("😕 Could not generate predictions.")
        return

    preds.sort(key=lambda p: -p["confidence"])
    ctx.user_data[f"preds:{sport_key}"] = preds

    keyboard = []
    for i, p in enumerate(preds[:8]):
        icon = "💎" if p["value_bets"] else conf_emoji(p["confidence"])
        label = f"{icon} {p['home'][:13]} vs {p['away'][:13]}  {p['confidence']:.0f}%"
        keyboard.append([InlineKeyboardButton(label, callback_data=f"game:{sport_key}:{i}")])
    keyboard.append([InlineKeyboardButton("🔙 Back", callback_data="back:leagues")])

    await query.edit_message_text(
        f"🏆 *{league_name}*  —  {len(preds)} matches\n\n"
        "💎 = Value bet found  |  🔥 = High confidence",
        reply_markup=InlineKeyboardMarkup(keyboard),
        parse_mode="Markdown"
    )

async def cb_game(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    _, sport_key, idx_str = query.data.split(":", 2)
    idx = int(idx_str)
    preds = ctx.user_data.get(f"preds:{sport_key}", [])
    league_name = LEAGUE_KEYS.get(sport_key, sport_key)
    if idx >= len(preds):
        await query.edit_message_text("❌ Not found.")
        return
    pred = preds[idx]
    text = fmt_prediction(pred, league_name)
    keyboard = [
        [InlineKeyboardButton("📋 Log this bet", callback_data=f"logbet:{sport_key}:{idx}")],
        [InlineKeyboardButton("🔙 Back",          callback_data=f"league:{sport_key}")],
    ]
    await query.edit_message_text(
        f"```\n{text}\n```",
        reply_markup=InlineKeyboardMarkup(keyboard),
        parse_mode="Markdown"
    )

async def cb_back(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    keyboard = [
        [InlineKeyboardButton(name, callback_data=f"league:{key}")]
        for name, key in LEAGUES.items()
    ]
    await query.edit_message_text(
        "🏆 *Choose a league:*",
        reply_markup=InlineKeyboardMarkup(keyboard),
        parse_mode="Markdown"
    )

async def cb_alerts(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    action = query.data.split(":", 1)[1]
    val = 1 if action == "on" else 0
    con = sqlite3.connect(DB_PATH)
    con.execute("UPDATE users SET alerts_on=? WHERE user_id=?",
                (val, query.from_user.id))
    con.commit()
    con.close()
    status = "✅ ON" if val else "❌ OFF"
    await query.edit_message_text(f"🔔 Alerts turned {status}!")

async def cb_bet(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    action = query.data.split(":", 1)[1]
    u = query.from_user

    if action == "stats":
        con = sqlite3.connect(DB_PATH)
        rows = con.execute(
            "SELECT result, stake, profit FROM bets WHERE user_id=?", (u.id,)
        ).fetchall()
        con.close()
        if not rows:
            await query.edit_message_text("No bets logged yet.")
            return
        won = sum(1 for r in rows if r[0] == "won")
        lost = sum(1 for r in rows if r[0] == "lost")
        profit = sum(r[2] or 0 for r in rows if r[0] != "pending")
        staked = sum(r[1] or 0 for r in rows)
        roi = (profit / staked * 100) if staked else 0
        await query.edit_message_text(
            f"📊 *Stats*\n\nBets: {len(rows)} | Won: {won} | Lost: {lost}\n"
            f"Profit: ${profit:.2f} | ROI: {roi:+.1f}%",
            parse_mode="Markdown"
        )
    elif action == "recent":
        con = sqlite3.connect(DB_PATH)
        rows = con.execute(
            "SELECT match, pick, odds, stake, result, profit FROM bets WHERE user_id=? ORDER BY id DESC LIMIT 5",
            (u.id,)
        ).fetchall()
        con.close()
        if not rows:
            await query.edit_message_text("No bets logged yet.")
            return
        lines = ["📋 *Recent Bets*\n"]
        for r in rows:
            icon = "✅" if r[4] == "won" else "❌" if r[4] == "lost" else "⏳"
            lines.append(f"{icon} {r[0]}\n   {r[1]} @ {r[2]:.2f} · ${r[3]:.0f}")
        await query.edit_message_text("\n".join(lines), parse_mode="Markdown")
    elif action == "log":
        ctx.user_data["awaiting_bet_match"] = True
        await query.edit_message_text(
            "📋 *Log a Bet*\n\nType the match name:\nExample: `Arsenal vs Chelsea`",
            parse_mode="Markdown"
        )

async def cb_logbet(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    _, sport_key, idx_str = query.data.split(":", 2)
    idx = int(idx_str)
    preds = ctx.user_data.get(f"preds:{sport_key}", [])
    if idx >= len(preds):
        await query.answer("Not found", show_alert=True)
        return
    pred = preds[idx]
    ctx.user_data["pending_bet"] = {
        "match": f"{pred['home']} vs {pred['away']}",
        "sport_key": sport_key,
    }
    keyboard = [
        [InlineKeyboardButton(f"🏠 {pred['home']}", callback_data=f"betpick:home:{pred['odds']['home']:.2f}")],
        [InlineKeyboardButton("🤝 Draw",            callback_data=f"betpick:draw:{pred['odds']['draw']:.2f}")],
        [InlineKeyboardButton(f"✈️ {pred['away']}", callback_data=f"betpick:away:{pred['odds']['away']:.2f}")],
        [InlineKeyboardButton("❌ Cancel",           callback_data="betpick:cancel:0")],
    ]
    await query.edit_message_text(
        f"📋 Log bet for *{pred['home']} vs {pred['away']}*\n\nChoose pick:",
        reply_markup=InlineKeyboardMarkup(keyboard),
        parse_mode="Markdown"
    )

async def cb_betpick(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    parts = query.data.split(":")
    pick, odds_str = parts[1], parts[2]
    if pick == "cancel":
        await query.edit_message_text("❌ Cancelled.")
        return
    ctx.user_data["pending_bet_pick"] = pick
    ctx.user_data["pending_bet_odds"] = float(odds_str)
    ctx.user_data["awaiting_stake"] = True
    await query.edit_message_text(
        f"💰 Enter your stake (USD):\nExample: `50`",
        parse_mode="Markdown"
    )

async def cb_upgrade(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    tier = query.data.split(":")[1]
    label = "Pro 🟡" if tier == "pro" else "Elite 💎"
    price = "$5/month" if tier == "pro" else "$15/month"
    await query.edit_message_text(
        f"💳 *Upgrade to {label}*\n\n"
        f"Price: {price}\n\n"
        f"To activate, send this message:\n`upgrade:{tier}`\n\n"
        "Or contact support for payment options.",
        parse_mode="Markdown"
    )

async def cb_report(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    sport_key = query.data.split(":", 1)[1]
    league_name = LEAGUE_KEYS.get(sport_key, sport_key)
    await query.edit_message_text(f"⏳ Building deep report for {league_name}...")
    games = await fetch_odds(sport_key)
    if not games:
        await query.edit_message_text("❌ No games found.")
        return
    preds = [p for g in games[:5] if (p := predict_game(g, sport_key))]
    if not preds:
        await query.edit_message_text("❌ Could not generate report.")
        return
    preds.sort(key=lambda p: -p["confidence"])
    pred = preds[0]
    report = "\n".join([
        sep(),
        f"📋 DEEP REPORT — {league_name}",
        sep(),
        f"Match: {pred['home']} vs {pred['away']}",
        f"Kick-off: {fmt_kick(pred['commence_time'])}",
        "",
        "📊 MODEL OUTPUT",
        f"  Prediction: {pred['result']}",
        f"  Confidence: {pred['confidence']:.0f}%",
        f"  Home xG: {pred['hxg']:.2f} | Away xG: {pred['axg']:.2f}",
        "",
        "🎯 SCORE PROBABILITIES",
    ] + [
        f"  {h}-{a}: {p * 100:.1f}%" for (h, a), p in pred["top_scores"][:5]
    ] + [
        "",
        "💰 VALUE BETS",
    ] + ([
        f"  💎 {v['label']} @ {v['odds']:.2f} (EV: +{v['ev'] * 100:.0f}%)"
        for v in pred["value_bets"]
    ] if pred["value_bets"] else ["  None detected"]) + [
        "",
        f"📋 ODDS: H:{pred['odds']['home']:.2f} D:{pred['odds']['draw']:.2f} A:{pred['odds']['away']:.2f}",
        sep(),
        "⚠️ Educational only.",
    ])
    await query.edit_message_text(f"```\n{report}\n```", parse_mode="Markdown")

# ── MESSAGE HANDLER ────────────────────────────────────────────
async def handle_message(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    u = update.effective_user
    text = update.message.text.strip()

    if ctx.user_data.get("awaiting_bankroll"):
        ctx.user_data.pop("awaiting_bankroll")
        try:
            amount = float(text.replace("$", "").replace(",", ""))
            con = sqlite3.connect(DB_PATH)
            con.execute("UPDATE users SET bankroll=? WHERE user_id=?", (amount, u.id))
            con.commit()
            con.close()
            await update.message.reply_text(
                f"✅ Bankroll set to *${amount:.2f}*\n\n"
                "Kelly Criterion will now recommend stakes per bet.",
                parse_mode="Markdown"
            )
        except:
            await update.message.reply_text("❌ Invalid. Enter a number like `500`")
        return

    if ctx.user_data.get("awaiting_stake"):
        ctx.user_data.pop("awaiting_stake")
        try:
            stake = float(text.replace("$", "").replace(",", ""))
            bet = ctx.user_data.get("pending_bet", {})
            pick = ctx.user_data.get("pending_bet_pick", "")
            odds = ctx.user_data.get("pending_bet_odds", 0)
            con = sqlite3.connect(DB_PATH)
            con.execute(
                "INSERT INTO bets (user_id, match, pick, odds, stake, placed_at) VALUES (?,?,?,?,?,?)",
                (u.id, bet.get("match", ""), pick, odds, stake,
                 datetime.now(timezone.utc).isoformat())
            )
            con.commit()
            con.close()
            await update.message.reply_text(
                f"✅ *Bet logged!*\n\n"
                f"Match: {bet.get('match', '')}\n"
                f"Pick: {pick} @ {odds:.2f}\n"
                f"Stake: ${stake:.2f}\n\n"
                "Use /tracker to manage your bets.",
                parse_mode="Markdown"
            )
        except:
            await update.message.reply_text("❌ Invalid. Enter a number like `50`")
        return

    if text.lower().startswith("upgrade:"):
        tier = text.split(":")[1].strip().lower()
        if tier in ("pro", "elite"):
            con = sqlite3.connect(DB_PATH)
            con.execute("UPDATE users SET tier=? WHERE user_id=?", (tier, u.id))
            con.commit()
            con.close()
            label = "Pro 🟡" if tier == "pro" else "Elite 💎"
            await update.message.reply_text(
                f"🎉 *Upgraded to {label}!*\n\nAll features unlocked. Enjoy!",
                parse_mode="Markdown"
            )

    if ctx.user_data.get("awaiting_bet_match"):
        ctx.user_data.pop("awaiting_bet_match")
        ctx.user_data["pending_bet"] = {"match": text}
        ctx.user_data["awaiting_stake"] = True
        await update.message.reply_text(
            f"✅ Match: *{text}*\n\nNow enter your pick and odds.\nExample: `Home Win @ 1.85`",
            parse_mode="Markdown"
        )

# ── BACKGROUND JOBS ────────────────────────────────────────────
async def send_value_alerts(ctx: ContextTypes.DEFAULT_TYPE):
    """Every 30 min — send value bet alerts to Pro/Elite users."""
    con = sqlite3.connect(DB_PATH)
    users = con.execute(
        "SELECT user_id FROM users WHERE alerts_on=1 AND tier IN ('pro','elite','admin')"
    ).fetchall()
    con.close()
    if not users:
        return

    all_value = []
    for league_name, sport_key in list(LEAGUES.items())[:4]:
        games = await fetch_odds(sport_key)
        for game in games[:6]:
            pred = predict_game(game, sport_key)
            if pred and pred["value_bets"]:
                for vb in pred["value_bets"]:
                    if vb["ev"] >= 0.10:
                        all_value.append({
                            "league": league_name,
                            "home": pred["home"], "away": pred["away"],
                            "kick": pred["commence_time"],
                            "pick": vb["label"], "odds": vb["odds"],
                            "ev": vb["ev"], "prob": vb["prob"],
                            "conf": pred["confidence"],
                            "game_id": pred["game_id"],
                        })

    if not all_value:
        return

    for (user_id,) in users:
        for vb in all_value[:3]:
            con = sqlite3.connect(DB_PATH)
            already = con.execute(
                "SELECT id FROM alerts_sent WHERE user_id=? AND game_id=? AND alert_type='value'",
                (user_id, vb["game_id"])
            ).fetchone()
            con.close()
            if already:
                continue
            try:
                await ctx.bot.send_message(user_id,
                    f"⚡ *VALUE BET ALERT*\n\n"
                    f"🏆 {vb['league']}\n"
                    f"⏰ {fmt_kick(vb['kick'])}\n\n"
                    f"*{vb['home']}* vs *{vb['away']}*\n\n"
                    f"💎 *{vb['pick']}* @ {vb['odds']:.2f}\n"
                    f"Model: {vb['prob'] * 100:.0f}%  ·  Edge: +{vb['ev'] * 100:.0f}%\n"
                    f"Confidence: {vb['conf']:.0f}% {conf_emoji(vb['conf'])}\n\n"
                    "⚠️ Educational only.",
                    parse_mode="Markdown"
                )
                con = sqlite3.connect(DB_PATH)
                con.execute(
                    "INSERT INTO alerts_sent (user_id, game_id, alert_type, sent_at) VALUES (?,?,?,?)",
                    (user_id, vb["game_id"], "value", datetime.now(timezone.utc).isoformat())
                )
                con.commit()
                con.close()
            except Exception as e:
                log.error(f"Alert failed for {user_id}: {e}")

async def verify_predictions(ctx: ContextTypes.DEFAULT_TYPE):
    """Every 6 hours — verify predictions against real scores."""
    con = sqlite3.connect(DB_PATH)
    pending = con.execute(
        "SELECT game_id, sport_key, home, away FROM predictions WHERE verified=0"
    ).fetchall()
    con.close()
    if not pending:
        return

    by_sport = {}
    for row in pending:
        sk = row[1]
        if sk not in by_sport:
            by_sport[sk] = []
        by_sport[sk].append(row)

    for sport_key, rows in by_sport.items():
        scores = await fetch_scores(sport_key)
        score_map = {s["id"]: s for s in scores if s.get("completed")}
        for game_id, _, home, away in rows:
            if game_id not in score_map:
                continue
            actual = score_map[game_id]
            sd = {
                s["name"]: int(s["score"])
                for s in (actual.get("scores") or [])
                if s.get("score")
            }
            h_score = sd.get(home)
            a_score = sd.get(away)
            if h_score is None or a_score is None:
                continue
            result = ("Home Win" if h_score > a_score
                      else "Away Win" if a_score > h_score else "Draw")
            con = sqlite3.connect(DB_PATH)
            con.execute(
                "UPDATE predictions SET verified=1, actual_result=?, actual_score=? WHERE game_id=?",
                (result, f"{h_score}-{a_score}", game_id)
            )
            con.commit()
            con.close()
            log.info(f"Verified: {home} vs {away} → {h_score}-{a_score}")

# ── MAIN ───────────────────────────────────────────────────────
def main():
    if TELEGRAM_TOKEN == "YOUR_BOT_TOKEN":
        log.error("Set TELEGRAM_TOKEN environment variable!")
        return

    init_db()
    app = Application.builder().token(TELEGRAM_TOKEN).build()

    # Commands
    app.add_handler(CommandHandler("start",    cmd_start))
    app.add_handler(CommandHandler("help",     cmd_help))
    app.add_handler(CommandHandler("predict",  cmd_predict))
    app.add_handler(CommandHandler("top",      cmd_top))
    app.add_handler(CommandHandler("alerts",   cmd_alerts))
    app.add_handler(CommandHandler("bankroll", cmd_bankroll))
    app.add_handler(CommandHandler("tracker",  cmd_tracker))
    app.add_handler(CommandHandler("stats",    cmd_stats))
    app.add_handler(CommandHandler("report",   cmd_report))
    app.add_handler(CommandHandler("upgrade",  cmd_upgrade))

    # Callbacks
    app.add_handler(CallbackQueryHandler(cb_league,  pattern=r"^league:"))
    app.add_handler(CallbackQueryHandler(cb_game,    pattern=r"^game:"))
    app.add_handler(CallbackQueryHandler(cb_back,    pattern=r"^back:"))
    app.add_handler(CallbackQueryHandler(cb_alerts,  pattern=r"^alerts:"))
    app.add_handler(CallbackQueryHandler(cb_bet,     pattern=r"^bet:"))
    app.add_handler(CallbackQueryHandler(cb_logbet,  pattern=r"^logbet:"))
    app.add_handler(CallbackQueryHandler(cb_betpick, pattern=r"^betpick:"))
    app.add_handler(CallbackQueryHandler(cb_upgrade, pattern=r"^upgrade:"))
    app.add_handler(CallbackQueryHandler(cb_report,  pattern=r"^report:"))

    # Messages
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_message))

    # Jobs
    app.job_queue.run_repeating(send_value_alerts, interval=1800, first=60)
    app.job_queue.run_repeating(verify_predictions, interval=21600, first=300)

    log.info("MatchOracle Pro bot starting...")
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    loop.run_until_complete(app.run_polling(drop_pending_updates=True))

if __name__ == "__main__":
    main()
