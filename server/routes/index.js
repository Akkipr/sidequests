const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const auth = require('./auth');

// Public routes first, then everything behind a session.
module.exports = function routes({ demo }) {
  const r = Router();
  r.use(auth.publicRoutes);
  r.use(requireAuth);
  r.use(auth.sessionRoutes);
  for (const name of ['profile', 'signals', 'matches', 'quests', 'wearables', 'blocks']) r.use(require(`./${name}`));
  if (demo) r.use(require('./demo'));
  return r;
};
