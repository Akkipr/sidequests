const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseListing, parseDateLabel, parseTimeRange, resolveWhen, zonedToUtc, scrapeWat2do, SEL,
} = require('../services/wat2do');
const { card, page } = require('./wat2doFixtures');

// Sat Sep 19, 2026, 7:30 pm in Waterloo (EDT, UTC-4)
const NOW = new Date('2026-09-19T23:30:00Z');
const BASE = 'https://wat2do.ca';
const parse = (...cards) => parseListing(page(...cards), { baseUrl: BASE, now: NOW });

// ---------------------------------------------------------------- dates and times

test('relative date labels resolve against "now" in Waterloo time', () => {
  assert.deepEqual(parseDateLabel('Today', NOW), { y: 2026, m: 9, d: 19 });
  assert.deepEqual(parseDateLabel('Tomorrow', NOW), { y: 2026, m: 9, d: 20 });
  // 11 pm Toronto is already the next UTC day; "today" must still be Toronto's today
  assert.deepEqual(parseDateLabel('Today', new Date('2026-09-20T03:00:00Z')), { y: 2026, m: 9, d: 19 });
});

test('a weekday in the label pins the year', () => {
  assert.deepEqual(parseDateLabel('Sunday Sep 20', NOW), { y: 2026, m: 9, d: 20 });
  assert.deepEqual(parseDateLabel('Tuesday Nov 24', NOW), { y: 2026, m: 11, d: 24 });
  // Sep 16, 2026 is a Wednesday, so "Thursday Sep 16" can only be 2027
  assert.deepEqual(parseDateLabel('Thursday Sep 16', NOW), { y: 2027, m: 9, d: 16 });
  assert.equal(parseDateLabel('Friday Sep 20', NOW), null); // Sep 20 is never a Friday nearby
});

test('labels without a weekday take the nearest occurrence; an explicit year is honoured', () => {
  assert.deepEqual(parseDateLabel('Sep 22', NOW), { y: 2026, m: 9, d: 22 });
  assert.deepEqual(parseDateLabel('Jan 5', NOW), { y: 2027, m: 1, d: 5 });
  assert.deepEqual(parseDateLabel('Oct 3, 2027', NOW), { y: 2027, m: 10, d: 3 });
  assert.deepEqual(parseDateLabel('Sun Sep 20', NOW), { y: 2026, m: 9, d: 20 }); // short weekday name
});

test('unparseable date labels return null instead of guessing', () => {
  for (const bad of ['', null, undefined, 'Soon', 'Feb 30', 'Funday Sep 20', '13/40', 'Sep 40']) assert.equal(parseDateLabel(bad, NOW), null, String(bad));
});

test('time ranges: 12-hour clock, single times, midnight and noon', () => {
  assert.deepEqual(parseTimeRange('2:00 p.m. - 8:30 p.m.'), { start: { h: 14, mi: 0 }, end: { h: 20, mi: 30 } });
  assert.deepEqual(parseTimeRange('11:00 a.m. - 12:30 p.m.'), { start: { h: 11, mi: 0 }, end: { h: 12, mi: 30 } });
  assert.deepEqual(parseTimeRange('1:00 p.m.'), { start: { h: 13, mi: 0 }, end: null });
  assert.deepEqual(parseTimeRange('12:00 a.m.'), { start: { h: 0, mi: 0 }, end: null });
  assert.deepEqual(parseTimeRange('12:15 p.m.'), { start: { h: 12, mi: 15 }, end: null });
  assert.deepEqual(parseTimeRange('6 pm'), { start: { h: 18, mi: 0 }, end: null }); // no minutes, no dots
  for (const bad of ['', null, 'TBA', '25:00 p.m.', 'noon']) assert.equal(parseTimeRange(bad), null, String(bad));
});

test('wall-clock Waterloo time becomes the right instant, in summer and winter', () => {
  assert.equal(zonedToUtc({ y: 2026, m: 9, d: 19, h: 14 }).toISOString(), '2026-09-19T18:00:00.000Z'); // EDT, UTC-4
  assert.equal(zonedToUtc({ y: 2026, m: 12, d: 5, h: 14 }).toISOString(), '2026-12-05T19:00:00.000Z'); // EST, UTC-5
  assert.equal(zonedToUtc({ y: 2026, m: 11, d: 2, h: 9 }).toISOString(), '2026-11-02T14:00:00.000Z'); // day after fall-back
});

test('resolveWhen: ranges, overnight events, all-day and missing parts', () => {
  const r = resolveWhen('Today', '2:00 p.m. - 8:30 p.m.', NOW);
  assert.equal(r.startsAt.toISOString(), '2026-09-19T18:00:00.000Z');
  assert.equal(r.endsAt.toISOString(), '2026-09-20T00:30:00.000Z');

  const night = resolveWhen('Tomorrow', '9:00 p.m. - 12:30 a.m.', NOW); // ends after midnight
  assert.equal(night.startsAt.toISOString(), '2026-09-21T01:00:00.000Z');
  assert.equal(night.endsAt.toISOString(), '2026-09-21T04:30:00.000Z');

  const allDay = resolveWhen('Sunday Sep 20', '12:00 a.m.', NOW); // a bare midnight means "all day"
  assert.equal(allDay.startsAt.toISOString(), '2026-09-20T04:00:00.000Z');
  assert.equal(allDay.endsAt.toISOString(), '2026-09-21T03:59:00.000Z');

  const noTime = resolveWhen('Sunday Sep 20', null, NOW);
  assert.ok(noTime.startsAt && noTime.endsAt === null);
  assert.deepEqual(resolveWhen('Someday', '2:00 p.m.', NOW), { startsAt: null, endsAt: null });
});

// ---------------------------------------------------------------- normalising cards

test('a full card becomes a normalised event', () => {
  const { events, discovered, skipped } = parse(card({
    id: 22645, title: 'Shaw Festival Trip', organizer: '@uw.tsu', img: 'https://wat2do.io/media/event-images/64f3.jpg',
    rows: [['calendar', 'Today'], ['clock', '3:00 p.m. - 8:15 p.m.'], ['map-pin', 'Shaw Festival, Niagara-on-the-Lake, Ontario'], ['dollar-sign', '$100'], ['utensils', 'Lunch']],
    registration: true,
  }));
  assert.equal(discovered, 1);
  assert.equal(skipped, 0);
  assert.deepEqual(events[0], {
    source: 'wat2do',
    sourceId: '22645',
    sourceUrl: 'https://wat2do.ca/events/22645',
    title: 'Shaw Festival Trip',
    description: 'Hosted by @uw.tsu. Lunch. Registration required',
    organizer: '@uw.tsu',
    location: 'Shaw Festival, Niagara-on-the-Lake, Ontario',
    startsAt: new Date('2026-09-19T19:00:00.000Z'),
    endsAt: new Date('2026-09-20T00:15:00.000Z'),
    priceText: '$100',
    registrationRequired: true,
    imageUrl: 'https://wat2do.io/media/event-images/64f3.jpg',
    externalCategory: 'Lunch',
  });
});

test('rows are recognised by their icon, so their order does not matter', () => {
  const { events } = parse(card({ id: 1, title: 'Shuffled', rows: [['map-pin', 'MC 2017'], ['dollar-sign', 'Free'], ['clock', '6:00 p.m.'], ['calendar', 'Tomorrow']] }));
  assert.equal(events[0].location, 'MC 2017');
  assert.equal(events[0].priceText, 'Free');
  assert.equal(events[0].startsAt.toISOString(), '2026-09-20T22:00:00.000Z');
});

test('missing fields become null / false; the event is still imported', () => {
  const { events } = parse(card({ id: 7, title: 'Bare Bones', organizer: null, rows: [] }));
  assert.equal(events.length, 1);
  assert.deepEqual(
    events[0],
    {
      source: 'wat2do', sourceId: '7', sourceUrl: 'https://wat2do.ca/events/7', title: 'Bare Bones', description: null, organizer: null,
      location: null, startsAt: null, endsAt: null, priceText: null, registrationRequired: false,
      imageUrl: 'https://wat2do.io/media/event-images/abc.jpg', externalCategory: null,
    });
});

test('an unparseable date or time does not lose the event', () => {
  const a = parse(card({ id: 1, title: 'Odd date', rows: [['calendar', 'Whenever'], ['clock', '2:00 p.m.']] })).events[0];
  assert.equal(a.startsAt, null);
  const b = parse(card({ id: 2, title: 'Odd time', rows: [['calendar', 'Today'], ['clock', 'TBA']] })).events[0];
  assert.ok(b.startsAt); // date known, time unknown -> midnight that day
  assert.equal(b.endsAt, null);
});

test('images: relative URLs are made absolute, data: URIs and blanks are dropped', () => {
  assert.equal(parse(card({ id: 1, title: 'A', img: '/media/x.jpg' })).events[0].imageUrl, 'https://wat2do.ca/media/x.jpg');
  assert.equal(parse(card({ id: 2, title: 'B', img: 'data:image/gif;base64,AAAA' })).events[0].imageUrl, null);
  assert.equal(parse(card({ id: 3, title: 'C', img: '' })).events[0].imageUrl, null);
});

test('several tags are kept, unique, and joined', () => {
  const { events } = parse(card({ id: 1, title: 'Snacks', rows: [['utensils', 'Pizza'], ['utensils', 'Pizza'], ['sparkles', 'Drinks']] }));
  assert.equal(events[0].externalCategory, 'Pizza, Drinks');
});

test('links that are not event cards are ignored; a card with no usable title is skipped and counted', () => {
  const { events, discovered, skipped } = parse(
    card({ id: 1, title: 'Good' }),
    card({ id: 2, title: 'No title element', omitTitle: true }),            // not a card at all: no title slot
    '<a href="/events/oops"><div data-slot="card"><div data-slot="card-title">Bad id</div></div></a>', // id isn't numeric
    card({ id: 3, title: '' }),                                              // a card, but its title is blank
  );
  // /events, /events/create (nav links), the id-less link and the title-less markup never count as cards
  assert.deepEqual(events.map(e => e.sourceId), ['1']);
  assert.equal(discovered, 2); // "Good" and the blank-title card
  assert.equal(skipped, 1);    // the blank-title card
});

test('deduplication: the same event id appearing twice is imported once', () => {
  const { events, discovered, skipped } = parse(
    card({ id: 5, title: 'First sighting' }),
    card({ id: 6, title: 'Other' }),
    card({ id: 5, title: 'Second sighting' }),
  );
  assert.deepEqual(events.map(e => e.sourceId), ['5', '6']);
  assert.equal(events[0].title, 'First sighting');
  assert.equal(discovered, 3);
  assert.equal(skipped, 1);
});

test('an empty or unrelated page yields no events rather than throwing', () => {
  assert.deepEqual(parseListing('', { now: NOW }), { events: [], discovered: 0, skipped: 0 });
  assert.deepEqual(parseListing('<html><body><p>Down for maintenance</p></body></html>', { now: NOW }), { events: [], discovered: 0, skipped: 0 });
});

// ---------------------------------------------------------------- the browser part (fake Playwright)

function fakeLauncher({ html, counts = [3, 5, 5, 5, 5, 5, 5, 5], failOn } = {}) {
  const log = { closed: 0, userAgent: null, scrolls: 0, routes: 0 };
  let i = 0;
  const page = {
    setDefaultNavigationTimeout() {}, setDefaultTimeout() {},
    async goto() { if (failOn === 'goto') throw new Error('net::ERR_CONNECTION_REFUSED'); },
    async waitForSelector(sel) { log.selector = sel; if (failOn === 'selector') throw new Error('Timeout 20000ms exceeded'); },
    async evaluate() { log.scrolls++; },
    async waitForTimeout() {},
    locator() { return { count: async () => counts[Math.min(i++, counts.length - 1)] }; },
    async content() { return html; },
  };
  const context = { route: async () => { log.routes++; }, newPage: async () => page };
  const browser = { newContext: async (opts) => { log.userAgent = opts.userAgent; return context; }, close: async () => { log.closed++; } };
  return { log, launcher: { launch: async () => browser } };
}

test('scraper: identifies itself, waits for event links, scrolls until stable, parses, and closes the browser', async () => {
  const { log, launcher } = fakeLauncher({ html: page(card({ id: 1, title: 'One', rows: [['calendar', 'Today']] })) });
  const r = await scrapeWat2do({ launcher, now: NOW });
  assert.equal(r.events.length, 1);
  assert.match(log.userAgent, /^SideQuests-hackathon-importer\//);
  assert.equal(log.selector, SEL.eventLink);
  assert.equal(log.scrolls, 4); // 3 -> 5 grows, then two stable scrolls stop it (not all 8)
  assert.equal(log.routes, 1); // images/fonts/media are blocked
  assert.equal(log.closed, 1);
});

test('scraper: closes the browser even when navigation or the wait fails', async () => {
  for (const failOn of ['goto', 'selector']) {
    const { log, launcher } = fakeLauncher({ html: '', failOn });
    await assert.rejects(scrapeWat2do({ launcher }), /ERR_CONNECTION_REFUSED|Timeout/);
    assert.equal(log.closed, 1, failOn);
  }
});

test('scraper: a page with links but no parseable cards is an error, not a silent empty import', async () => {
  const { log, launcher } = fakeLauncher({ html: '<a href="/events/1">no card markup here</a>' });
  await assert.rejects(scrapeWat2do({ launcher }), /markup not recognised/);
  assert.equal(log.closed, 1);
});

test('scraper: a launch failure (e.g. Chromium not installed) surfaces its message', async () => {
  const launcher = { launch: async () => { throw new Error("Executable doesn't exist"); } };
  await assert.rejects(scrapeWat2do({ launcher }), /Executable doesn't exist/);
});
