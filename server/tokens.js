const crypto = require('crypto');

// Session tokens are stored hashed, so a database leak doesn't leak live sessions.
exports.sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
