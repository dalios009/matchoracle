const BOT_TOKEN = process.env.BOT_TOKEN;
const MINI_APP_URL = process.env.MINI_APP_URL || '';
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || '';

const BASE = `https://api.telegram.org/bot${BOT_TOKEN}`;

async function sendMessage(chatId, text, extra = {}) {
  return fetch(`${BASE}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', ...extra }),
  });
}

async function handleUpdate(update) {
  const msg = update.message;
  if (!msg?.text) return;
  const chatId = msg.chat.id;
  const cmd = msg.text.split(' ')[0].toLowerCase();

  if (cmd === '/start' || cmd === '/open') {
    await sendMessage(chatId,
      `⚡ <b>MatchOracle</b>\n\nAI-powered football predictions and smart betting insights.\n\nTap below to open the app 👇`,
      {
        reply_markup: {
          inline_keyboard: [[{
            text: '⚽ Open MatchOracle',
            web_app: { url: MINI_APP_URL },
          }]],
        },
      }
    );
  } else if (cmd === '/today') {
    await sendMessage(chatId,
      `📅 <b>Today\'s matches are ready!</b>\n\nOpen MatchOracle to see predictions and best bets for all today\'s fixtures.`,
      {
        reply_markup: {
          inline_keyboard: [[{
            text: '⚽ See Today\'s Predictions',
            web_app: { url: MINI_APP_URL },
          }]],
        },
      }
    );
  } else if (cmd === '/help') {
    await sendMessage(chatId,
      `❓ <b>How to use MatchOracle</b>\n\n1. Open the app with /start\n2. Browse today\'s fixtures\n3. Tap any match to see predictions\n4. Select bets and save your betslip\n5. Ask the AI Scout any question\n\n⚠️ <i>For entertainment only. Gamble responsibly.</i>`
    );
  }
}

async function webhookHandler(req, res) {
  if (WEBHOOK_SECRET && req.headers['x-telegram-bot-api-secret-token'] !== WEBHOOK_SECRET) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  try {
    await handleUpdate(req.body);
  } catch (e) {
    console.error('Bot error:', e.message);
  }
  res.json({ ok: true });
}

module.exports = { webhookHandler };
