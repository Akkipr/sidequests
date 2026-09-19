const test = require('node:test');
const assert = require('node:assert');
const { score, THRESHOLD } = require('../services/scoring');

const p = (o) => ({ archetypes: [], answers: {}, wants: [], budget: 'low', status: 'open', ...o });
const twin = p({ archetypes: ['foodie', 'explorer'], answers: { foodie_spicy: 'yes', explorer_plan: 'wing' }, status: 'food' });

test('identical profiles score high', () => {
  assert(score(twin, twin).score >= 90);
});
test('nothing shared does not reach the match threshold', () => {
  assert(score(p({ archetypes: ['foodie'] }), p({ archetypes: ['active'] })).score < THRESHOLD);
});
test('an unmet "who I want to meet" preference blocks the match', () => {
  assert.equal(score(p({ archetypes: ['foodie'], wants: ['active'] }), p({ archetypes: ['foodie'] })), null);
});
test('discovery off is never scored, on either side', () => {
  assert.equal(score(p({ archetypes: ['foodie'] }), p({ archetypes: ['foodie'], status: 'off' })), null);
  assert.equal(score(p({ archetypes: ['foodie'], status: 'off' }), p({ archetypes: ['foodie'] })), null);
});
test('reason mentions the shared classes', () => {
  assert.match(score(twin, twin).reason, /Foodies and Explorers/);
});
