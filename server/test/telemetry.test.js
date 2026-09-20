const test = require('node:test');
const assert = require('node:assert/strict');
const Sentry = require('@sentry/node');
const { buildOptions, scrub, scrubLog, log, withSpan, count, distribution, tagSyntheticTraffic, DATA_COLLECTION } = require('../telemetry');

const DSN = 'https://key@o1.ingest.de.sentry.io/2';

test('Sentry stays off without a DSN', () => {
  assert.equal(buildOptions({}), null);
  assert.equal(buildOptions({ SENTRY_DSN: '' }), null);
  assert.equal(buildOptions({ SENTRY_DSN: '   ' }), null);
});

test('options come from the environment with safe defaults', () => {
  const o = buildOptions({ SENTRY_DSN: DSN });
  assert.equal(o.dsn, DSN);
  assert.equal(o.environment, 'development');
  assert.match(o.release, /^sidequests-api@\d+\.\d+\.\d+/);
  assert.equal(o.tracesSampleRate, 1);
  assert.equal(o.debug, false);
  assert.deepEqual(o.initialScope, { tags: { component: 'api' } }); // lets a shared project tell API events from app events

  const custom = buildOptions({ SENTRY_DSN: DSN, SENTRY_ENVIRONMENT: 'demo', SENTRY_RELEASE: 'api@9.9.9+abc', SENTRY_TRACES_SAMPLE_RATE: '0.25', SENTRY_DEBUG: 'true' });
  assert.deepEqual([custom.environment, custom.release, custom.tracesSampleRate, custom.debug], ['demo', 'api@9.9.9+abc', 0.25, true]);
});

test('bad sample rates fall back instead of silently disabling tracing', () => {
  for (const bad of ['abc', '-1', '2', 'NaN', '']) assert.equal(buildOptions({ SENTRY_DSN: DSN, SENTRY_TRACES_SAMPLE_RATE: bad }).tracesSampleRate, 1, bad);
  assert.equal(buildOptions({ SENTRY_DSN: DSN, SENTRY_TRACES_SAMPLE_RATE: '0' }).tracesSampleRate, 0); // zero is a real setting
});

test('every category of potentially sensitive data collection is explicitly off', () => {
  const dc = buildOptions({ SENTRY_DSN: DSN }).dataCollection;
  assert.equal(dc, DATA_COLLECTION);
  assert.equal(dc.userInfo, false);
  assert.equal(dc.cookies, false);
  assert.equal(dc.httpHeaders, false);       // Authorization: Bearer <session token>
  assert.deepEqual(dc.httpBodies, []);        // passwords in /signup and /login
  assert.equal(dc.urlQueryParams, false);
  assert.equal(dc.databaseQueryData, false);
  assert.equal(dc.stackFrameVariables, false); // `password` arguments in failing frames
});

test('scrub removes bodies, headers, cookies, queries and users but keeps the route', () => {
  const event = {
    message: 'boom',
    user: { id: 'u1', ip_address: '1.2.3.4', username: 'alice' },
    request: {
      method: 'POST', url: 'http://localhost:3000/login',
      data: { nickname: 'alice', password: 'hunter2hunter2' },
      cookies: { session: 'abc' },
      headers: { authorization: 'Bearer secret-session-token', 'content-type': 'application/json' },
      query_string: 'token=abc',
    },
  };
  const out = scrub(event);
  const text = JSON.stringify(out);
  for (const secret of ['hunter2hunter2', 'secret-session-token', 'alice', '1.2.3.4', 'token=abc', 'session']) assert.ok(!text.includes(secret), `leaked: ${secret}`);
  assert.deepEqual(out.request, { method: 'POST', url: 'http://localhost:3000/login' });
  assert.equal(out.message, 'boom');
});

test('scrub strips query strings from every URL-shaped field (the SDK copies the URL into trace and span data)', () => {
  const url = 'http://host/matches/1/respond?token=abc#frag';
  const event = {
    request: { url },
    contexts: { trace: { data: { 'url.full': url, 'http.url': url, 'http.target': '/matches/1/respond?token=abc', 'http.query': 'token=abc', 'url.query': 'token=abc', 'http.method': 'POST' } } },
    spans: [{ data: { 'http.url': url, 'http.query': 'token=abc' } }],
    breadcrumbs: [{ data: { url } }],
  };
  const out = scrub(event);
  assert.ok(!JSON.stringify(out).includes('token=abc'), JSON.stringify(out));
  assert.equal(out.request.url, 'http://host/matches/1/respond');
  assert.equal(out.contexts.trace.data['http.target'], '/matches/1/respond');
  assert.equal(out.contexts.trace.data['http.method'], 'POST'); // unrelated data is kept
  assert.equal(out.breadcrumbs[0].data.url, 'http://host/matches/1/respond');
});

test('scrub copes with events that have no request', () => {
  assert.deepEqual(scrub({ message: 'x' }), { message: 'x' });
  assert.deepEqual(scrub({ request: {} }), { request: {} });
});

test('the same scrub is used for errors and for transactions', () => {
  const o = buildOptions({ SENTRY_DSN: DSN });
  assert.equal(o.beforeSend, scrub);
  assert.equal(o.beforeSendTransaction, scrub);
  assert.equal(o.beforeSendLog, scrubLog);
  assert.equal(o.enableLogs, true);
});

test('spans and metrics work when Sentry is not initialised, return the value, and never throw', async () => {
  assert.equal(await withSpan('x.y', { a: 1 }, async () => 42), 42);
  assert.equal(withSpan('x.sync', {}, () => 'sync'), 'sync');
  let seen;
  await withSpan('x.attrs', {}, async (span) => { span.setAttribute('outcome', 'ok'); seen = span; });
  assert.ok(seen);
  assert.doesNotThrow(() => { count('test.count'); count('test.count', 3, { kind: 'x' }); distribution('test.dist', 12.5, 'millisecond', { kind: 'x' }); });
});

test('a span does not swallow the error thrown inside it', async () => {
  await assert.rejects(withSpan('x.fail', {}, async () => { throw new Error('kept'); }), /kept/);
});

test('the middleware tags only requests that carry the synthetic header', () => {
  // Uninitialised Sentry has no per-request scope isolation, so check the two cases one after the other, real first.
  // The per-request behaviour on a running server is covered by telemetry.integration.test.js.
  const tagsFor = (headers) => new Promise(resolve => Sentry.withIsolationScope(scope => {
    tagSyntheticTraffic({ headers }, {}, () => resolve(scope.getScopeData().tags));
  }));
  return tagsFor({}).then(real => {
    assert.equal(real.synthetic, undefined);
    return tagsFor({ 'x-sidequests-synthetic': '1' });
  }).then(synthetic => assert.equal(synthetic.synthetic, 'true'));
});

test('scrubLog drops sensitive attributes, whatever their case or spelling', () => {
  const out = scrubLog({ level: 'info', message: 'x', attributes: {
    password: 'p', Password: 'p', user_password: 'p', token: 't', 'session.token': 't', sessionId: 's', Authorization: 'a',
    cookie: 'c', nickname: 'alice', email: 'a@b.c', apiKey: 'k', 'api-key': 'k', secret: 's',
    'match.score': 88, route: '/matches/:id/respond', ok: true,
  } });
  assert.deepEqual(out.attributes, { 'match.score': 88, route: '/matches/:id/respond', ok: true });
});

test('scrubLog redacts token-shaped text in the message and in string attributes', () => {
  const token = 'a1b2c3d4'.repeat(8); // 64 hex chars, like our session tokens
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk';
  const out = scrubLog({ level: 'warn', message: `retrying with ${token}`, attributes: { detail: `Authorization: Bearer ${token}`, jwt, count: 3 } });
  assert.equal(out.message, 'retrying with [redacted]');
  assert.ok(!JSON.stringify(out).includes(token) && !JSON.stringify(out).includes('eyJhbGci'));
  assert.equal(out.attributes.count, 3);
});

test('scrubLog keeps ordinary text and caps very long values', () => {
  const out = scrubLog({ level: 'info', message: 'match created', attributes: { 'match.shared': 'foodie,explorer', big: 'x'.repeat(5000) } });
  assert.equal(out.message, 'match created');
  assert.equal(out.attributes['match.shared'], 'foodie,explorer');
  assert.equal(out.attributes.big.length, 500);
});

test('scrubLog copes with logs that have no attributes', () => {
  assert.deepEqual(scrubLog({ level: 'info', message: 'hello' }), { level: 'info', message: 'hello', attributes: {} });
});

test('the log wrapper is safe when Sentry is off', () => {
  assert.doesNotThrow(() => { log.debug('d'); log.info('i', { a: 1 }); log.warn('w'); log.error('e', { b: 2 }); });
});
