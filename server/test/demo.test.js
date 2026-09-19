const test = require('node:test');
const assert = require('node:assert');
const { createMatching } = require('../services/matching');
const { createDemo } = require('../services/demo');
const { makeWorld, seedPeople } = require('./fakes');

function setup(opts) {
  const world = makeWorld(opts);
  seedPeople(world);
  const timers = [];
  const demo = createDemo({ ...world.repos, config: world.config, schedule: (fn, ms) => timers.push({ fn, ms }) });
  const matching = createMatching({ ...world.repos, config: world.config });
  return { ...world, demo, matching, timers };
}

test('demo endpoints refuse to do anything when demo mode is off', async () => {
  const { w, demo } = setup({ demo: false });
  await assert.rejects(demo.simulateNearby('u-alice'), { status: 404 });
  assert.equal(w.matches.length, 0);
});

test('demo needs the player to be discoverable first', async () => {
  const { w, demo } = setup({ demo: true });
  w.profiles.get('u-alice').status = 'off';
  await assert.rejects(demo.simulateNearby('u-alice'), { status: 409 });
});

test('simulated nearby player: match created, partner waves back after a delay, nothing revealed early', async () => {
  const { w, demo, matching, timers } = setup({ demo: true });
  const { matchId } = await demo.simulateNearby('u-alice');
  assert.equal(timers.length, 1);
  assert.equal(timers[0].ms, 6000);

  let v = await matching.get('u-alice', matchId);
  assert.equal(v.status, 'pending');
  assert.equal(v.other, null);
  assert.ok(v.score >= 70);

  await matching.respond('u-alice', matchId, true);
  assert.equal((await matching.get('u-alice', matchId)).status, 'pending'); // still waiting on the simulated player

  await timers[0].fn(); // the simulated player waves
  await new Promise(r => setImmediate(r));
  v = await matching.get('u-alice', matchId);
  assert.equal(v.status, 'revealed');
  assert.ok(v.other.nickname);
  assert.equal(v.quests.length, 3);
  assert.ok(w.demoPartners.has('u-alice'));
});

test('the simulated partner is reused, not duplicated, on repeat runs', async () => {
  const { w, demo } = setup({ demo: true });
  await demo.simulateNearby('u-alice');
  await demo.simulateNearby('u-alice');
  assert.equal(w.demoPartners.size, 1);
  assert.equal(w.matches.length, 2);
});
