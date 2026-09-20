// Real SQL against the real database. Skipped unless RUN_DB_TESTS=true (use `npm run test:db`), because it needs
// DATABASE_URL and writes rows. It only ever touches rows with source = 'wat2do-test' and deletes them afterwards.
const test = require('node:test');
const assert = require('node:assert/strict');

if (process.env.RUN_DB_TESTS !== 'true') {
  test('database tests', { skip: 'set RUN_DB_TESTS=true (npm run test:db) to run them against DATABASE_URL' }, () => {});
} else {
  require('dotenv').config({ quiet: true });
  const { pool } = require('../db');
  const quests = require('../repositories/quests');
  const SRC = 'wat2do-test';
  const HOUR = 3600000;
  const at = (hours) => new Date(Date.now() + hours * HOUR);

  const rec = (id, o = {}) => ({
    source: SRC, sourceId: String(id), sourceUrl: `https://example.test/events/${id}`, title: `Test event ${id}`, description: 'desc',
    organizer: '@test', location: 'Somewhere', starts: 'Sat, Sep 19, 2:00 PM', startsAt: at(48), endsAt: at(50), cost: '$5',
    priceText: '$5', free: false, registrationRequired: false, imageUrl: null, externalCategory: null, archetype: 'zztest',
    tags: ['zztest'], minutes: 60, ...o,
  });
  const row = async (id) => (await pool.query('select * from quests where source = $1 and source_id = $2', [SRC, String(id)])).rows[0];
  const count = async () => Number((await pool.query('select count(*) from quests where source = $1', [SRC])).rows[0].count);
  const clean = () => pool.query('delete from quests where source = $1', [SRC]);
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  test.before(clean);
  test.after(async () => { await clean(); await pool.end(); });

  test('inserts a new event, then updates it in place instead of duplicating', async () => {
    const [first] = await quests.upsertExternal([rec(1)]);
    assert.deepEqual(first, { sourceId: '1', inserted: true });
    const [again] = await quests.upsertExternal([rec(1)]);
    assert.deepEqual(again, { sourceId: '1', inserted: false });
    assert.equal(await count(), 1);
  });

  test('last_seen_at moves on every import; updated_at only when something changed', async () => {
    await clean();
    const same = rec(2); // built once: rec() derives its times from Date.now(), so a second call would differ
    await quests.upsertExternal([same]);
    const a = await row(2);
    await sleep(30);
    await quests.upsertExternal([same]);                         // identical data
    const b = await row(2);
    assert.ok(b.last_seen_at > a.last_seen_at, 'last_seen_at should advance');
    assert.equal(+b.updated_at, +a.updated_at, 'updated_at should not move when nothing changed');
    await sleep(30);
    await quests.upsertExternal([{ ...same, title: 'Renamed', location: 'Elsewhere', priceText: 'Free', free: true }]);
    const c = await row(2);
    assert.ok(c.updated_at > b.updated_at, 'updated_at should advance when details change');
    assert.deepEqual([c.title, c.location, c.price_text, c.free], ['Renamed', 'Elsewhere', 'Free', true]);
    assert.equal(+c.created_at, +a.created_at, 'created_at never changes');
    assert.equal(await count(), 1);
  });

  test('one bad row fails alone; the rest of the batch is saved', async () => {
    await clean();
    const results = await quests.upsertExternal([rec(10), rec(11, { title: null }), rec(12)]);
    assert.deepEqual(results.map(r => [r.sourceId, r.inserted ?? 'error']), [['10', true], ['11', 'error'], ['12', true]]);
    assert.match(results[1].error, /null value in column "title"/);
    assert.equal(await count(), 2);
  });

  test('never deletes: events missing from a later import stay in the table', async () => {
    await clean();
    await quests.upsertExternal([rec(20), rec(21)]);
    await quests.upsertExternal([rec(21)]); // 20 is no longer listed
    assert.equal(await count(), 2);
  });

  test('parameterised: quotes and SQL-looking text are stored literally', async () => {
    await clean();
    const nasty = `Robert'); DROP TABLE quests;-- "quoted" \\ backslash`;
    await quests.upsertExternal([rec(30, { title: nasty, location: nasty })]);
    assert.equal((await row(30)).title, nasty);
    assert.ok(Number((await pool.query('select count(*) from quests')).rows[0].count) >= 8); // table still there
  });

  test('only future or in-progress events are offered; seeded quests always are', async () => {
    await clean();
    await quests.upsertExternal([
      rec(40, { startsAt: at(48), endsAt: at(50) }),          // upcoming            -> offered
      rec(41, { startsAt: at(-0.5), endsAt: at(1) }),         // in progress         -> offered
      rec(42, { startsAt: at(-0.5), endsAt: null }),          // no end, started 30m -> offered (assumed 3h)
      rec(43, { startsAt: at(-48), endsAt: at(-46) }),        // over                -> hidden
      rec(44, { startsAt: at(-5), endsAt: null }),            // no end, 5h ago      -> hidden
      rec(45, { startsAt: null, endsAt: null }),              // no known start      -> hidden
    ]);
    const id = async (n) => (await row(n)).id;
    const offered = [await id(40), await id(41), await id(42)];
    const hidden = [await id(43), await id(44), await id(45)];

    const picked = (await quests.pickForMatch(['zztest'], false)).map(r => r.id);
    assert.deepEqual(picked.filter(i => hidden.includes(i)), [], 'expired/undated events must never be picked');
    for (const i of offered) assert.ok(picked.includes(i), `event ${i} should be picked (it shares the archetype)`);

    const suggested = (await quests.suggested(['zztest'], false, [])).map(r => r.id);
    assert.deepEqual(suggested.filter(i => hidden.includes(i)), []);
    // relevant (shares the archetype) first, then soonest start: 41 and 42 began 30 min ago, 40 is in two days
    assert.deepEqual(suggested, [offered[1], offered[2], offered[0]]);

    // fetching by id still works for an old match, even once the event is over
    assert.equal((await quests.byIds(hidden)).length, 3);

    const seeded = Number((await pool.query('select count(*) from quests where source is null')).rows[0].count);
    assert.ok(seeded >= 8, 'the seeded quests are untouched');
  });

  test('free-only budgets get only events known to be free', async () => {
    await clean();
    await quests.upsertExternal([rec(50, { priceText: 'Free', cost: 'Free', free: true }), rec(51, { priceText: null, cost: 'See event page', free: false })]);
    const freeId = (await row(50)).id;
    const unknownId = (await row(51)).id;
    const picked = (await quests.pickForMatch(['zztest'], true)).map(r => r.id);
    assert.ok(picked.includes(freeId));
    assert.ok(!picked.includes(unknownId), 'an unknown price is not assumed free');
  });

  test('the unique index really prevents duplicate (source, source_id)', async () => {
    await clean();
    await quests.upsertExternal([rec(60)]);
    await assert.rejects(pool.query(
      `insert into quests (source, source_id, title, description, location, starts, cost, minutes, tags)
       values ($1,'60','dup','d','l','s','c',1,'{}')`, [SRC]), /quests_source_source_id|duplicate key/);
  });
}
