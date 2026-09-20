// Optional periodic import. Off unless ENABLE_WAT2DO_IMPORT=true. It calls the very same importer as the admin
// endpoint, which already refuses to run two imports at once, so a slow import can never overlap the next tick.
function startWat2doSchedule({ importer, config, logger = console, cron = require('node-cron') }) {
  if (!config.wat2doEnabled()) return null;

  const expression = config.wat2doCron();
  if (!cron.validate(expression)) {
    logger.error(`WAT2DO import NOT scheduled: "${expression}" is not a valid cron expression`);
    return null;
  }

  const task = cron.schedule(expression, async () => {
    try {
      const summary = await importer.importWat2do();
      logger.log('WAT2DO scheduled import finished:', JSON.stringify(summary));
    } catch (e) {
      // A failed (or skipped) scheduled import must never take the server down.
      if (e.status === 409) logger.log('WAT2DO scheduled import skipped: one is already running');
      else logger.error('WAT2DO scheduled import failed:', e.cause ?? e);
    }
  });
  logger.log(`WAT2DO import scheduled: ${expression}`);
  return task;
}

module.exports = { startWat2doSchedule };
