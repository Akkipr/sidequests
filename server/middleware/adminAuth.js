const { httpError } = require('../errors');
const { sha } = require('../tokens');
const crypto = require('crypto');

// Compare digests, so the check is constant-time and the secrets' lengths don't matter.
const safeEqual = (a, b) => crypto.timingSafeEqual(Buffer.from(sha(a), 'hex'), Buffer.from(sha(b), 'hex'));

/**
 * Guards admin-only routes with `Authorization: Bearer <ADMIN_IMPORT_SECRET>`.
 * If no secret is configured the routes stay locked for everyone (there is no default secret).
 * Answers 401 for a missing, malformed or wrong secret, with the same body every time.
 */
function requireAdminSecret(getSecret) {
  return (req, res, next) => {
    const expected = getSecret();
    const given = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1] ?? '';
    if (!expected || !safeEqual(given, expected)) throw httpError(401, 'unauthorized');
    next();
  };
}

module.exports = { requireAdminSecret };
