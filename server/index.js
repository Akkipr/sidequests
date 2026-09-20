require('./instrument'); // first: Sentry must be initialised before express and pg are loaded (it also loads .env)
const express = require('express');
const Sentry = require('@sentry/node');
const { tagSyntheticTraffic, log } = require('./telemetry');
const config = require('./config');
const routes = require('./routes');
const errorHandler = require('./middleware/errors');
const { importer } = require('./container');
const { startWat2doSchedule } = require('./services/importScheduler');

const app = express();
app.use(express.json());
app.use(tagSyntheticTraffic);
app.use(routes({ demo: config.demoMode() }));
Sentry.setupExpressErrorHandler(app); // reports 5xx errors; expected 4xx responses are not issues
app.use(errorHandler);

const port = process.env.PORT ?? 3000;
app.listen(port, '0.0.0.0', () => {
  console.log(`SideQuests API on :${port}${config.demoMode() ? ' (DEMO MODE: demo routes + legacy signals enabled)' : ''}`);
  log.info('server started', { port: Number(port), 'app.demo_mode': config.demoMode() });
  startWat2doSchedule({ importer, config });
});
