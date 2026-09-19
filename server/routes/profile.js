const { Router } = require('express');
const { repos } = require('../container');
const { validateProfile, validateStatus } = require('../services/validation');
const { httpError } = require('../errors');

const router = Router();

router.get('/profile', async (req, res) => res.json((await repos.profiles.get(req.uid)) ?? null));

// Editing never changes the nickname: it is the login name.
router.put('/profile', async (req, res) => {
  const p = await repos.profiles.update(req.uid, validateProfile(req.body));
  if (!p) throw httpError(404, 'no profile');
  res.json(p);
});

router.post('/status', async (req, res) => {
  await repos.profiles.setStatus(req.uid, validateStatus(req.body.status));
  res.json({ ok: true });
});

module.exports = router;
