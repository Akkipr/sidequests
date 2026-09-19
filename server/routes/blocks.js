const { Router } = require('express');
const { repos } = require('../container');

const router = Router();

// Deliberately anonymous: you can block someone before they ever reveal themselves, so we never show names here.
router.get('/blocks', async (req, res) => res.json(await repos.matches.listBlocks(req.uid)));
router.delete('/blocks/:id', async (req, res) => {
  if (/^[0-9a-f-]{36}$/.test(req.params.id)) await repos.matches.unblock(req.uid, req.params.id);
  res.json({ ok: true });
});

module.exports = router;
