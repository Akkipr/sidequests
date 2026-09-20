import test from 'node:test';
import assert from 'node:assert/strict';
import { dropExpected, isExpectedError } from './monitoringFilters.ts';

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
