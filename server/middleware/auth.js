const accounts = require('../repositories/accounts');
const { httpError } = require('../errors');
const { sha } = require('../tokens');

// Sets req.uid and req.tokenHash from the bearer token, or answers 401.
async function requireAuth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '') ?? '';
  const uid = await accounts.userForSession(sha(token));
  if (!uid) throw httpError(401, 'unauthorized');
  req.uid = uid;
  req.tokenHash = sha(token);
  next();
}

module.exports = { requireAuth };
