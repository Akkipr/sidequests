import test from 'node:test';
import assert from 'node:assert/strict';
import { dropExpected, isExpectedError, parseSampleRate, releaseName, REPLAY_PRIVACY, replayRates, routeName, scrubLog } from './monitoringFilters.ts';

class AuthError extends Error {
  name = 'AuthError';
}

test('an expired or missing session is expected, not a bug', () => {
  assert.equal(isExpectedError(new AuthError('Session expired')), true);
  assert.equal(isExpectedError(Object.assign(new Error('Not signed in'), { name: 'AuthError' })), true);
});

test('real errors are not expected', () => {
  assert.equal(isExpectedError(new Error('boom')), false);
  assert.equal(isExpectedError(new TypeError("undefined is not an object (evaluating 'x.y')")), false);
});

test('odd values never throw and are never treated as expected', () => {
  for (const v of [undefined, null, 0, '', 'AuthError', {}, { name: 42 }, { name: null }, []]) assert.equal(isExpectedError(v), false, String(v));
});

test('the Sentry hook drops expected errors and keeps everything else', () => {
  const event = { message: 'x' };
  assert.equal(dropExpected(event, { originalException: new AuthError('Session expired') }), null);
  assert.equal(dropExpected(event, { originalException: new Error('real bug') }), event);
  assert.equal(dropExpected(event, {}), event);      // no original exception (e.g. a captured message)
  assert.equal(dropExpected(event, undefined), event);
});

test('the release is <slug>@<version> unless CI overrides it', () => {
  assert.equal(releaseName({ slug: 'sidequests', version: '1.0.0' }), 'sidequests@1.0.0');
  assert.equal(releaseName({ slug: 'sidequests', version: '1.2.3', override: null }), 'sidequests@1.2.3');
  assert.equal(releaseName({ slug: 'sidequests', version: '1.0.0', override: '' }), 'sidequests@1.0.0');
  assert.equal(releaseName({ slug: 'sidequests', version: '1.0.0', override: '   ' }), 'sidequests@1.0.0');
  assert.equal(releaseName({ slug: 'sidequests', version: '1.0.0', override: ' sidequests@1.0.0+abc123 ' }), 'sidequests@1.0.0+abc123');
});

test('sampling rates are parsed strictly and fall back on anything odd', () => {
  assert.equal(parseSampleRate('0.5', 1), 0.5);
  assert.equal(parseSampleRate('0', 1), 0);   // zero is a real setting, not "missing"
  assert.equal(parseSampleRate('1', 0.2), 1);
  for (const bad of [undefined, null, '', '  ', 'abc', '-0.1', '1.5', 'NaN', 'Infinity']) assert.equal(parseSampleRate(bad, 0.25), 0.25, String(bad));
});

test('span names use the route pattern, never a real id or query string', () => {
  assert.equal(routeName('/matches/123/respond'), '/matches/:id/respond');
  assert.equal(routeName('/matches/9/quest/start'), '/matches/:id/quest/start');
  assert.equal(routeName('/matches/9?token=secret'), '/matches/:id');
  assert.equal(routeName('/blocks/0a496dfe-209a-4154-b36e-8598b52009ba'), '/blocks/:id'); // a uuid that starts with a digit
  assert.equal(routeName('/quests'), '/quests');
  assert.equal(routeName('/profile'), '/profile');
});

test('logs drop sensitive attributes whatever their spelling', () => {
  const out = scrubLog({ message: 'x', attributes: {
    password: 'p', Password: 'p', token: 't', sessionId: 's', Authorization: 'a', nickname: 'alice', email: 'a@b.c', apiKey: 'k',
    intent: 'food', 'match.status': 'pending', ok: true, count: 3,
  } });
  assert.deepEqual(out.attributes, { intent: 'food', 'match.status': 'pending', ok: true, count: 3 });
});

test('logs redact token-shaped text and cap long values', () => {
  const token = 'a1b2c3d4'.repeat(8);
  const out = scrubLog({ message: `sent ${token}`, attributes: { detail: `Bearer ${token}`, big: 'x'.repeat(5000) } });
  assert.equal(out.message, 'sent [redacted]');
  assert.equal(out.attributes?.detail, '[redacted]');
  assert.equal((out.attributes?.big as string).length, 500);
  assert.ok(!JSON.stringify(out).includes(token));
});

test('logs without attributes, and other fields of the log, are left alone', () => {
  assert.deepEqual(scrubLog({ message: 'hello' }), { message: 'hello', attributes: {} });
  assert.equal((scrubLog({ message: 'm', level: 'warn' } as { message: string; level: string })).level, 'warn');
});

test('session replay masks all text, images and vectors, and this must never be loosened', () => {
  assert.deepEqual(REPLAY_PRIVACY, { maskAllText: true, maskAllImages: true, maskAllVectors: true });
});

test('replay records every session while developing and 10% otherwise; errors are always recorded', () => {
  assert.deepEqual(replayRates(undefined, true), { session: 1, onError: 1 });
  assert.deepEqual(replayRates(undefined, false), { session: 0.1, onError: 1 });
  assert.deepEqual(replayRates('0.5', false), { session: 0.5, onError: 1 });
  assert.deepEqual(replayRates('0', true), { session: 0, onError: 1 });   // zero switches ordinary-session replay off
  assert.deepEqual(replayRates('nope', false), { session: 0.1, onError: 1 }); // a bad value falls back, never to "record everything"
  assert.deepEqual(replayRates('5', false), { session: 0.1, onError: 1 });
});
