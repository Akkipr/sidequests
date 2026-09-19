const { Router } = require('express');
const { quests } = require('../container');

const router = Router();

// { active, suggested, history }: the whole Quests tab, and the source of truth across app restarts.
router.get('/quests', async (req, res) => res.json(await quests.overview(req.uid)));

module.exports = router;
