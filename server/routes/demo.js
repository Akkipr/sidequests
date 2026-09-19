const { Router } = require('express');
const { demo } = require('../container');

// Mounted only when DEMO_MODE=true (see index.js); the service also refuses when it is off.
const router = Router();
router.post('/demo/nearby', async (req, res) => res.json(await demo.simulateNearby(req.uid)));

module.exports = router;
