// Read at call time so tests (and a restart with a new env) can flip demo mode.
module.exports = {
  demoMode: () => process.env.DEMO_MODE === 'true',
  QUEST_POINTS: 50,
  MIN_PASSWORD: 8,
  DEMO_WAVE_DELAY_MS: 6000,
  LEGACY_WINDOW_SECONDS: 20,
};
