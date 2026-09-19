const { Router } = require('express');
const { matching } = require('../container');

const router = Router();

// Body: { detectedWearableToken, rssi, timestamp } (exact peer). A bare body is the LEGACY time-window
// signal, which the service only accepts in demo mode.
router.post('/signal', async (req, res) => res.json(await matching.handleSignal(req.uid, req.body)));

module.exports = router;
