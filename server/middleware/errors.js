const { HttpError } = require('../errors');
const { log } = require('../telemetry');

// Express 5 forwards rejected async handlers here.
// eslint-disable-next-line no-unused-vars
module.exports = function errorHandler(err, req, res, next) {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'invalid JSON' });
  console.error(err);
  log.error('unhandled server error', { 'error.type': err.name, 'http.method': req.method, 'http.route': req.route?.path ?? 'unmatched' }); // no message: it can contain data
  res.status(500).json({ error: 'internal error' });
};
