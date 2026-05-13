const logger = require('../utils/logger');

function notFound(req, res, next) {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.path}` });
}

function errorHandler(err, req, res, _next) {
  logger.error(err.message, { stack: err.stack, path: req.path });
  const status = err.status || 500;
  res.status(status).json({
    error: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message,
  });
}

module.exports = { notFound, errorHandler };
