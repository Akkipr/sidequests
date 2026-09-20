const test = require('node:test');
const assert = require('node:assert/strict');
const { createEventImporter, toQuestRecord, formatStarts } = require('../services/eventImport');
const { startWat2doSchedule } = require('../services/importScheduler');
const { httpError } = require('../errors');
const { ARCHETYPES } = require('../services/validation');

const ev = (o = {}) => ({
  source: 'wat2do', sourceId: '1', sourceUrl: 'https://wat2do.ca/events/1', title: 'Pizza Social', description: 'Hosted by @club',
  organizer: '@club', location: 'SLC Great Hall', startsAt: new Date('2026-09-19T18:00:00Z'), endsAt: new Date('2026-09-19T20:30:00Z'),
  priceText: 'Free', registrationRequired: true, imageUrl: 'https://img/x.jpg', externalCategory: 'Pizza', ...o,
});
const config = { wat2doBaseUrl: () => 'https://wat2do.ca', wat2doEnabled: () => true, wat2doCron: () => '0 * * * *' };
const quiet = () => ({ errors: [], logs: [], error(...a) { this.errors.push(a); }, log(...a) { this.logs.push(a); }, warn() {} });

// ---------------------------------------------------------------- normalisation

test('an event maps onto the existing quests columns', () => {
  const r = toQuestRecord(ev());
  assert.deepEqual(r, {
    source: 'wat2do', sourceId: '1', sourceUrl: 'https://wat2do.ca/events/1', title: 'Pizza Social', description: 'Hosted by @club',
    organizer: '@club', location: 'SLC Great Hall', starts: 'Sat, Sep 19, 2:00 PM', startsAt: new Date('2026-09-19T18:00:00Z'),
    endsAt: new Date('2026-09-19T20:30:00Z'), cost: 'Free', priceText: 'Free', free: true, registrationRequired: true,
    imageUrl: 'https://img/x.jpg', externalCategory: 'Pizza', archetype: 'foodie', tags: ['foodie'], minutes: 150,
  });
});

test('starts is shown in Waterloo time', () => {
  assert.equal(formatStarts(new Date('2026-12-05T19:00:00Z')), 'Sat, Dec 5, 2:00 PM'); // EST
  assert.equal(formatStarts(new Date('2026-09-19T18:00:00Z')), 'Sat, Sep 19, 2:00 PM'); // EDT
});

test('all-day and time-unknown events show only the date, never a fake "12:00 AM"', () => {
  const midnight = new Date('2026-09-19T04:00:00Z'); // 00:00 in Waterloo (EDT)
  assert.equal(formatStarts(midnight, new Date('2026-09-20T03:59:00Z')), 'Sat, Sep 19 (all day)');
  assert.equal(formatStarts(midnight, null), 'Sat, Sep 19');
  assert.equal(formatStarts(new Date('2026-09-19T04:30:00Z')), 'Sat, Sep 19, 12:30 AM'); // a real 12:30 AM start is kept
  assert.equal(toQuestRecord(ev({ startsAt: midnight, endsAt: new Date('2026-09-20T03:59:00Z') })).starts, 'Sat, Sep 19 (all day)');
});

test('null or missing fields get safe defaults so a required column is never null', () => {
  const r = toQuestRecord({ source: 'wat2do', sourceId: '9', title: 'Mystery' });
  assert.equal(r.description, 'Event from WAT2DO');
  assert.equal(r.location, 'See event page');
  assert.equal(r.starts, 'See event page');
  assert.equal(r.cost, 'See event page');
  assert.equal(r.minutes, 60);
  assert.equal(r.free, false); // an unknown price is never assumed to be free
  assert.equal(r.priceText, null);
  assert.equal(r.startsAt, null);
  assert.equal(r.registrationRequired, false);
  assert.equal(r.archetype, 'explorer');
  assert.deepEqual(r.tags, ['explorer']);
});

test('only "Free" is free; other prices are not', () => {
  assert.equal(toQuestRecord(ev({ priceText: 'free' })).free, true);
  assert.equal(toQuestRecord(ev({ priceText: '$12.99' })).free, false);
  assert.equal(toQuestRecord(ev({ priceText: '$12.99' })).cost, '$12.99');
});

test('duration is clamped and defaults to an hour when unknown', () => {
  const at = new Date('2026-09-19T18:00:00Z');
  assert.equal(toQuestRecord(ev({ startsAt: at, endsAt: new Date(+at + 5 * 60000) })).minutes, 15);
  assert.equal(toQuestRecord(ev({ startsAt: at, endsAt: new Date(+at + 30 * 3600000) })).minutes, 480);
  assert.equal(toQuestRecord(ev({ endsAt: null })).minutes, 60);
});

test('the archetype is always one the app supports', () => {
  for (const title of ['Yoga', 'Pizza', 'Choir', 'Lecture', '', 'Zzz']) {
    assert.ok(ARCHETYPES.includes(toQuestRecord(ev({ title, externalCategory: null })).archetype), title);
  }
});

// ---------------------------------------------------------------- the importer

function fakeQuests({ failIds = [], existing = [], dbDown = false } = {}) {
  const calls = [];
  return {
    calls,
    async upsertExternal(records) {
      calls.push(records);
      if (dbDown) throw new Error('connection terminated');
      return records.map(r => (failIds.includes(r.sourceId) ? { sourceId: r.sourceId, error: 'value too long' } : { sourceId: r.sourceId, inserted: !existing.includes(r.sourceId) }));
    },
  };
}
const importerWith = (scrape, quests = fakeQuests(), logger = quiet()) => ({ logger, quests, ...createEventImporter({ scrape, quests, config, logger, now: () => new Date('2026-09-19T12:00:00Z') }) });

test('reports discovered / inserted / updated / skipped / failed', async () => {
  const { importWat2do } = importerWith(
    async () => ({ events: [ev({ sourceId: '1' }), ev({ sourceId: '2' }), ev({ sourceId: '3' }), ev({ sourceId: '4' })], discovered: 6, skipped: 2 }),
    fakeQuests({ existing: ['2'], failIds: ['4'] }));
  assert.deepEqual(await importWat2do(), { discovered: 6, inserted: 2, updated: 1, skipped: 2, failed: 1 });
});

test('passes the configured base URL and the current time to the scraper', async () => {
  let args;
  const { importWat2do } = importerWith(async (a) => { args = a; return { events: [ev()], discovered: 1, skipped: 0 }; });
  await importWat2do();
  assert.equal(args.baseUrl, 'https://wat2do.ca');
  assert.equal(args.now.toISOString(), '2026-09-19T12:00:00.000Z');
});

test('deduplication: a repeated event id is written once and counted as skipped', async () => {
  const quests = fakeQuests();
  const { importWat2do } = importerWith(async () => ({ events: [ev({ sourceId: '1' }), ev({ sourceId: '1', title: 'Again' }), ev({ sourceId: '2' })], discovered: 3, skipped: 0 }), quests);
  const summary = await importWat2do();
  assert.deepEqual(quests.calls[0].map(r => r.sourceId), ['1', '2']);
  assert.equal(quests.calls[0][0].title, 'Pizza Social'); // first sighting wins
  assert.deepEqual(summary, { discovered: 3, inserted: 2, updated: 0, skipped: 1, failed: 0 });
});

test('events without an id or title are skipped, not fatal', async () => {
  const { importWat2do } = importerWith(async () => ({ events: [ev({ sourceId: null }), ev({ title: '' }), ev({ sourceId: '5' }), null], discovered: 4, skipped: 0 }));
  assert.deepEqual(await importWat2do(), { discovered: 4, inserted: 1, updated: 0, skipped: 3, failed: 0 });
});

test('one event failing to save is counted and logged, and the rest still import', async () => {
  const { importWat2do, logger } = importerWith(async () => ({ events: [ev({ sourceId: '1' }), ev({ sourceId: '2' })], discovered: 2, skipped: 0 }), fakeQuests({ failIds: ['1'] }));
  const s = await importWat2do();
  assert.deepEqual([s.inserted, s.failed], [1, 1]);
  assert.match(logger.errors[0].join(' '), /event 1.*value too long/);
});

test('dry run scrapes and counts but writes nothing', async () => {
  const quests = fakeQuests();
  const { importWat2do } = importerWith(async () => ({ events: [ev()], discovered: 1, skipped: 0 }), quests);
  assert.deepEqual(await importWat2do({ dryRun: true }), { discovered: 1, inserted: 0, updated: 0, skipped: 0, failed: 0 });
  assert.equal(quests.calls.length, 0);
});

test('a scraper failure is a 502 that hides the cause, logs it, and never touches the database', async () => {
  const boom = new Error('Timeout 20000ms exceeded waiting for a[href^="/events/"]');
  const { importWat2do, logger, quests } = importerWith(async () => { throw boom; });
  await assert.rejects(importWat2do(), (e) => {
    assert.equal(e.status, 502);
    assert.equal(e.message, 'import failed'); // nothing about selectors or stacks reaches the caller
    assert.equal(e.cause, boom); // ...but it is kept for the server-side log
    return true;
  });
  assert.equal(logger.errors.length, 1);
  assert.equal(logger.errors[0][1], boom);
  assert.equal(quests.calls.length, 0);
});

test('a database failure is a 502 too', async () => {
  const { importWat2do, logger } = importerWith(async () => ({ events: [ev()], discovered: 1, skipped: 0 }), fakeQuests({ dbDown: true }));
  await assert.rejects(importWat2do(), { status: 502, message: 'import failed' });
  assert.match(String(logger.errors[0][1]), /connection terminated/);
});

test('two imports never run at once, and the lock is released afterwards (also after a failure)', async () => {
  let release;
  const gate = new Promise(r => { release = r; });
  let mode = 'slow';
  const { importWat2do, isRunning } = importerWith(async () => {
    if (mode === 'slow') await gate;
    if (mode === 'fail') throw new Error('x');
    return { events: [ev()], discovered: 1, skipped: 0 };
  });

  const first = importWat2do();
  assert.equal(isRunning(), true);
  await assert.rejects(importWat2do(), { status: 409, message: 'an import is already running' });
  release();
  await first;
  assert.equal(isRunning(), false);

  mode = 'fail';
  await assert.rejects(importWat2do(), { status: 502 });
  assert.equal(isRunning(), false); // a failed import must not leave the lock held
  mode = 'ok';
  assert.equal((await importWat2do()).inserted, 1);
});

// ---------------------------------------------------------------- the scheduler

function fakeCron({ valid = true } = {}) {
  const c = { scheduled: [], validate: () => valid, schedule(expr, fn) { c.scheduled.push({ expr, fn }); return { stop() {} }; } };
  return c;
}
const cfg = (o = {}) => ({ wat2doEnabled: () => true, wat2doCron: () => '0 * * * *', ...o });

test('scheduling is off unless explicitly enabled', () => {
  const cron = fakeCron();
  assert.equal(startWat2doSchedule({ importer: {}, config: cfg({ wat2doEnabled: () => false }), cron, logger: quiet() }), null);
  assert.equal(cron.scheduled.length, 0);
});

test('when enabled it schedules the configured expression', () => {
  const cron = fakeCron();
  startWat2doSchedule({ importer: {}, config: cfg({ wat2doCron: () => '*/30 * * * *' }), cron, logger: quiet() });
  assert.deepEqual(cron.scheduled.map(s => s.expr), ['*/30 * * * *']);
});

test('an invalid cron expression is logged and not scheduled, without throwing', () => {
  const cron = fakeCron({ valid: false });
  const logger = quiet();
  assert.equal(startWat2doSchedule({ importer: {}, config: cfg({ wat2doCron: () => 'nonsense' }), cron, logger }), null);
  assert.match(logger.errors[0][0], /nonsense/);
});

test('each tick runs the shared importer and logs its summary', async () => {
  const cron = fakeCron();
  const logger = quiet();
  let calls = 0;
  startWat2doSchedule({ importer: { importWat2do: async () => { calls++; return { discovered: 3, inserted: 1, updated: 2, skipped: 0, failed: 0 }; } }, config: cfg(), cron, logger });
  await cron.scheduled[0].fn();
  assert.equal(calls, 1);
  assert.match(logger.logs.at(-1).join(' '), /"discovered":3/);
});

test('a failing scheduled import is logged and never throws, so it cannot crash the server', async () => {
  const cron = fakeCron();
  const logger = quiet();
  const cause = new Error('browser exploded');
  startWat2doSchedule({ importer: { importWat2do: async () => { throw Object.assign(httpError(502, 'import failed'), { cause }); } }, config: cfg(), cron, logger });
  await assert.doesNotReject(cron.scheduled[0].fn());
  assert.equal(logger.errors.at(-1)[1], cause);
});

test('a tick that finds an import already running is skipped quietly', async () => {
  const cron = fakeCron();
  const logger = quiet();
  startWat2doSchedule({ importer: { importWat2do: async () => { throw httpError(409, 'an import is already running'); } }, config: cfg(), cron, logger });
  await assert.doesNotReject(cron.scheduled[0].fn());
  assert.equal(logger.errors.length, 0);
  assert.match(logger.logs.at(-1).join(' '), /skipped/);
});
