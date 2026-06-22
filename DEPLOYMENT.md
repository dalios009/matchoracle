# MatchOracle — Deployment Guide

This repo contains **three separate services** that each deploy independently:

| Folder      | What it is                          | Where it runs        |
|-------------|--------------------------------------|-----------------------|
| `backend/`  | Node.js API (odds, predictions, AI) | Railway / Vercel      |
| `pybot/`    | Full-featured Telegram bot (Python) | Railway               |
| `frontend/` | Telegram Mini App (static HTML)     | Vercel / Railway      |

**Note on `backend/bot/bot.js`:** this is NOT a separate deployable service —
it's a small webhook handler mounted inside the backend (`/bot/webhook`)
whose only job is to greet users with an "Open MatchOracle" button that
launches the Mini App. It uses its own `BOT_TOKEN` / `MINI_APP_URL` /
`WEBHOOK_SECRET` variables and is optional (the backend logs a warning and
keeps running fine if it's not configured). It is unrelated to `pybot/`,
which is the main bot with `/predict`, `/top`, alerts, tracker, etc.
If you only want one bot, just don't set `BOT_TOKEN`/`WEBHOOK_SECRET` and
this part of the backend will simply stay inactive.


**Important:** Railway does NOT automatically know which folder to deploy in a
monorepo. You must create a **separate Railway service for each folder** and
set its **Root Directory** explicitly. This was the reason the bot never
deployed — Railway was trying to build from the repo root, which has no
single entry point.

---

## 1. Deploy the Telegram bot (`pybot/`)

1. Railway dashboard → **New Project** → **Deploy from GitHub repo** → select `matchoracle`
2. After it's created, click the service → **Settings** → **Root Directory** → set to `pybot`
3. Still in Settings, confirm:
   - **Build:** Nixpacks (auto-detected via `pybot/nixpacks.toml`)
   - **Start Command:** `python main.py` (auto-detected via `pybot/railway.json`)
4. Go to **Variables** and add:
   ```
   TELEGRAM_TOKEN=<your bot token from @BotFather>
   ODDS_API_KEY=<your key from the-odds-api.com>
   ```
5. Click **Deploy**. Check the **Deploy Logs** tab — you should see:
   ```
   MatchOracle Pro bot starting...
   ```
6. Open Telegram, message your bot, send `/start`.

**If it still fails to deploy:**
- Open the build logs and check for a `pip install` error (usually a version conflict)
- Confirm Root Directory is exactly `pybot` (no leading/trailing slash)
- Confirm there isn't ALSO a `bot/` folder confusing things — this repo
  has been consolidated to use only `pybot/` going forward

---

## 2. Deploy the backend API (`backend/`)

1. Railway dashboard → same project → **+ New** → **GitHub Repo** → same repo again
2. **Settings** → **Root Directory** → `backend`
3. **Variables**:
   ```
   ODDS_API_KEY=<your key>
   ANTHROPIC_API_KEY=<your Anthropic key, for the AI Scout feature>
   ALLOWED_ORIGINS=https://your-frontend-url.vercel.app
   PORT=3001
   ```
4. Deploy. Confirm logs show:
   ```
   MatchOracle API running on port 3001
   ```
5. Copy the generated public URL (Settings → Networking → Generate Domain).
   You'll need this for the frontend's `apiBase` config.

---

## 3. Deploy the frontend (`frontend/`)

The frontend is a static Telegram Mini App. Vercel is simplest:

1. vercel.com → **New Project** → import repo → set **Root Directory** to `frontend`
2. No build step needed (`vercel.json` already configured)
3. After deploy, edit `frontend/index.html` and update:
   ```js
   window.MATCHORACLE_CONFIG = { apiBase: 'https://YOUR-BACKEND-URL.up.railway.app/api' };
   ```
4. Register the Mini App URL with @BotFather:
   `/mybots` → your bot → **Bot Settings** → **Menu Button** → paste the Vercel URL

---

## Common Railway gotchas

- **"No start command could be found"** → Root Directory isn't set, or is
  pointing at the repo root instead of the service subfolder.
- **Bot builds but immediately crashes** → check Variables tab — a missing
  `TELEGRAM_TOKEN` is the #1 cause.
- **Works locally, fails on Railway** → almost always a Python/Node version
  mismatch. `pybot/nixpacks.toml` pins Python 3.11 — don't remove it.
- **Multiple services interfering** → each Railway service should have its
  own Root Directory and its own set of Variables. They do not share env vars
  by default.
