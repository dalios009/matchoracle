require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const matchesRouter = require('./routes/matches');
const predictionsRouter = require('./routes/predictions');
const aiRouter = require('./routes/ai');
const { errorHandler, notFound } = require('./middleware/errorHandler');
const logger = require('./utils/logger');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

const allowedOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').map(o => o.trim()).filter(Boolean);
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-apisports-key'],
}));


app.use(express.json({ limit: '10kb' }));

const globalLimiter = rateLimit({
  windowMs: 60000, max: 60,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many requests.' },
});
app.use('/api/', globalLimiter);

app.use((req, _res, next) => { logger.info(`${req.method} ${req.path}`); next(); });

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), version: '1.0.0' });
});

app.use('/api/matches', matchesRouter);
app.use('/api/predictions', predictionsRouter);
app.use('/api/ai', aiRouter);

try {
  const { webhookHandler } = require('./bot/bot');
  app.post('/bot/webhook', webhookHandler);
} catch (e) {
  logger.warn('Bot not configured');
}

app.use(notFound);
app.use(errorHandler);

app.listen(PORT, () => {
  logger.info(`MatchOracle API running on port ${PORT}`);
});

module.exports = app;
