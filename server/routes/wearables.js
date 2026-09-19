const { Router } = require('express');
const { repos } = require('../container');
const { validateWearableToken } = require('../services/validation');

const router = Router();

router.post('/wearables/link', async (req, res) => {
  await repos.wearables.link(req.uid, validateWearableToken(req.body.wearableToken));
  res.json({ ok: true });
});
router.get('/wearables', async (req, res) => res.json({ linked: !!(await repos.wearables.forUser(req.uid)) }));
router.delete('/wearables', async (req, res) => {
  await repos.wearables.unlink(req.uid);
  res.json({ ok: true });
});

module.exports = router;
