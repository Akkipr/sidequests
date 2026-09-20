import test from 'node:test';
import assert from 'node:assert/strict';
import { dropExpected, isExpectedError, parseSampleRate, releaseName } from './monitoringFilters.ts';

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
