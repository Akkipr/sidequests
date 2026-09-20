const Sentry = require('@sentry/node');
const pkg = require('./package.json');

// Sentry for the API. Off unless SENTRY_DSN is set. The one rule: nothing a player types or holds ever leaves this
// server. This API receives passwords (request bodies) and session tokens (Authorization headers), and SideQuests
// promises identity stays hidden until both people wave.
//
// This SDK version collects HTTP bodies, headers, cookies, query strings, database query parameters and even local
// variable values from stack frames BY DEFAULT, so every category is switched off explicitly rather than trusting the
// defaults. `scrub` is a second line of defence in case an integration adds something anyway.
const DATA_COLLECTION = {
  userInfo: false,
  cookies: false,
  httpHeaders: false,
  httpBodies: [],
  urlQueryParams: false,
  databaseQueryData: false,   // parameterised query text is still recorded; the values never are
  stackFrameVariables: false, // e.g. the `password` argument in a stack frame of a failed signup
};

const parseRate = (raw, fallback) => {
  if (raw === undefined || raw === null || String(raw).trim() === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : fallback;
};

/** Sentry.init options from the environment, or null when no DSN is configured (Sentry stays off). */
function buildOptions(env = process.env) {
  const dsn = (env.SENTRY_DSN ?? '').trim();
  if (!dsn) return null;
  return {
    dsn,
    environment: env.SENTRY_ENVIRONMENT || 'development', // use "demo" when presenting
    release: env.SENTRY_RELEASE || `sidequests-api@${pkg.version}`,
    tracesSampleRate: parseRate(env.SENTRY_TRACES_SAMPLE_RATE, 1),
    debug: env.SENTRY_DEBUG === 'true',
    // The app and the API share one Sentry project, so tag events to tell them apart (filter component:api / component:app).
    initialScope: { tags: { component: 'api' } },
    dataCollection: DATA_COLLECTION,
    enableLogs: true,
    beforeSend: scrub,
    beforeSendTransaction: scrub,
    beforeSendLog: scrubLog,
  };
}

// Query strings can carry secrets (?token=...), and the SDK copies the full URL into several places.
const URL_KEYS = ['url.full', 'http.url', 'http.target', 'http.request.url', 'url'];
const QUERY_KEYS = ['http.query', 'url.query', 'query_string'];
const stripQuery = (value) => (typeof value === 'string' ? value.replace(/[?#].*$/, '') : value);

function scrubData(data) {
  if (!data || typeof data !== 'object') return;
  for (const key of URL_KEYS) if (key in data) data[key] = stripQuery(data[key]);
  for (const key of QUERY_KEYS) delete data[key];
}

/**
 * Removes anything request-shaped that could identify or authenticate a player. Keeps the method, the URL path and the
 * status, which is all the dashboards need. Runs on errors and transactions alike.
 */
function scrub(event) {
  if (event.request) {
    delete event.request.data;
    delete event.request.cookies;
    delete event.request.headers;
    delete event.request.query_string;
    if (event.request.url) event.request.url = stripQuery(event.request.url);
  }
  delete event.user;
  scrubData(event.contexts?.trace?.data);
  for (const span of event.spans ?? []) scrubData(span.data);
  for (const crumb of event.breadcrumbs ?? []) scrubData(crumb.data);
  return event;
}

// ---- logs ----
// Logs are free-form text, so they get the same care as everything else. We log on purpose, with fixed messages and
// non-identifying attributes, and we do NOT capture console output: database errors can include row values, e.g.
// "Key (nickname_key)=(alice) already exists". `scrubLog` is the backstop for anything that slips through.
const SENSITIVE_KEY = /pass(word|wd)?|token|secret|authorization|cookie|nickname|email|session|bearer|api[-_]?key/i;
const TOKEN_LIKE = /\b[0-9a-f]{32,}\b|\bBearer\s+\S+|\beyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{5,}/gi; // long hex (session tokens), bearer values, JWTs
const MAX_LOG_TEXT = 500;
const clean = (v) => (typeof v === 'string' ? v.replace(TOKEN_LIKE, '[redacted]').slice(0, MAX_LOG_TEXT) : v);

/** Drops sensitive attributes, redacts token-shaped text, and caps length. Runs on every log before it is sent. */
function scrubLog(log) {
  const attributes = {};
  for (const [key, value] of Object.entries(log.attributes ?? {})) {
    if (!SENSITIVE_KEY.test(key)) attributes[key] = clean(value);
  }
  return { ...log, message: clean(String(log.message)), attributes };
}

// Fixed, never player-supplied text as the message; put details in attributes. Safe when Sentry is off.
const log = {
  debug: (message, attributes) => Sentry.logger.debug(message, attributes),
  info: (message, attributes) => Sentry.logger.info(message, attributes),
  warn: (message, attributes) => Sentry.logger.warn(message, attributes),
  error: (message, attributes) => Sentry.logger.error(message, attributes),
};

// ---- spans and metrics: thin wrappers so services don't depend on Sentry directly, and never break when it is off ----

/** Times `fn` as a span. `fn` receives the span so it can add attributes once the outcome is known. */
const withSpan = (name, attributes, fn) => Sentry.startSpan({ name, op: 'sidequests', attributes }, fn);

const count = (name, value = 1, attributes) => Sentry.metrics.count(name, value, { attributes });
const distribution = (name, value, unit, attributes) => Sentry.metrics.distribution(name, value, { unit, attributes });

/**
 * Load generated by scripts/demo-traffic.js sends X-SideQuests-Synthetic. Tag it so dashboards can filter it out (or
 * in) and nobody mistakes it for real players.
 */
function tagSyntheticTraffic(req, res, next) {
  if (req.headers['x-sidequests-synthetic']) {
    Sentry.getIsolationScope().setTag('synthetic', 'true');
    Sentry.getIsolationScope().setAttribute('synthetic', true); // also stamps every log emitted during this request
    const active = Sentry.getActiveSpan();
    if (active) Sentry.getRootSpan(active).setAttribute('synthetic', true);
  }
  next();
}

module.exports = { buildOptions, scrub, scrubLog, log, withSpan, count, distribution, tagSyntheticTraffic, DATA_COLLECTION };
