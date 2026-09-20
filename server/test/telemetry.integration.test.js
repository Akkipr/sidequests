// End to end: the REAL Sentry SDK, a REAL Express app and REAL HTTP requests, capturing exactly what would be sent to
// Sentry (via a fake transport). Proves that passwords and session tokens never leave the server and that the synthetic
// tag is per request. It has its own process because Sentry must be initialised before express is loaded.
const test = require('node:test');
const assert = require('node:assert/strict');
const Sentry = require('@sentry/node');
const { buildOptions, tagSyntheticTraffic, withSpan, log } = require('../telemetry');

const sent = [];
const transport = () => ({
  send: async (envelope) => { sent.push(envelope); return {}; },
  flush: async () => true,
});
Sentry.init({ ...buildOptions({ SENTRY_DSN: 'https://key@o1.ingest.de.sentry.io/2', SENTRY_ENVIRONMENT: 'test' }), transport });

const express = require('express'); // after init, so it is instrumented

const app = express();
app.use(express.json());
app.use(tagSyntheticTraffic);
app.post('/login', (req, res) => res.json({ ok: true }));
app.post('/matches/:id/respond', async (req, res) => {
  await withSpan('match.respond', { 'match.wave': !!req.body.wave }, async () => {});
  res.json({ ok: true });
});
app.post('/loggy', (req, res) => {
  // a careless developer puts secrets in a log: none of it may reach Sentry
  log.info('login attempt', { password: req.body.password, nickname: req.body.nickname, 'auth.result': 'ok', detail: `Bearer ${req.headers.authorization}` });
  res.json({ ok: true });
});
app.post('/explode', (req, res) => { throw new Error('kaboom inside the handler'); });
Sentry.setupExpressErrorHandler(app);
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => res.status(500).json({ error: 'internal error' }));

const events = () => sent.flatMap(env => env[1].map(([header, payload]) => ({ type: header.type, payload })));
const transactions = () => events().filter(e => e.type === 'transaction').map(e => e.payload);
const errors = () => events().filter(e => e.type === 'event').map(e => e.payload);

test('nothing a player sends can leave the server, and synthetic traffic is tagged per request', async () => {
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const secretHeaders = { 'Content-Type': 'application/json', Authorization: 'Bearer super-secret-session-token', Cookie: 'sid=cookie-secret' };
  try {
    await fetch(`${base}/login`, { method: 'POST', headers: secretHeaders, body: JSON.stringify({ nickname: 'alice-the-player', password: 'hunter2hunter2' }) });
    await fetch(`${base}/matches/123/respond?token=query-secret`, { method: 'POST', headers: { ...secretHeaders, 'X-SideQuests-Synthetic': '1' }, body: JSON.stringify({ wave: true, password: 'body-secret' }) });
    await fetch(`${base}/matches/456/respond`, { method: 'POST', headers: secretHeaders, body: JSON.stringify({ wave: false }) });
    const boom = await fetch(`${base}/explode`, { method: 'POST', headers: secretHeaders, body: JSON.stringify({ password: 'explode-secret' }) });
    assert.equal(boom.status, 500);
  } finally {
    await new Promise(r => server.close(r));
  }
  await Sentry.flush(5000);

  // 1. Something was actually captured (otherwise the privacy assertions below would prove nothing).
  const tx = transactions();
  const errs = errors();
  assert.ok(tx.length >= 4, `expected 4+ transactions, got ${tx.length}`);
  assert.ok(errs.length >= 1, 'the 500 should be reported as an error');
  assert.ok(errs.some(e => JSON.stringify(e).includes('kaboom inside the handler')));

  // 2. Not one secret appears anywhere in anything that would be sent.
  const everything = JSON.stringify(sent);
  for (const secret of ['hunter2hunter2', 'super-secret-session-token', 'cookie-secret', 'query-secret', 'body-secret', 'explode-secret', 'alice-the-player']) {
    assert.ok(!everything.includes(secret), `LEAKED to Sentry: ${secret}`);
  }

  // 3. The useful, non-sensitive parts are there: route names (patterns, not raw ids) and our custom span.
  const names = tx.map(t => t.transaction);
  assert.ok(names.includes('POST /login'), names.join(', '));
  assert.ok(names.includes('POST /matches/:id/respond'), names.join(', '));
  assert.ok(tx.some(t => (t.spans ?? []).some(s => s.description === 'match.respond')), 'custom span missing');

  // 4. The synthetic tag applies to the synthetic request only.
  const respond = tx.filter(t => t.transaction === 'POST /matches/:id/respond');
  assert.equal(respond.length, 2);
  const tagged = respond.filter(t => t.tags?.synthetic === 'true');
  assert.equal(tagged.length, 1, 'exactly one of the two respond requests was synthetic');
  assert.equal(tx.filter(t => t.transaction === 'POST /login')[0].tags?.synthetic, undefined);
});

test('logs reach Sentry stripped of secrets, and carry the synthetic flag only for synthetic requests', async () => {
  sent.length = 0;
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const headers = { 'Content-Type': 'application/json', Authorization: 'super-secret-log-token' };
  try {
    await fetch(`${base}/loggy`, { method: 'POST', headers: { ...headers, 'X-SideQuests-Synthetic': '1' }, body: JSON.stringify({ password: 'log-secret-pw', nickname: 'log-alice' }) });
    await fetch(`${base}/loggy`, { method: 'POST', headers, body: JSON.stringify({ password: 'log-secret-pw', nickname: 'log-alice' }) });
  } finally {
    await new Promise(r => server.close(r));
  }
  await Sentry.flush(5000);

  const logs = sent.flatMap(env => env[1].filter(([h]) => h.type === 'log').flatMap(([, p]) => p.items ?? []));
  assert.equal(logs.length, 2, `expected 2 logs, got ${logs.length}`);
  const text = JSON.stringify(logs);
  for (const secret of ['log-secret-pw', 'log-alice', 'super-secret-log-token']) assert.ok(!text.includes(secret), `LEAKED via a log: ${secret}`);
  assert.ok(logs.every(l => l.body === 'login attempt' && l.attributes['auth.result']?.value === 'ok'), 'the harmless parts should still be there');
  assert.equal(logs.filter(l => l.attributes.synthetic?.value === true).length, 1, 'only the synthetic request should carry the flag');
});
