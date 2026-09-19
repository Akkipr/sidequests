const test = require('node:test');
const assert = require('node:assert');
const { createMatching } = require('../services/matching');
const { createQuests } = require('../services/quests');
const { makeWorld, seedPeople } = require('./fakes');

async function setup({ reveal = true } = {}) {
  const world = makeWorld();
  seedPeople(world);
  const matching = createMatching({ ...world.repos, config: world.config });
  const quests = createQuests({ ...world.repos, config: world.config });
  const { matchId } = await matching.handleSignal('u-alice', { detectedWearableToken: 'tok-bob' });
  if (reveal) {
    await matching.respond('u-alice', matchId, true);
    await matching.respond('u-bob', matchId, true);
  }
  return { ...world, matching, quests, matchId, points: (u) => world.w.profiles.get(u).points };
}

test('a quest can only be picked once both people have waved', async () => {
  const { quests, matchId } = await setup({ reveal: false });
  await assert.rejects(quests.select('u-alice', matchId, 1), { status: 409 });
  await assert.rejects(quests.start('u-alice', matchId), { status: 409 });
});

test('only quests offered for the match can be picked', async () => {
  const { quests, matchId } = await setup();
  await assert.rejects(quests.select('u-alice', matchId, 4), { status: 400 });
});

test('selected -> active -> completed, visible to both players', async () => {
  const { quests, matchId } = await setup();
  assert.equal((await quests.select('u-alice', matchId, 2)).run.status, 'selected');
  assert.equal((await quests.start('u-bob', matchId)).run.status, 'active');
  const done = await quests.complete('u-alice', matchId);
  assert.equal(done.run.status, 'completed');
  assert.equal(done.awarded, true);
  assert.equal((await quests.overview('u-bob')).history.length, 1);
});

test('the pick can be swapped while only selected ("suggest another"), not after starting', async () => {
  const { quests, matchId } = await setup();
  await quests.select('u-alice', matchId, 1);
  assert.equal((await quests.select('u-alice', matchId, 3)).run.quest.id, 3);
  await quests.start('u-alice', matchId);
  await assert.rejects(quests.select('u-alice', matchId, 2), { status: 409 });
  assert.equal((await quests.select('u-alice', matchId, 3)).run.status, 'active'); // repeating the same pick is harmless
});

test('starting is idempotent', async () => {
  const { quests, matchId } = await setup();
  await quests.select('u-alice', matchId, 1);
  const first = await quests.start('u-alice', matchId);
  const second = await quests.start('u-bob', matchId);
  assert.equal(second.run.status, 'active');
  assert.equal(second.run.startedAt, first.run.startedAt);
});

test('you cannot start without a pick, or complete without starting', async () => {
  const { quests, matchId } = await setup();
  await assert.rejects(quests.start('u-alice', matchId), { status: 409 });
  await quests.select('u-alice', matchId, 1);
  await assert.rejects(quests.complete('u-alice', matchId), { status: 409 });
});

test('completing awards points to both players exactly once', async () => {
  const { quests, matchId, points } = await setup();
  await quests.select('u-alice', matchId, 1);
  await quests.start('u-alice', matchId);
  assert.equal((await quests.complete('u-alice', matchId)).awarded, true);
  assert.deepEqual([points('u-alice'), points('u-bob')], [50, 50]);

  // Repeated / concurrent-looking requests, from either player, never pay again.
  for (const uid of ['u-alice', 'u-bob', 'u-alice']) {
    const again = await quests.complete(uid, matchId);
    assert.equal(again.awarded, false);
    assert.equal(again.run.status, 'completed');
  }
  await Promise.all([quests.complete('u-alice', matchId), quests.complete('u-bob', matchId)]);
  assert.deepEqual([points('u-alice'), points('u-bob')], [50, 50]);
});

test('a completed quest cannot be restarted or re-picked', async () => {
  const { quests, matchId } = await setup();
  await quests.select('u-alice', matchId, 1);
  await quests.start('u-alice', matchId);
  await quests.complete('u-alice', matchId);
  await assert.rejects(quests.select('u-alice', matchId, 2), { status: 409 });
  assert.equal((await quests.start('u-alice', matchId)).run.status, 'completed');
});

test('only one quest can be active at a time', async () => {
  const world = await setup();
  const { w, matching, quests, matchId } = world;
  await quests.select('u-alice', matchId, 1);
  await quests.start('u-alice', matchId);
  // Alice meets Carol and picks another quest while the first is still active.
  const second = (await matching.handleSignal('u-alice', { detectedWearableToken: 'tok-carol' })).matchId;
  await matching.respond('u-alice', second, true);
  await matching.respond('u-carol', second, true);
  await quests.select('u-alice', second, 2);
  await assert.rejects(quests.start('u-alice', second), { status: 409 });
  await quests.complete('u-alice', matchId);
  assert.equal((await quests.start('u-alice', second)).run.status, 'active');
  assert.ok(w.matches.length === 2);
});

test('overview: active run, history and suggestions that exclude what you already did', async () => {
  const { quests, matchId } = await setup();
  let o = await quests.overview('u-alice');
  assert.equal(o.active, null);
  assert.equal(o.history.length, 0);
  assert.equal(o.suggested.length, 3);

  await quests.select('u-alice', matchId, 1);
  o = await quests.overview('u-alice');
  assert.equal(o.active.status, 'selected');
  assert.equal(o.active.partner.nickname, 'Bob');

  await quests.start('u-alice', matchId);
  await quests.complete('u-alice', matchId);
  o = await quests.overview('u-alice');
  assert.equal(o.active, null);
  assert.equal(o.history[0].quest.id, 1);
  assert.ok(o.suggested.every(q => q.id !== 1));
});
