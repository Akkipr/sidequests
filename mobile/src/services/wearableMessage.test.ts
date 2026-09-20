import test from 'node:test';
import assert from 'node:assert/strict';
import { parseWearableMessage as parse, TOKEN_RE } from './wearableMessage.ts';

test('NEAR carries the exact peer token and rssi', () => {
  assert.deepEqual(parse('NEAR:x7Kp2mQ9:-57'), { kind: 'near', token: 'x7Kp2mQ9', rssi: -57 });
  assert.deepEqual(parse('  NEAR:peer.token_1-A:-101\n'), { kind: 'near', token: 'peer.token_1-A', rssi: -101 });
  assert.deepEqual(parse('NEAR:abcd1234:0'), { kind: 'near', token: 'abcd1234', rssi: 0 });
});

test('IDLE and the legacy MATCH are still understood', () => {
  assert.deepEqual(parse('IDLE'), { kind: 'idle' });
  assert.deepEqual(parse('MATCH\n'), { kind: 'legacy_match' });
});

test('malformed messages are ignored, never guessed at', () => {
  for (const bad of ['', 'NEAR', 'NEAR:', 'NEAR::-57', 'NEAR:abc:-57', 'NEAR:abcd1234', 'NEAR:abcd1234:', 'NEAR:abcd1234:fast',
    'NEAR:ab:cd:-57', 'near:abcd1234:-57', 'MATCH:x', 'IDLE!', 'NEAR:abcd1234:-57:extra', `NEAR:${'x'.repeat(129)}:-57`]) {
    assert.equal(parse(bad), null, JSON.stringify(bad));
  }
});

test("a token can't contain ':' (it would break the message), and must be long enough", () => {
  assert.equal(TOKEN_RE.test('a:b-token'), false);
  assert.equal(TOKEN_RE.test('abc'), false);
  assert.equal(TOKEN_RE.test('abcd'), true);
  assert.equal(TOKEN_RE.test('x'.repeat(128)), true);
  assert.equal(TOKEN_RE.test('x'.repeat(129)), false);
});

test('the wearable buttons answer a match', () => {
  assert.deepEqual(parse('WAVE'), { kind: 'wave' });
  assert.deepEqual(parse(' PASS\n'), { kind: 'pass' });
  assert.equal(parse('WAVEY'), null);
});
