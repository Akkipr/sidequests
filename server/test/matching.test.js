const test = require('node:test');
const assert = require('node:assert');
const { createMatching } = require('../services/matching');
const { makeWorld, seedPeople } = require('./fakes');

function setup(opts) {
  const world = makeWorld(opts);
  seedPeople(world);
  const matching = createMatching({ ...world.repos, config: world.config });
  const near = (uid, token) => matching.handleSignal(uid, { detectedWearableToken: token, rssi: -57, timestamp: 1790000000 });
  return { ...world, matching, near };
}

test('exact peer: only the detected wearable is paired, never a bystander who also signalled', async () => {
  const { w, near } = setup();
  // Carol is nearby and reporting too, but Alice's phone only saw Bob's wearable.
  w.proximity.push({ uid: 'u-carol', at: Date.now() });
  const { matchId } = await near('u-alice', 'tok-bob');
  const m = w.matches.find(x => x.id === matchId);
  assert.deepEqual([m.user_a, m.user_b], ['u-alice', 'u-bob']);
  assert.equal(w.matches.length, 1);
});

test('exact peer: detecting a different wearable pairs that pair instead', async () => {
  const { w, near } = setup();
  await near('u-alice', 'tok-bob');
  const { matchId } = await near('u-alice', 'tok-carol');
  const m = w.matches.find(x => x.id === matchId);
  assert.deepEqual([m.user_a, m.user_b], ['u-alice', 'u-carol']);
});

test('signals record the exact peer and rssi', async () => {
  const { w, near } = setup();
  await near('u-alice', 'tok-bob');
  assert.deepEqual(w.proximity.map(({ uid, peer, rssi }) => ({ uid, peer, rssi })), [{ uid: 'u-alice', peer: 'u-bob', rssi: -57 }]);
});

test('an unknown wearable token matches nobody', async () => {
  const { w, near } = setup();
  assert.deepEqual(await near('u-alice', 'tok-stranger'), { matchId: null, reason: 'unknown_wearable' });
  assert.equal(w.matches.length, 0);
});

test('detecting your own wearable is ignored', async () => {
  const { near } = setup();
  assert.equal((await near('u-alice', 'tok-alice')).matchId, null);
});

test('malformed tokens are rejected before any lookup', async () => {
  const { matching } = setup();
  for (const bad of ['', 'a:b', 'x'.repeat(200), 42, null]) {
    await assert.rejects(matching.handleSignal('u-alice', { detectedWearableToken: bad }), { status: 400 });
  }
});

test('while a match is open, repeated signals from either phone return the same one', async () => {
  const { w, near } = setup();
  const first = await near('u-alice', 'tok-bob');
  const second = await near('u-bob', 'tok-alice');
  assert.equal(first.matchId, second.matchId);
  assert.equal((await near('u-alice', 'tok-bob')).matchId, first.matchId);
  assert.equal(w.matches.length, 1);
});

test('both phones detecting each other at the same instant still end up in ONE match', async () => {
  const { near } = setup();
  const [a, b] = await Promise.all([near('u-alice', 'tok-bob'), near('u-bob', 'tok-alice')]);
  assert.ok(a.matchId);
  assert.equal(a.matchId, b.matchId); // otherwise they would wave at different matches and never be revealed
});

// --- no cooldown between meetings ---

test('no cooldown: once a match is revealed, the same two people can match again straight away', async () => {
  const { w, matching, near } = setup();
  const first = (await near('u-alice', 'tok-bob')).matchId;
  await matching.respond('u-alice', first, true);
  await matching.respond('u-bob', first, true); // revealed
  const again = (await near('u-alice', 'tok-bob')).matchId;
  assert.ok(again);
  assert.notEqual(again, first);
  assert.equal(w.matches.length, 2);
  assert.equal((await matching.get('u-alice', first)).status, 'revealed'); // the earlier meeting is untouched
  assert.equal((await matching.get('u-alice', again)).status, 'pending');
});

test('no cooldown: after "not now" (or a withdrawn wave) they can be matched again straight away', async () => {
  const { matching, near } = setup();
  const first = (await near('u-alice', 'tok-bob')).matchId;
  await matching.respond('u-bob', first, false);
  const second = (await near('u-alice', 'tok-bob')).matchId;
  assert.notEqual(second, first);

  await matching.respond('u-alice', second, true);
  await matching.respond('u-alice', second, false); // waved, then cancelled
  const third = (await near('u-bob', 'tok-alice')).matchId;
  assert.notEqual(third, second);
});

test('they can meet again and again, any number of times', async () => {
  const { w, matching, near } = setup();
  const ids = new Set();
  for (let i = 0; i < 6; i++) {
    const id = (await near(i % 2 ? 'u-bob' : 'u-alice', i % 2 ? 'tok-alice' : 'tok-bob')).matchId;
    ids.add(id);
    await matching.respond('u-alice', id, true);
    await matching.respond('u-bob', id, true);
  }
  assert.equal(ids.size, 6);
  assert.equal(w.matches.length, 6);
});

test('an unanswered match goes stale after the window, and a fresh one can start', async () => {
  const { w, near } = setup();
  const first = (await near('u-alice', 'tok-bob')).matchId;
  w.matches[0].created_at -= 11 * 60000; // 11 minutes ago
  const second = (await near('u-alice', 'tok-bob')).matchId;
  assert.notEqual(second, first);
});

test('no cooldown does not mean no limits: a blocked pair never matches again, even after an earlier meeting ended', async () => {
  const { w, matching, near } = setup();
  const first = (await near('u-alice', 'tok-bob')).matchId;
  await matching.respond('u-alice', first, true);
  await matching.respond('u-bob', first, true);
  await matching.block('u-alice', first, 'no thanks');
  assert.equal((await near('u-alice', 'tok-bob')).matchId, null);
  assert.equal((await near('u-bob', 'tok-alice')).matchId, null);
  assert.equal(w.matches.length, 1);
});

test('no cooldown does not mean everyone: both people must still be discoverable', async () => {
  const { w, matching, near } = setup();
  const first = (await near('u-alice', 'tok-bob')).matchId;
  await matching.respond('u-alice', first, true);
  await matching.respond('u-bob', first, true);
  w.profiles.get('u-bob').status = 'off';
  assert.equal((await near('u-alice', 'tok-bob')).matchId, null);
});

test('blocked users never match, in either direction', async () => {
  const { w, near } = setup();
  w.blocks.push({ blocker: 'u-bob', blocked: 'u-alice' });
  assert.equal((await near('u-alice', 'tok-bob')).matchId, null);
  assert.equal((await near('u-bob', 'tok-alice')).matchId, null);
  assert.equal(w.matches.length, 0);
});

test('a block also stops an existing recent match from being handed back', async () => {
  const { w, near } = setup();
  assert.ok((await near('u-alice', 'tok-bob')).matchId);
  w.blocks.push({ blocker: 'u-alice', blocked: 'u-bob' });
  assert.equal((await near('u-alice', 'tok-bob')).matchId, null);
  assert.equal((await near('u-bob', 'tok-alice')).matchId, null);
});

test('discovery-off users never match, whichever side is private', async () => {
  const { w, near } = setup();
  w.profiles.get('u-bob').status = 'off';
  assert.equal((await near('u-alice', 'tok-bob')).matchId, null);
  w.profiles.get('u-bob').status = 'food';
  w.profiles.get('u-alice').status = 'off';
  assert.equal((await near('u-alice', 'tok-bob')).matchId, null);
  assert.equal(w.matches.length, 0);
});

test('going private also stops an existing recent match from being handed back', async () => {
  const { w, near } = setup();
  assert.ok((await near('u-alice', 'tok-bob')).matchId);
  w.profiles.get('u-alice').status = 'off';
  assert.equal((await near('u-alice', 'tok-bob')).matchId, null);
});

test('incompatible pairs do not match', async () => {
  const { w, near } = setup();
  w.profiles.get('u-bob').archetypes = ['active'];
  w.profiles.get('u-bob').answers = {};
  assert.equal((await near('u-alice', 'tok-bob')).matchId, null);
});

// --- legacy time-window signals ---

test('legacy signals are disabled outside demo mode', async () => {
  const { w, matching } = setup({ demo: false });
  w.proximity.push({ uid: 'u-bob', at: Date.now() });
  await assert.rejects(matching.handleSignal('u-alice', {}), { status: 403 });
  assert.equal(w.matches.length, 0);
});

test('legacy signals work in demo mode (time-window pairing)', async () => {
  const { w, matching } = setup({ demo: true });
  w.proximity.push({ uid: 'u-bob', at: Date.now() });
  const { matchId } = await matching.handleSignal('u-alice', {});
  assert.ok(matchId);
  assert.deepEqual([w.matches[0].user_a, w.matches[0].user_b], ['u-alice', 'u-bob']);
});

test('legacy pairing still honours blocks and discovery-off', async () => {
  const { w, matching } = setup({ demo: true });
  w.proximity.push({ uid: 'u-bob', at: Date.now() });
  w.blocks.push({ blocker: 'u-alice', blocked: 'u-bob' });
  assert.equal((await matching.handleSignal('u-alice', {})).matchId, null);
});

// --- mutual wave privacy ---

test('identity and quests stay hidden until BOTH people wave', async () => {
  const { matching, near } = setup();
  const { matchId } = await near('u-alice', 'tok-bob');
  const hidden = (v) => {
    assert.equal(v.other, null);
    assert.deepEqual(v.quests, []);
    assert.equal(v.questId, null);
    assert.doesNotMatch(JSON.stringify(v), /Alice|Bob|🧙|🥷/);
  };

  hidden(await matching.get('u-alice', matchId));
  hidden(await matching.get('u-bob', matchId));

  hidden(await matching.respond('u-alice', matchId, true)); // one-sided wave reveals nothing to either side
  hidden(await matching.get('u-bob', matchId));

  const bobView = await matching.respond('u-bob', matchId, true);
  assert.equal(bobView.status, 'revealed');
  assert.equal(bobView.other.nickname, 'Alice');
  assert.equal(bobView.quests.length, 3);
  assert.equal((await matching.get('u-alice', matchId)).other.nickname, 'Bob');
});

test('a declined match never reveals anyone', async () => {
  const { matching, near } = setup();
  const { matchId } = await near('u-alice', 'tok-bob');
  await matching.respond('u-alice', matchId, true);
  const v = await matching.respond('u-bob', matchId, false);
  assert.equal(v.status, 'declined');
  assert.equal(v.other, null);
  assert.equal((await matching.get('u-alice', matchId)).other, null);
});

test('a wave can be withdrawn before the match resolves, but not after', async () => {
  const { matching, near } = setup();
  const { matchId } = await near('u-alice', 'tok-bob');
  await matching.respond('u-alice', matchId, true);
  assert.equal((await matching.respond('u-alice', matchId, false)).status, 'declined');
  // Bob waving afterwards cannot reveal a withdrawn wave.
  const v = await matching.respond('u-bob', matchId, true);
  assert.equal(v.status, 'declined');
  assert.equal(v.other, null);
});

test('once revealed, a response cannot be changed', async () => {
  const { matching, near } = setup();
  const { matchId } = await near('u-alice', 'tok-bob');
  await matching.respond('u-alice', matchId, true);
  await matching.respond('u-bob', matchId, true);
  assert.equal((await matching.respond('u-alice', matchId, false)).status, 'revealed');
});

test('blocking a match declines it for the blocker so it can never reveal', async () => {
  const { w, matching, near } = setup();
  const { matchId } = await near('u-alice', 'tok-bob');
  await matching.block('u-alice', matchId, 'report');
  assert.equal(w.blocks.length, 1);
  const v = await matching.respond('u-bob', matchId, true);
  assert.equal(v.status, 'declined');
  assert.equal(v.other, null);
});

test('you cannot read or act on someone else\'s match', async () => {
  const { matching, near } = setup();
  const { matchId } = await near('u-alice', 'tok-bob');
  await assert.rejects(matching.get('u-carol', matchId), { status: 404 });
  await assert.rejects(matching.respond('u-carol', matchId, true), { status: 404 });
  await assert.rejects(matching.get('u-alice', 'not-a-number'), { status: 404 });
});

test('the partner finds the match their own signal never created', async () => {
  const { matching, near } = setup();
  const { matchId } = await near('u-alice', 'tok-bob'); // only Alice's wearable reported
  assert.equal((await matching.current('u-bob'))?.id, matchId);
  assert.equal((await matching.current('u-alice'))?.id, matchId);
});

test('a declined match is not handed back as current', async () => {
  const { matching, near } = setup();
  const { matchId } = await near('u-alice', 'tok-bob');
  await matching.respond('u-bob', matchId, false);
  assert.equal(await matching.current('u-bob'), null);
  assert.equal(await matching.current('u-alice'), null);
});

test('nobody with no match gets one', async () => {
  const { matching } = setup();
  assert.equal(await matching.current('u-carol'), null);
});
