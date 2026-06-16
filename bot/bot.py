"""
Football Score Predictor - FINAL VERSION
- Python 3.14 compatible (event loop fix included)
- Dixon-Coles team ratings engine (realistic varied scores)
- FIFA World Cup 2026 support
- Self-learning from real results
"""

import asyncio
import json
import logging
import math
import os
from collections import defaultdict
from datetime import datetime, timezone
from typing import Optional

import httpx
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import (
    Application, CommandHandler, CallbackQueryHandler, ContextTypes,
)

# ─── CONFIG ──────────────────────────────────────────────────────────────────
ODDS_API_KEY   = os.environ.get("ODDS_API_KEY",   "a6346ea886763c5284b1f12fa1ac37ff")
TELEGRAM_TOKEN = os.environ.get("TELEGRAM_TOKEN", "")
ODDS_BASE      = "https://api.the-odds-api.com/v4"
LEARNING_FILE  = "learning_data.json"

logging.basicConfig(format="%(asctime)s | %(levelname)s | %(message)s", level=logging.INFO)
log = logging.getLogger(__name__)

# ─── LEAGUES ─────────────────────────────────────────────────────────────────
LEAGUES = {
    "🌍 FIFA World Cup 2026":  "soccer_fifa_world_cup",
    "🏆 Champions League":    "soccer_uefa_champs_league",
    "⚽ Premier League":      "soccer_epl",
    "🇪🇸 La Liga":            "soccer_spain_la_liga",
    "🇩🇪 Bundesliga":         "soccer_germany_bundesliga",
    "🇮🇹 Serie A":            "soccer_italy_serie_a",
    "🇫🇷 Ligue 1":            "soccer_france_ligue_one",
    "🇳🇱 Eredivisie":         "soccer_netherlands_eredivisie",
    "🇵🇹 Primeira Liga":      "soccer_portugal_primeira_liga",
    "🇺🇸 MLS":                "soccer_usa_mls",
    "🇲🇽 Liga MX":            "soccer_mexico_ligamx",
    "🇧🇷 Brasileirao":        "soccer_brazil_campeonato",
    "🇦🇷 Primera Division":   "soccer_argentina_primera_division",
    "🏴 Championship":        "soccer_efl_champ",
    "🇸🇦 Saudi Pro League":   "soccer_saudi_arabia_pro_league",
}

# ─── LEAGUE AVERAGES (goals per game) ────────────────────────────────────────
LEAGUE_STATS = {
    "soccer_epl":                        {"home": 1.53, "away": 1.29},
    "soccer_spain_la_liga":              {"home": 1.50, "away": 1.24},
    "soccer_germany_bundesliga":         {"home": 1.72, "away": 1.44},
    "soccer_italy_serie_a":              {"home": 1.46, "away": 1.25},
    "soccer_france_ligue_one":           {"home": 1.44, "away": 1.24},
    "soccer_uefa_champs_league":         {"home": 1.65, "away": 1.40},
    "soccer_netherlands_eredivisie":     {"home": 1.78, "away": 1.44},
    "soccer_portugal_primeira_liga":     {"home": 1.55, "away": 1.30},
    "soccer_usa_mls":                    {"home": 1.55, "away": 1.32},
    "soccer_mexico_ligamx":              {"home": 1.48, "away": 1.28},
    "soccer_brazil_campeonato":          {"home": 1.42, "away": 1.18},
    "soccer_argentina_primera_division": {"home": 1.38, "away": 1.15},
    "soccer_efl_champ":                  {"home": 1.48, "away": 1.22},
    "soccer_saudi_arabia_pro_league":    {"home": 1.58, "away": 1.35},
    "soccer_fifa_world_cup":             {"home": 1.42, "away": 1.23},
    "default":                           {"home": 1.50, "away": 1.28},
}

# ─── TEAM STRENGTH RATINGS ───────────────────────────────────────────────────
# attack  > 1.0 = scores more than league average
# defense < 1.0 = concedes less than league average (better defense)
TEAM_RATINGS = {
    # Premier League
    "Manchester City":     {"attack": 1.55, "defense": 0.62},
    "Arsenal":             {"attack": 1.38, "defense": 0.68},
    "Liverpool":           {"attack": 1.52, "defense": 0.70},
    "Chelsea":             {"attack": 1.15, "defense": 0.85},
    "Manchester United":   {"attack": 1.05, "defense": 1.05},
    "Tottenham":           {"attack": 1.20, "defense": 0.95},
    "Newcastle":           {"attack": 1.18, "defense": 0.82},
    "Aston Villa":         {"attack": 1.22, "defense": 0.88},
    "West Ham":            {"attack": 0.95, "defense": 1.10},
    "Brighton":            {"attack": 1.10, "defense": 0.92},
    "Brentford":           {"attack": 1.05, "defense": 1.00},
    "Fulham":              {"attack": 0.92, "defense": 1.02},
    "Crystal Palace":      {"attack": 0.85, "defense": 1.05},
    "Wolves":              {"attack": 0.82, "defense": 1.08},
    "Everton":             {"attack": 0.78, "defense": 1.12},
    "Nottingham Forest":   {"attack": 0.88, "defense": 0.95},
    "Bournemouth":         {"attack": 0.90, "defense": 1.08},
    "Leicester City":      {"attack": 0.85, "defense": 1.15},
    "Ipswich":             {"attack": 0.72, "defense": 1.25},
    "Southampton":         {"attack": 0.65, "defense": 1.38},
    # La Liga
    "Real Madrid":         {"attack": 1.62, "defense": 0.58},
    "Barcelona":           {"attack": 1.58, "defense": 0.65},
    "Atletico Madrid":     {"attack": 1.20, "defense": 0.68},
    "Sevilla":             {"attack": 0.95, "defense": 1.02},
    "Real Sociedad":       {"attack": 1.05, "defense": 0.92},
    "Villarreal":          {"attack": 1.08, "defense": 0.98},
    "Athletic Club":       {"attack": 0.98, "defense": 0.95},
    "Real Betis":          {"attack": 1.00, "defense": 1.00},
    "Valencia":            {"attack": 0.88, "defense": 1.10},
    "Osasuna":             {"attack": 0.82, "defense": 1.05},
    "Celta Vigo":          {"attack": 0.92, "defense": 1.12},
    "Getafe":              {"attack": 0.75, "defense": 1.02},
    # Bundesliga
    "Bayern Munich":       {"attack": 1.80, "defense": 0.62},
    "Borussia Dortmund":   {"attack": 1.45, "defense": 0.88},
    "RB Leipzig":          {"attack": 1.35, "defense": 0.78},
    "Bayer Leverkusen":    {"attack": 1.42, "defense": 0.72},
    "Eintracht Frankfurt": {"attack": 1.15, "defense": 0.98},
    "Wolfsburg":           {"attack": 0.98, "defense": 1.02},
    "Freiburg":            {"attack": 0.92, "defense": 0.95},
    "Union Berlin":        {"attack": 0.85, "defense": 1.05},
    # Serie A
    "Inter Milan":         {"attack": 1.45, "defense": 0.65},
    "Napoli":              {"attack": 1.38, "defense": 0.72},
    "AC Milan":            {"attack": 1.28, "defense": 0.78},
    "Juventus":            {"attack": 1.15, "defense": 0.75},
    "Roma":                {"attack": 1.12, "defense": 0.92},
    "Lazio":               {"attack": 1.10, "defense": 0.95},
    "Atalanta":            {"attack": 1.35, "defense": 0.88},
    "Fiorentina":          {"attack": 1.05, "defense": 1.00},
    # Ligue 1
    "Paris Saint-Germain": {"attack": 1.75, "defense": 0.58},
    "Marseille":           {"attack": 1.25, "defense": 0.92},
    "Lyon":                {"attack": 1.15, "defense": 0.98},
    "Monaco":              {"attack": 1.30, "defense": 0.88},
    "Lille":               {"attack": 1.05, "defense": 0.90},
    "Nice":                {"attack": 1.02, "defense": 0.95},
    # World Cup nations
    "France":              {"attack": 1.55, "defense": 0.62},
    "Brazil":              {"attack": 1.52, "defense": 0.65},
    "England":             {"attack": 1.38, "defense": 0.68},
    "Spain":               {"attack": 1.45, "defense": 0.65},
    "Germany":             {"attack": 1.42, "defense": 0.70},
    "Argentina":           {"attack": 1.48, "defense": 0.68},
    "Portugal":            {"attack": 1.40, "defense": 0.72},
    "Netherlands":         {"attack": 1.35, "defense": 0.75},
    "Belgium":             {"attack": 1.28, "defense": 0.78},
    "Italy":               {"attack": 1.15, "defense": 0.72},
    "Croatia":             {"attack": 1.12, "defense": 0.82},
    "Uruguay":             {"attack": 1.10, "defense": 0.80},
    "Colombia":            {"attack": 1.08, "defense": 0.88},
    "Mexico":              {"attack": 1.00, "defense": 0.92},
    "USA":                 {"attack": 0.95, "defense": 0.98},
    "Austria":             {"attack": 1.05, "defense": 0.90},
    "Morocco":             {"attack": 0.98, "defense": 0.85},
    "Senegal":             {"attack": 0.95, "defense": 0.95},
    "Japan":               {"attack": 0.98, "defense": 0.90},
    "South Korea":         {"attack": 0.92, "defense": 0.98},
    "Ghana":               {"attack": 0.88, "defense": 1.05},
    "Algeria":             {"attack": 0.85, "defense": 1.02},
    "Ecuador":             {"attack": 0.90, "defense": 1.00},
    "Canada":              {"attack": 0.88, "defense": 1.05},
    "Australia":           {"attack": 0.85, "defense": 1.08},
    "Saudi Arabia":        {"attack": 0.80, "defense": 1.10},
    "Iran":                {"attack": 0.78, "defense": 1.08},
    "Tunisia":             {"attack": 0.80, "defense": 1.05},
    "Panama":              {"attack": 0.72, "defense": 1.12},
    "Jordan":              {"attack": 0.70, "defense": 1.15},
    "DR Congo":            {"attack": 0.75, "defense": 1.10},
    "Cameroon":            {"attack": 0.82, "defense": 1.08},
    "Nigeria":             {"attack": 0.90, "defense": 1.02},
    "Egypt":               {"attack": 0.85, "defense": 0.98},
    "Ivory Coast":         {"attack": 0.88, "defense": 1.00},
    "Qatar":               {"attack": 0.68, "defense": 1.18},
    "Venezuela":           {"attack": 0.85, "defense": 1.05},
    "Chile":               {"attack": 0.90, "defense": 1.00},
    "Paraguay":            {"attack": 0.82, "defense": 1.05},
    "Bolivia":             {"attack": 0.72, "defense": 1.15},
    "Peru":                {"attack": 0.85, "defense": 1.02},
    "New Zealand":         {"attack": 0.70, "defense": 1.18},
    "Switzerland":         {"attack": 1.05, "defense": 0.88},
    "Denmark":             {"attack": 1.08, "defense": 0.85},
    "Sweden":              {"attack": 1.00, "defense": 0.92},
    "Poland":              {"attack": 0.95, "defense": 0.98},
    "Serbia":              {"attack": 1.02, "defense": 0.95},
    "Ukraine":             {"attack": 1.00, "defense": 0.98},
    "Turkey":              {"attack": 1.05, "defense": 1.00},
    "Czech Republic":      {"attack": 0.95, "defense": 1.00},
    "Hungary":             {"attack": 0.88, "defense": 1.05},
    "Slovakia":            {"attack": 0.88, "defense": 1.02},
    "Romania":             {"attack": 0.88, "defense": 1.05},
    "Scotland":            {"attack": 0.92, "defense": 1.02},
    "Wales":               {"attack": 0.90, "defense": 1.05},
    "Greece":              {"attack": 0.85, "defense": 1.05},
    "Norway":              {"attack": 1.10, "defense": 0.95},
}

def get_team_rating(name: str) -> dict:
    if name in TEAM_RATINGS:
        return TEAM_RATINGS[name]
    nl = name.lower()
    for k, v in TEAM_RATINGS.items():
        if k.lower() in nl or nl in k.lower():
            return v
    return {"attack": 1.0, "defense": 1.0}

# ─── LEARNING DATA ────────────────────────────────────────────────────────────
def load_learning() -> dict:
    if os.path.exists(LEARNING_FILE):
        try:
            with open(LEARNING_FILE, encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {
        "predictions": [],
        "accuracy_stats": {"total": 0, "correct_result": 0, "correct_goals_ft": 0},
        "odds_calibration": {
            "1.0-1.4": {"wins": 0, "total": 0},
            "1.4-1.8": {"wins": 0, "total": 0},
            "1.8-2.5": {"wins": 0, "total": 0},
            "2.5-4.0": {"wins": 0, "total": 0},
            "4.0+":    {"wins": 0, "total": 0},
        },
        "team_adjustments": {},
    }

def save_learning(data: dict):
    with open(LEARNING_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

# ─── API (sync, run in thread pool to avoid event loop conflicts) ─────────────
def _fetch_sync(url: str) -> Optional[list]:
    try:
        r = httpx.get(url, timeout=20)
        log.info("GET %s -> %s", url.split("?")[0], r.status_code)
        if r.status_code == 200:
            return r.json()
        log.error("API %s: %s", r.status_code, r.text[:200])
        return None
    except Exception as e:
        log.error("HTTP error: %s", e)
        return None

def fetch_odds_sync(sport_key: str) -> list:
    for markets in ["h2h,totals,btts", "h2h,totals", "h2h"]:
        url = (f"{ODDS_BASE}/sports/{sport_key}/odds/"
               f"?apiKey={ODDS_API_KEY}&regions=eu&markets={markets}&oddsFormat=decimal")
        data = _fetch_sync(url)
        if data is not None:
            log.info("Got %d games for %s", len(data), sport_key)
            return data
    return []

def fetch_scores_sync(sport_key: str, days: int = 4) -> list:
    url = (f"{ODDS_BASE}/sports/{sport_key}/scores/"
           f"?apiKey={ODDS_API_KEY}&daysFrom={days}")
    return _fetch_sync(url) or []

def fetch_active_sports_sync() -> list:
    url = f"{ODDS_BASE}/sports?apiKey={ODDS_API_KEY}"
    return _fetch_sync(url) or []

# ─── MATHS ────────────────────────────────────────────────────────────────────
def poisson(lam: float, k: int) -> float:
    lam = max(lam, 0.01)
    return (lam ** k) * math.exp(-lam) / math.factorial(k)

def score_matrix(hxg: float, axg: float, max_g: int = 7) -> dict:
    return {(h, a): poisson(hxg, h) * poisson(axg, a)
            for h in range(max_g + 1) for a in range(max_g + 1)}

def remove_vig(h: float, d: float, a: float) -> tuple:
    raw = [1/h, 1/d, 1/a]
    t = sum(raw)
    return raw[0]/t, raw[1]/t, raw[2]/t

def avg_price(bms: list, name: str, market: str = "h2h") -> Optional[float]:
    prices = [oc["price"]
              for bm in bms
              for mkt in bm.get("markets", []) if mkt["key"] == market
              for oc in mkt["outcomes"] if oc["name"] == name]
    return sum(prices) / len(prices) if prices else None

def totals_line(bms: list) -> Optional[float]:
    pts = [oc.get("point", 2.5)
           for bm in bms
           for mkt in bm.get("markets", []) if mkt["key"] == "totals"
           for oc in mkt["outcomes"] if oc["name"] == "Over" and "point" in oc]
    return sum(pts) / len(pts) if pts else None

def btts_market(bms: list) -> Optional[float]:
    prices = [oc["price"]
              for bm in bms
              for mkt in bm.get("markets", []) if mkt["key"] == "btts"
              for oc in mkt["outcomes"] if oc["name"].lower() in ("yes", "both teams to score")]
    return (1 / (sum(prices) / len(prices))) if prices else None

# ─── PREDICTION ENGINE ────────────────────────────────────────────────────────
def predict_game(game: dict, sport_key: str, learning: dict) -> Optional[dict]:
    bms = game.get("bookmakers", [])
    if not bms:
        return None

    home = game["home_team"]
    away = game["away_team"]

    h_odds = avg_price(bms, home)
    d_odds = avg_price(bms, "Draw")
    a_odds = avg_price(bms, away)
    if not all([h_odds, d_odds, a_odds]):
        return None

    # Market probabilities (vig removed)
    ph, pd, pa = remove_vig(h_odds, d_odds, a_odds)

    # League baseline
    ls = LEAGUE_STATS.get(sport_key, LEAGUE_STATS["default"])

    # Team ratings + learned adjustments
    hr = get_team_rating(home)
    ar = get_team_rating(away)
    adj = learning.get("team_adjustments", {})
    ha = adj.get(home, {"attack": 0.0, "defense": 0.0})
    aa = adj.get(away, {"attack": 0.0, "defense": 0.0})

    h_att = max(0.3, hr["attack"]  + ha.get("attack",  0.0))
    h_def = max(0.3, hr["defense"] + ha.get("defense", 0.0))
    a_att = max(0.3, ar["attack"]  + aa.get("attack",  0.0))
    a_def = max(0.3, ar["defense"] + aa.get("defense", 0.0))

    # Dixon-Coles expected goals
    hxg_model = ls["home"] * h_att * a_def
    axg_model = ls["away"] * a_att * h_def

    # Calibrate total with bookmaker totals line
    mkt_total = totals_line(bms)
    if mkt_total:
        model_total = hxg_model + axg_model
        if model_total > 0:
            scale = (0.5 * model_total + 0.5 * mkt_total) / model_total
            hxg_model *= scale
            axg_model *= scale

    # Blend home/away split: 40% market implied, 60% model
    mkt_home_share = ph / max(ph + pa, 0.001)
    mdl_home_share = hxg_model / max(hxg_model + axg_model, 0.001)
    home_share = 0.40 * mkt_home_share + 0.60 * mdl_home_share

    total_xg = hxg_model + axg_model
    hxg = max(0.30, min(5.0, total_xg * home_share))
    axg = max(0.20, min(4.5, total_xg * (1 - home_share)))

    # Score matrix
    mat    = score_matrix(hxg, axg)
    ht_mat = score_matrix(hxg * 0.42, axg * 0.42, max_g=4)

    top_scores = sorted(mat.items(),    key=lambda x: -x[1])[:6]
    ht_top     = sorted(ht_mat.items(), key=lambda x: -x[1])[:3]

    # Result probs from matrix
    mh = sum(p for (h, a), p in mat.items() if h > a)
    md = sum(p for (h, a), p in mat.items() if h == a)
    ma = sum(p for (h, a), p in mat.items() if h < a)

    # Blend: 55% market, 45% Poisson model
    bh = 0.55 * ph + 0.45 * mh
    bd = 0.55 * pd + 0.45 * md
    ba = 0.55 * pa + 0.45 * ma
    t  = bh + bd + ba
    bh /= t; bd /= t; ba /= t

    # BTTS
    bp    = btts_market(bms)
    mbtts = sum(p for (h, a), p in mat.items() if h > 0 and a > 0)
    btts  = (0.5 * bp + 0.5 * mbtts) if bp else mbtts

    over25 = sum(p for (h, a), p in mat.items() if h + a > 2)
    over35 = sum(p for (h, a), p in mat.items() if h + a > 3)

    # Result
    if bh >= bd and bh >= ba:
        result = "Home Win"; rp = bh
    elif ba > bh and ba > bd:
        result = "Away Win"; rp = ba
    else:
        result = "Draw"; rp = bd

    confidence = min(97, max(35, (rp * 0.60 + top_scores[0][1] * 6 * 0.40) * 100))

    # Value bets
    value_bets = []
    for label, prob, odds in [("Home Win", bh, h_odds), ("Draw", bd, d_odds), ("Away Win", ba, a_odds)]:
        ev = prob * odds - 1
        if ev > 0.05 and prob > 0.20:
            value_bets.append((label, odds, ev, prob))

    return {
        "home": home, "away": away,
        "commence_time": game.get("commence_time"),
        "result": result, "result_prob": rp, "confidence": confidence,
        "probs": {"home": bh, "draw": bd, "away": ba},
        "top_scores": top_scores, "ht_top": ht_top,
        "hxg": hxg, "axg": axg,
        "btts": btts, "over25": over25, "over35": over35,
        "value_bets": value_bets,
        "odds": {"home": h_odds, "draw": d_odds, "away": a_odds},
        "game_id": game.get("id"),
        "home_rating": hr, "away_rating": ar,
    }

# ─── FORMATTING ───────────────────────────────────────────────────────────────
def bar(p: float, w: int = 12) -> str:
    f = round(p * w)
    return "[" + "#" * f + "." * (w - f) + "]"

def conf_label(c: float) -> str:
    if c >= 78: return "VERY HIGH 5/5"
    if c >= 68: return "HIGH 4/5"
    if c >= 58: return "GOOD 3/5"
    if c >= 48: return "FAIR 2/5"
    return "LOW 1/5"

def conf_emoji(c: float) -> str:
    if c >= 75: return "🔥🔥🔥"
    if c >= 62: return "🔥🔥"
    if c >= 50: return "🔥"
    return "❄️"

def format_pred(pred: dict, league: str) -> str:
    ct = pred["commence_time"]
    try:
        dt = datetime.fromisoformat(ct.replace("Z", "+00:00"))
        kick = dt.strftime("%a %d %b  %H:%M UTC")
    except Exception:
        kick = ct

    scores_str = "  |  ".join(
        f"{h}-{a} ({p*100:.1f}%)" for (h, a), p in pred["top_scores"][:4]
    )
    ht_str = "  |  ".join(
        f"{h}-{a} ({p*100:.1f}%)" for (h, a), p in pred["ht_top"][:3]
    )

    vb_lines = ""
    for label, odds, ev, prob in pred["value_bets"]:
        vb_lines += f"\n  💎 {label} @ {odds:.2f}  EV +{ev:.0%}  ({prob*100:.0f}%)"
    if not vb_lines:
        vb_lines = "\n  None detected"

    hr = pred["home_rating"]
    ar = pred["away_rating"]
    c  = pred["confidence"]

    return "\n".join([
        "━━━━━━━━━━━━━━━━━━━━━━━━━━",
        f"🏆 {league}",
        f"⏰  {kick}",
        "",
        f"🏠 {pred['home']}",
        f"   ATK {hr['attack']:.2f}  DEF {hr['defense']:.2f}  xG {pred['hxg']:.2f}",
        "",
        f"✈️  {pred['away']}",
        f"   ATK {ar['attack']:.2f}  DEF {ar['defense']:.2f}  xG {pred['axg']:.2f}",
        "",
        f"📊 PREDICTION: {pred['result']}",
        f"   Confidence: {c:.0f}%  {conf_label(c)}  {conf_emoji(c)}",
        "",
        "📈 WIN PROBABILITIES",
        f"  Home  {bar(pred['probs']['home'])} {pred['probs']['home']*100:.1f}%",
        f"  Draw  {bar(pred['probs']['draw'])} {pred['probs']['draw']*100:.1f}%",
        f"  Away  {bar(pred['probs']['away'])} {pred['probs']['away']*100:.1f}%",
        "",
        "🎯 TOP SCORELINES (FT)",
        f"  {scores_str}",
        "",
        "🕐 HALF-TIME LIKELY",
        f"  {ht_str}",
        "",
        "📌 MARKETS",
        f"  BTTS Yes:  {pred['btts']*100:.0f}%",
        f"  Over 2.5:  {pred['over25']*100:.0f}%",
        f"  Over 3.5:  {pred['over35']*100:.0f}%",
        "",
        f"💰 VALUE BETS{vb_lines}",
        "",
        f"📋 ODDS  H:{pred['odds']['home']:.2f}  D:{pred['odds']['draw']:.2f}  A:{pred['odds']['away']:.2f}",
        "━━━━━━━━━━━━━━━━━━━━━━━━━━",
        "⚠️  Educational only — bet responsibly",
    ])

# ─── HANDLERS ────────────────────────────────────────────────────────────────
async def cmd_start(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text(
        "👋 Welcome to Football Score Predictor!\n\n"
        "I use real team ratings + Dixon-Coles model\n"
        "for realistic varied scoreline predictions.\n\n"
        "Commands:\n"
        "/predict  - Pick a league & get predictions\n"
        "/stats    - Accuracy & learning stats\n"
        "/debug    - Test API connection\n"
        "/help     - How it works"
    )

async def cmd_help(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text(
        "How predictions work:\n\n"
        "1. Real team ATK/DEF ratings per club\n"
        "2. Dixon-Coles: xG = league_avg x ATK x opp_DEF\n"
        "3. Totals market calibrates total goals\n"
        "4. Poisson matrix: all scorelines 0-0 to 7-7\n"
        "5. 55% bookmaker market + 45% Poisson blend\n"
        "6. BTTS market cross-checks goal distribution\n"
        "7. Value bets flagged when EV > 5%\n"
        "8. Self-learning: real results adjust team ratings\n\n"
        "For educational purposes only."
    )

async def cmd_debug(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text("Testing API connection...")
    loop = asyncio.get_event_loop()
    sports = await loop.run_in_executor(None, fetch_active_sports_sync)
    if not sports:
        await update.message.reply_text("API error — check your key or internet connection.")
        return
    active_soccer = [s["key"] for s in sports if isinstance(s, dict)
                     and s.get("active") and "soccer" in s.get("key", "")]
    await update.message.reply_text(
        f"API working!\n"
        f"Active soccer leagues: {len(active_soccer)}\n\n"
        f"Keys:\n" + "\n".join(active_soccer[:20])
    )

async def cmd_stats(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    learning = load_learning()
    s = learning["accuracy_stats"]
    total = s["total"]
    if total == 0:
        await update.message.reply_text("No history yet. Use /predict to start!")
        return
    acc = s["correct_result"] / total * 100
    text = (f"LEARNING STATS\n"
            f"Total tracked: {total}\n"
            f"Correct result: {s['correct_result']} ({acc:.1f}%)\n\n"
            "CALIBRATION\n")
    for bucket, stats in learning["odds_calibration"].items():
        if stats["total"] > 0:
            hit = stats["wins"] / stats["total"] * 100
            text += f"  {bucket}: {hit:.0f}%  ({stats['total']} bets)\n"
        else:
            text += f"  {bucket}: no data\n"
    adj = learning.get("team_adjustments", {})
    if adj:
        text += f"\nTeam corrections learned: {len(adj)}"
    await update.message.reply_text(text)

async def cmd_predict(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    keyboard = [[InlineKeyboardButton(name, callback_data=f"lg:{key}")]
                for name, key in LEAGUES.items()]
    await update.message.reply_text(
        "Choose a league:",
        reply_markup=InlineKeyboardMarkup(keyboard)
    )

async def cb_league(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()

    sport_key   = query.data.split(":", 1)[1]
    league_name = next((n for n, k in LEAGUES.items() if k == sport_key), sport_key)
    await query.edit_message_text(f"Fetching {league_name} odds...")

    loop  = asyncio.get_event_loop()
    games = await loop.run_in_executor(None, fetch_odds_sync, sport_key)

    if not games:
        await query.edit_message_text(
            f"No upcoming games for {league_name}.\n"
            "The season may be on break. Try another league."
        )
        return

    learning    = load_learning()
    predictions = []
    for game in games[:12]:
        pred = predict_game(game, sport_key, learning)
        if pred:
            predictions.append(pred)

    if not predictions:
        await query.edit_message_text("Could not build predictions. Try another league.")
        return

    predictions.sort(key=lambda p: -p["confidence"])

    for pred in predictions:
        record = {
            "id": pred["game_id"], "sport": sport_key,
            "home": pred["home"], "away": pred["away"],
            "predicted_result": pred["result"],
            "predicted_ft": list(pred["top_scores"][0][0]),
            "confidence": pred["confidence"],
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "verified": False, "actual_result": None,
        }
        if not any(r["id"] == record["id"] for r in learning["predictions"]):
            learning["predictions"].append(record)
    save_learning(learning)

    ctx.user_data[f"preds:{sport_key}"] = predictions
    ctx.user_data[f"lname:{sport_key}"] = league_name

    keyboard = []
    for i, pred in enumerate(predictions[:8]):
        top  = pred["top_scores"][0][0]
        conf = pred["confidence"]
        icon = "🔥" if conf >= 68 else ("⭐" if conf >= 55 else "❄️")
        label = f"{icon} {pred['home'][:13]} vs {pred['away'][:13]}  [{top[0]}-{top[1]}] {conf:.0f}%"
        keyboard.append([InlineKeyboardButton(label, callback_data=f"gm:{sport_key}:{i}")])
    keyboard.append([InlineKeyboardButton("🔙 Back to leagues", callback_data="back")])

    await query.edit_message_text(
        f"{league_name} — {len(predictions)} matches\nTap a match for full analysis:",
        reply_markup=InlineKeyboardMarkup(keyboard)
    )

async def cb_game(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()

    _, sport_key, idx_str = query.data.split(":", 2)
    idx         = int(idx_str)
    predictions = ctx.user_data.get(f"preds:{sport_key}", [])
    league_name = ctx.user_data.get(f"lname:{sport_key}", "")

    if idx >= len(predictions):
        await query.edit_message_text("Prediction not found.")
        return

    text     = format_pred(predictions[idx], league_name)
    keyboard = [[InlineKeyboardButton("🔙 Back to matches", callback_data=f"lg:{sport_key}")]]
    await query.edit_message_text(text, reply_markup=InlineKeyboardMarkup(keyboard))

async def cb_back(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    keyboard = [[InlineKeyboardButton(name, callback_data=f"lg:{key}")]
                for name, key in LEAGUES.items()]
    await query.edit_message_text("Choose a league:", reply_markup=InlineKeyboardMarkup(keyboard))

# ─── BACKGROUND LEARNING ──────────────────────────────────────────────────────
async def periodic_learning(context: ContextTypes.DEFAULT_TYPE):
    learning = load_learning()
    pending  = [p for p in learning["predictions"] if not p.get("verified")]
    if not pending:
        return

    by_sport = defaultdict(list)
    for p in pending:
        by_sport[p["sport"]].append(p)

    updated = False
    loop    = asyncio.get_event_loop()

    for sport_key, preds in by_sport.items():
        scores    = await loop.run_in_executor(None, fetch_scores_sync, sport_key, 4)
        score_map = {s["id"]: s for s in scores if s.get("completed")}

        for pred in preds:
            if pred["id"] not in score_map:
                continue
            actual = score_map[pred["id"]]
            sd     = {s["name"]: int(s["score"])
                      for s in (actual.get("scores") or []) if s.get("score")}
            hs = sd.get(pred["home"])
            as_ = sd.get(pred["away"])
            if hs is None or as_ is None:
                continue

            act    = "Home Win" if hs > as_ else ("Away Win" if as_ > hs else "Draw")
            correct = act.lower() in pred["predicted_result"].lower()

            s = learning["accuracy_stats"]
            s["total"] += 1
            if correct:
                s["correct_result"] += 1
            pft = pred.get("predicted_ft", [0, 0])
            if abs((pft[0] + pft[1]) - (hs + as_)) <= 1:
                s["correct_goals_ft"] += 1

            # Update team ratings from real errors
            adj = learning.setdefault("team_adjustments", {})
            for team, scored, conceded in [(pred["home"], hs, as_), (pred["away"], as_, hs)]:
                t   = adj.setdefault(team, {"attack": 0.0, "defense": 0.0})
                exp_scored    = pft[0] if team == pred["home"] else pft[1]
                exp_conceded  = pft[1] if team == pred["home"] else pft[0]
                t["attack"]  = max(-0.35, min(0.35, t["attack"]  + (scored   - exp_scored)   * 0.02))
                t["defense"] = max(-0.35, min(0.35, t["defense"] + (conceded - exp_conceded) * 0.02))

            conf   = pred.get("confidence", 50)
            bucket = ("1.0-1.4" if conf >= 78 else "1.4-1.8" if conf >= 65
                      else "1.8-2.5" if conf >= 52 else "2.5-4.0" if conf >= 40 else "4.0+")
            learning["odds_calibration"][bucket]["total"] += 1
            if correct:
                learning["odds_calibration"][bucket]["wins"] += 1

            pred["verified"]      = True
            pred["actual_result"] = f"{hs}-{as_}"
            updated = True
            log.info("Verified %s vs %s: pred=%s actual=%s-%s ok=%s",
                     pred["home"], pred["away"], pred["predicted_result"], hs, as_, correct)

    if updated:
        save_learning(learning)
        log.info("Learning saved.")

# ─── MAIN ────────────────────────────────────────────────────────────────────
def main():
    if not TELEGRAM_TOKEN:
        log.error("TELEGRAM_TOKEN not set!")
        return

    app = Application.builder().token(TELEGRAM_TOKEN).build()

    app.add_handler(CommandHandler("start",   cmd_start))
    app.add_handler(CommandHandler("help",    cmd_help))
    app.add_handler(CommandHandler("predict", cmd_predict))
    app.add_handler(CommandHandler("stats",   cmd_stats))
    app.add_handler(CommandHandler("debug",   cmd_debug))
    app.add_handler(CallbackQueryHandler(cb_league, pattern=r"^lg:"))
    app.add_handler(CallbackQueryHandler(cb_game,   pattern=r"^gm:"))
    app.add_handler(CallbackQueryHandler(cb_back,   pattern=r"^back$"))

    app.job_queue.run_repeating(periodic_learning, interval=21600, first=300)

    log.info("Bot is running...")

    # Python 3.14 fix: create event loop explicitly
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    loop.run_until_complete(app.run_polling(drop_pending_updates=True))


if __name__ == "__main__":
    main()
