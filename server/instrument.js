// Must be the FIRST thing the process loads (see index.js): Sentry patches express and pg as they are required, so it
// has to be initialised before they are.
require('dotenv').config();
const Sentry = require('@sentry/node');
const { buildOptions } = require('./telemetry');

const options = buildOptions();
if (options) Sentry.init(options);
