# ⚽ Football Score Predictor – Telegram Bot

## Setup in 3 steps

### Step 1 – Get a Telegram Bot Token
1. Open Telegram, search **@BotFather**
2. Send `/newbot` → follow prompts → copy your token

### Step 2 – Install dependencies
```bash
pip install -r requirements.txt
```

### Step 3 – Run the bot
```bash
export TELEGRAM_TOKEN="your_telegram_bot_token_here"
export ODDS_API_KEY="a6346ea886763c5284b1f12fa1ac37ff"
python bot.py
```

---

## Bot Commands
| Command | Description |
|---------|-------------|
| `/predict` | Pick a league → pick a match → full analysis |
| `/stats` | View accuracy stats & learning calibration |
| `/help` | How the engine works |

---

## Prediction Engine Features

| Feature | Description |
|---------|-------------|
| **Vig removal** | Shin method strips bookmaker margin for true odds |
| **Poisson model** | Full score matrix (0-0 to 6-6) |
| **xG estimation** | Reverse-engineered from totals market |
| **BTTS cross-check** | Both Teams to Score market validates goal expectations |
| **Market blend** | 60% market consensus + 40% Poisson |
| **Value bets** | Expected value > 5% flagged automatically |
| **Self-learning** | Bot checks real scores every 6 hours, updates calibration |
| **Confidence score** | 0-99% based on result certainty + score certainty |

---

## Keep it running 24/7 (optional)

**On Linux/VPS using screen:**
```bash
screen -S footballbot
python bot.py
# Ctrl+A then D to detach
```

**Or use systemd / Docker / Railway / Render (free tier)**

---

## Supported Leagues
- Premier League
- La Liga
- Bundesliga
- Serie A
- Ligue 1
- Champions League
- Eredivisie
- Primeira Liga

---

⚠️ **Disclaimer:** This bot is for educational purposes only.
