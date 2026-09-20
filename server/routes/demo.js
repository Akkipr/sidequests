const { Router } = require('express');
const { demo } = require('../container');

// Mounted only when DEMO_MODE=true (see index.js); the service also refuses when it is off.
const router = Router();
router.post('/demo/nearby', async (req, res) => res.json(await demo.simulateNearby(req.uid)));

// DEMO MODE ONLY: raises a real server error so error monitoring can be shown end to end.
router.post('/demo/test-error', () => {
  throw new Error('SideQuests demo test error (thrown on purpose by POST /demo/test-error)');
});

module.exports = router;
