const { Router } = require('express');
const { matching, quests } = require('../container');
const { httpError } = require('../errors');

const router = Router();

// Before /matches/:id, or 'current' would be read as an id.
router.get('/matches/current', async (req, res) => res.json(await matching.current(req.uid)));
router.get('/matches/:id', async (req, res) => res.json(await matching.get(req.uid, req.params.id)));
router.post('/matches/:id/respond', async (req, res) => res.json(await matching.respond(req.uid, req.params.id, !!req.body.wave)));
router.post('/matches/:id/block', async (req, res) => {
  await matching.block(req.uid, req.params.id, req.body.reason);
  res.json({ ok: true });
});

// Quest progress for a match (see services/quests.js).
router.post('/matches/:id/quest', async (req, res) => {
  if (!Number.isInteger(req.body.questId)) throw httpError(400, 'questId required');
  res.json(await quests.select(req.uid, req.params.id, req.body.questId));
});
router.post('/matches/:id/quest/start', async (req, res) => res.json(await quests.start(req.uid, req.params.id)));
router.post('/matches/:id/quest/complete', async (req, res) => res.json(await quests.complete(req.uid, req.params.id)));

module.exports = router;
