import test from 'node:test';
import assert from 'node:assert/strict';
import {
  discoveryReducer as reduce, transition, initialModel, inMatchFlow, isListening, isPolling, serverStatus, violations,
  type DiscoveryEvent, type DiscoveryModel,
} from './discoveryMachine.ts';

const match = (o: Record<string, unknown> = {}) => ({
  id: 7, score: 88, reason: 'r', shared: ['foodie'], myResponse: null, status: 'pending', other: null, quests: [],
  questId: null, questStatus: null, ...o,
}) as never;
const revealed = () => match({ status: 'revealed', myResponse: true, other: { nickname: 'Bob', avatar: '🥷', archetypes: ['foodie'] } });

const run = (m: DiscoveryModel, ...events: DiscoveryEvent[]) => events.reduce(reduce, m);
const linked = (allowSimulated = false) => run(initialModel(allowSimulated), { type: 'WEARABLE_LINKED' });
const scanning = () => run(linked(), { type: 'START', intent: 'food' });

test('discovery always starts private with nothing selected', () => {
  const m = initialModel();
  assert.equal(m.state, 'private');
  assert.equal(m.match, null);
  assert.equal(m.quest, null);
  assert.equal(serverStatus(m), 'off');
  assert.deepEqual(violations(m), []);
});

test('start without a wearable connects first, then scans once linked', () => {
  let m = run(initialModel(), { type: 'START', intent: 'food' });
  assert.equal(m.state, 'connecting');
  assert.equal(serverStatus(m), 'off'); // not discoverable until actually scanning
  m = run(m, { type: 'WEARABLE_LINKED' });
  assert.equal(m.state, 'scanning');
  assert.equal(m.intent, 'food');
  assert.equal(serverStatus(m), 'food');
});

test('start with a linked wearable scans immediately', () => {
  assert.equal(run(linked(), { type: 'START', intent: 'open' }).state, 'scanning');
});

test('a failed connection returns to private with the reason', () => {
  const m = run(initialModel(), { type: 'START', intent: 'open' }, { type: 'WEARABLE_FAILED', message: 'No wearable found' });
  assert.equal(m.state, 'private');
  assert.equal(m.wearable.kind, 'failed');
  assert.equal(m.message, 'No wearable found');
});

test('never scanning without a linked wearable: losing the link drops to private', () => {
  const m = run(scanning(), { type: 'WEARABLE_LOST' });
  assert.equal(m.state, 'private');
  assert.equal(m.wearable.kind, 'none');
  assert.deepEqual(violations(m), []);
});

test('demo mode may scan without a wearable, and losing one does not stop it', () => {
  let m = run(initialModel(true), { type: 'START', intent: 'open' });
  assert.equal(m.state, 'scanning');
  m = run(m, { type: 'WEARABLE_FAILED', message: 'x' });
  assert.equal(m.state, 'scanning');
});

test('reconnecting mid-scan pauses discovery until the wearable links again', () => {
  let m = run(scanning(), { type: 'WEARABLE_CONNECTING' });
  assert.equal(m.state, 'connecting');
  assert.equal(serverStatus(m), 'off');
  m = run(m, { type: 'WEARABLE_LINKED' });
  assert.equal(m.state, 'scanning');
});

test('a wearable dropping mid-match does not kill the match', () => {
  const m = run(scanning(), { type: 'MATCH_DETECTED', match: match() }, { type: 'WEARABLE_LOST' });
  assert.equal(m.state, 'candidate_detected');
});

test('signals only count while scanning', () => {
  assert.equal(run(initialModel(), { type: 'MATCH_DETECTED', match: match() }).state, 'private');
  const inMatch = run(scanning(), { type: 'MATCH_DETECTED', match: match() });
  assert.equal(run(inMatch, { type: 'MATCH_DETECTED', match: match({ id: 9 }) }).match?.id, 7); // second one ignored
});

test('full journey: scan -> candidate -> wave -> matched -> quest selected -> active -> complete', () => {
  let m = scanning();
  assert.equal(isListening(m), true);

  m = run(m, { type: 'MATCH_DETECTED', match: match() });
  assert.equal(m.state, 'candidate_detected');
  assert.equal(isListening(m), false);
  assert.equal(isPolling(m), false);

  m = run(m, { type: 'WAVE_SENT', match: match({ myResponse: true }) });
  assert.equal(m.state, 'waiting_for_wave');
  assert.equal(isPolling(m), true);
  assert.equal(serverStatus(m), 'food');

  m = run(m, { type: 'MATCH_UPDATED', match: revealed() });
  assert.equal(m.state, 'matched');
  assert.equal(isPolling(m), false); // a resolved match never keeps polling
  assert.equal(serverStatus(m), 'off'); // in a party: no longer discoverable to others

  m = run(m, { type: 'QUEST_SELECTED', matchId: 7, questId: 2 });
  assert.equal(m.state, 'quest_selected');
  assert.deepEqual(m.quest, { matchId: 7, questId: 2 });
  assert.equal(m.match?.id, 7); // the party stays visible while a quest is picked

  m = run(m, { type: 'QUEST_SELECTED', matchId: 7, questId: 3 }); // "suggest another"
  assert.equal(m.quest?.questId, 3);

  m = run(m, { type: 'QUEST_STARTED', matchId: 7, questId: 3 });
  assert.equal(m.state, 'quest_active');

  assert.equal(m.match, null); // starting the quest closes out the match flow

  m = run(m, { type: 'QUEST_COMPLETED', matchId: 99 }); // some other run: ignored
  assert.equal(m.state, 'quest_active');

  m = run(m, { type: 'QUEST_COMPLETED', matchId: 7 });
  assert.equal(m.state, 'private');
  assert.equal(m.quest, null);
  assert.deepEqual(violations(m), []);
});

test('the other person already waved: candidate can go straight to matched', () => {
  const m = run(scanning(), { type: 'MATCH_DETECTED', match: match() }, { type: 'MATCH_UPDATED', match: revealed() });
  assert.equal(m.state, 'matched');
});

test('going private stops polling and clears the match', () => {
  let m = run(scanning(), { type: 'MATCH_DETECTED', match: match() }, { type: 'WAVE_SENT', match: match({ myResponse: true }) });
  assert.equal(isPolling(m), true);
  m = run(m, { type: 'GO_PRIVATE' });
  assert.equal(m.state, 'private');
  assert.equal(m.match, null);
  assert.equal(isPolling(m), false);
  assert.equal(serverStatus(m), 'off');
});

test('declined by the other person, timeout and cancel all return to scanning without polling', () => {
  const waiting = () => run(scanning(), { type: 'MATCH_DETECTED', match: match() }, { type: 'WAVE_SENT', match: match({ myResponse: true }) });

  let m = run(waiting(), { type: 'MATCH_UPDATED', match: match({ status: 'declined', myResponse: true }) });
  assert.equal(m.state, 'scanning');
  assert.equal(isPolling(m), false);

  m = run(waiting(), { type: 'WAVE_TIMEOUT' });
  assert.equal(m.state, 'scanning');
  assert.match(m.message ?? '', /NO WAVE BACK/);

  m = run(waiting(), { type: 'MATCH_CLOSED' });
  assert.equal(m.state, 'scanning');
  assert.equal(m.match, null);
});

test('losing the wearable mid-wave never leaves the app stuck waiting', () => {
  const waiting = run(scanning(), { type: 'MATCH_DETECTED', match: match() }, { type: 'WAVE_SENT', match: match({ myResponse: true }) }, { type: 'WEARABLE_LOST' });
  assert.equal(waiting.state, 'waiting_for_wave'); // the wave in progress is left alone...
  for (const e of [{ type: 'WAVE_TIMEOUT' }, { type: 'MATCH_CLOSED' }, { type: 'MATCH_UPDATED', match: match({ status: 'declined', myResponse: true }) }] as DiscoveryEvent[]) {
    assert.equal(reduce(waiting, e).state, 'private', e.type); // ...but it must be able to end, and lands on private
  }
});

test('a quest cannot be active without a selected quest, or selected outside a party', () => {
  assert.equal(run(scanning(), { type: 'QUEST_SELECTED', matchId: 1, questId: 1 }).state, 'scanning');
  assert.equal(run(initialModel(), { type: 'QUEST_COMPLETED', matchId: 1 }).state, 'private');
  // Starting from the Quests tab (e.g. after an app restart) carries its own quest, so it is consistent.
  const m = run(initialModel(), { type: 'QUEST_STARTED', matchId: 4, questId: 2 });
  assert.equal(m.state, 'quest_active');
  assert.deepEqual(m.quest, { matchId: 4, questId: 2 });
});

test('intent changes only while connecting or scanning', () => {
  assert.equal(run(scanning(), { type: 'CHANGE_INTENT', intent: 'hour' }).intent, 'hour');
  assert.equal(run(initialModel(), { type: 'CHANGE_INTENT', intent: 'hour' }).intent, 'open');
});

test('server discovery flag is derived: on only while scanning or mid-wave', () => {
  const states: Array<[DiscoveryModel, string]> = [
    [initialModel(), 'off'],
    [run(initialModel(), { type: 'START', intent: 'hour' }), 'off'], // connecting
    [run(linked(), { type: 'START', intent: 'hour' }), 'hour'],
    [run(scanning(), { type: 'MATCH_DETECTED', match: match() }), 'food'],
    [run(scanning(), { type: 'MATCH_DETECTED', match: revealed() }), 'off'],
  ];
  for (const [m, want] of states) assert.equal(serverStatus(m), want, m.state);
});

test('inMatchFlow covers exactly the states the Match screen shows', () => {
  assert.deepEqual(
    (['private', 'connecting', 'scanning', 'candidate_detected', 'waiting_for_wave', 'matched', 'quest_selected', 'quest_active'] as const)
      .filter(inMatchFlow),
    ['candidate_detected', 'waiting_for_wave', 'matched', 'quest_selected']);
});

test('random event storm: no reachable state is ever contradictory', () => {
  let seed = 12345; // small deterministic PRNG so failures reproduce
  const rand = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)];
  const statuses = ['pending', 'revealed', 'declined'] as const;
  const anyMatch = () => match({ id: pick([7, 8]), status: pick(statuses), myResponse: pick([null, true, false]) });
  const events = (): DiscoveryEvent => pick<DiscoveryEvent>([
    { type: 'START', intent: pick(['open', 'food', 'hour'] as const) },
    { type: 'CHANGE_INTENT', intent: pick(['open', 'food', 'hour'] as const) },
    { type: 'GO_PRIVATE' }, { type: 'WEARABLE_CONNECTING' }, { type: 'WEARABLE_LINKED' },
    { type: 'WEARABLE_FAILED', message: 'x' }, { type: 'WEARABLE_LOST' },
    { type: 'MATCH_DETECTED', match: pick([match(), match({ myResponse: true }), revealed(), match({ status: 'declined', myResponse: false })]) }, { type: 'WAVE_SENT', match: anyMatch() },
    { type: 'MATCH_UPDATED', match: anyMatch() }, { type: 'MATCH_CLOSED' }, { type: 'WAVE_TIMEOUT' },
    { type: 'QUEST_SELECTED', matchId: 7, questId: pick([1, 2, 3]) },
    { type: 'QUEST_STARTED', matchId: 7, questId: pick([1, 2, 3]) }, { type: 'QUEST_COMPLETED', matchId: pick([7, 8]) },
  ]);

  for (const allowSimulated of [false, true]) {
    let m = initialModel(allowSimulated);
    for (let i = 0; i < 25000; i++) {
      const e = events();
      if (e.type !== 'MATCH_UPDATED' && e.type !== 'WAVE_SENT') {
        // The guard is only a safety net: these transitions must be consistent on their own.
        assert.deepEqual(violations(transition(m, e)), [], `raw transition #${i} ${JSON.stringify(e)} from ${m.state}`);
      }
      m = reduce(m, e);
      const bad = violations(m);
      assert.deepEqual(bad, [], `after #${i} ${JSON.stringify(e)} -> ${m.state}`);
      // The derived effects can never contradict the state.
      if (m.state === 'private') assert.equal(isPolling(m), false);
      if (isPolling(m)) assert.equal(m.match?.myResponse, true);
    }
  }
});
