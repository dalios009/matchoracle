const isDev = process.env.NODE_ENV !== 'production';

function log(level, msg, meta) {
  const ts = new Date().toISOString();
  const prefix = `[${ts}] ${level.toUpperCase()}:`;
  if (meta) {
    console[level === 'error' ? 'error' : 'log'](`${prefix} ${msg}`, isDev ? meta : '');
  } else {
    console[level === 'error' ? 'error' : 'log'](`${prefix} ${msg}`);
  }
}

module.exports = {
  info:  (msg, meta) => log('info',  msg, meta),
  warn:  (msg, meta) => log('warn',  msg, meta),
  error: (msg, meta) => log('error', msg, meta),
};
