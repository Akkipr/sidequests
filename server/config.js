const EXAMPLE_SECRET = 'replace-with-a-long-random-secret'; // from .env.example: public, so never accepted
const MIN_ADMIN_SECRET = 16;

// Read at call time so tests (and a restart with a new env) can flip demo mode.
module.exports = {
  demoMode: () => process.env.DEMO_MODE === 'true',
  QUEST_POINTS: 50,
  MIN_PASSWORD: 8,
  DEMO_WAVE_DELAY_MS: 6000,
  LEGACY_WINDOW_SECONDS: 20,
  CURRENT_MATCH_MINUTES: 10, // how far back 'do I have a match?' looks
  OPEN_MATCH_MINUTES: 10,    // a pair's still-open match is reused for this long, so two phones converge on ONE match
  // WAT2DO event import. All off / empty by default; read at call time like demoMode.
  // A too-short secret, or the placeholder from .env.example, counts as "not configured" so the endpoint stays locked.
  adminSecret: () => {
    const secret = process.env.ADMIN_IMPORT_SECRET ?? '';
    return secret.length >= MIN_ADMIN_SECRET && secret !== EXAMPLE_SECRET ? secret : '';
  },
  wat2doEnabled: () => process.env.ENABLE_WAT2DO_IMPORT === 'true',
  wat2doCron: () => process.env.WAT2DO_IMPORT_CRON || '0 * * * *',
  wat2doBaseUrl: () => process.env.WAT2DO_BASE_URL || 'https://wat2do.ca',
};
