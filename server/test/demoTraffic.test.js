const test = require('node:test');
const assert = require('node:assert/strict');
const { parseArgs, percentile, routeKey, mulberry32, LIMITS } = require('../scripts/demo-traffic');

test('sensible defaults, and BASE from the environment', () => {
  assert.deepEqual(
    (({ players, rounds, concurrency, boom, keep, base }) => ({ players, rounds, concurrency, boom, keep, base }))(parseArgs([], {})),
    { players: 6, rounds: 2, concurrency: 3, boom: 2, keep: false, base: 'http://localhost:3000' });
  assert.equal(parseArgs([], { BASE: 'http://api.test:4000/' }).base, 'http://api.test:4000');
});

test('flags work as "--x n" and "--x=n"', () => {
  const o = parseArgs(['--players', '10', '--rounds=3', '--concurrency', '5', '--boom=0', '--keep', '--seed=7']);
  assert.deepEqual([o.players, o.rounds, o.concurrency, o.boom, o.keep, o.seed], [10, 3, 5, 0, true, 7]);
});

test('a URL containing "=" is kept intact', () => {
  assert.equal(parseArgs(['--base=http://host/x?a=b']).base, 'http://host/x?a=b');
});

test('bad input is rejected with a clear message, so a typo cannot flood the server', () => {
  assert.throws(() => parseArgs(['--players', 'abc']), /--players must be a whole number/);
  assert.throws(() => parseArgs(['--players', '1.5']), /--players/);
  assert.throws(() => parseArgs(['--players', String(LIMITS.players + 1)]), /--players/);
  assert.throws(() => parseArgs(['--concurrency', '-1']), /--concurrency/);
  assert.throws(() => parseArgs(['--players', '0']), /at least 1/);
  assert.throws(() => parseArgs(['--nope']), /unknown option --nope/);
});

test('--help is recognised', () => {
  assert.equal(parseArgs(['--help']).help, true);
  assert.equal(parseArgs(['-h']).help, true);
});

test('percentiles (nearest rank) are right, including edge cases', () => {
  const v = [15, 20, 35, 40, 50];
  assert.equal(percentile(v, 50), 35);
  assert.equal(percentile(v, 95), 50);
  assert.equal(percentile(v, 0), 15);
  assert.equal(percentile(v, 100), 50);
  assert.equal(percentile([7], 95), 7);
  assert.equal(percentile([], 50), 0);
  assert.deepEqual(v, [15, 20, 35, 40, 50]); // input is not mutated
  assert.equal(percentile([50, 15, 40, 20, 35], 50), 35); // unsorted input
});

test('routes group by pattern so /matches/1/respond and /matches/2/respond are one row', () => {
  assert.equal(routeKey('POST', '/matches/123/respond'), 'POST /matches/:id/respond');
  assert.equal(routeKey('POST', '/matches/456/respond'), 'POST /matches/:id/respond');
  assert.equal(routeKey('GET', '/matches/9?x=1'), 'GET /matches/:id');
  assert.equal(routeKey('DELETE', '/blocks/0a496dfe-209a-4154-b36e-8598b52009ba'), 'DELETE /blocks/:id');
  assert.equal(routeKey('GET', '/quests'), 'GET /quests');
});

test('the seeded random generator repeats exactly and stays in [0, 1)', () => {
  const a = mulberry32(42);
  const b = mulberry32(42);
  const seqA = Array.from({ length: 5 }, a);
  assert.deepEqual(seqA, Array.from({ length: 5 }, b));
  assert.ok(seqA.every(x => x >= 0 && x < 1));
  assert.notDeepEqual(seqA, Array.from({ length: 5 }, mulberry32(43)));
});
