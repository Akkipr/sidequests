const cheerio = require('cheerio');

// Everything specific to wat2do.ca lives in this file, so a redesign (or the move to wat2do.io) means editing one place.
//
// Why a headless browser: WAT2DO's own RSS feed (/rss.xml) is a stale snapshot with no event dates, locations or
// descriptions, and the listing itself is rendered client-side, so the events only exist after JavaScript runs.
// We read that public listing exactly like a visitor would: load the page and scroll. We do NOT call WAT2DO's
// /api/ (robots.txt disallows it) and we do not fetch individual event pages.

const SOURCE = 'wat2do';
const TIMEZONE = 'America/Toronto';
const USER_AGENT = 'SideQuests-hackathon-importer/0.1 (+https://github.com/Akkipr/sidequests; low-volume hackathon project)';
const NAV_TIMEOUT_MS = 30000;
const SELECTOR_TIMEOUT_MS = 20000;
const SCROLL_DELAY_MS = 1200; // pause between scrolls so we never hammer the site
const MAX_SCROLLS = 8;

// The only markup assumptions. Prefer meaning (link pattern, data-slot, icon names) over generated CSS classes.
const SEL = {
  eventLink: 'a[href^="/events/"]',   // an event card is an <a> to /events/<id>
  title: '[data-slot="card-title"]',
  content: '[data-slot="card-content"]', // rows inside it are recognised by their icon, not their position
  image: 'img',
};
const HREF_RE = /^\/events\/(\d+)(?:[/?#].*)?$/;
// Row icons (Lucide class names) -> meaning.
const ICON = { date: 'lucide-calendar', time: 'lucide-clock', place: 'lucide-map-pin', price: 'lucide-dollar-sign', ignore: ['lucide-heart', 'lucide-external-link'] };

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

// ---------------------------------------------------------------------------------------------------------------------
// Time zones: WAT2DO shows Waterloo wall-clock times with no offset, so convert them to real instants ourselves.
// ---------------------------------------------------------------------------------------------------------------------

function wallClockParts(instant, tz) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(instant).map(p => [p.type, Number(p.value)]));
  return parts;
}

/** The instant at which the clocks in `tz` read y-m-d h:mi. Two passes so daylight-saving changes come out right. */
function zonedToUtc({ y, m, d, h = 0, mi = 0 }, tz = TIMEZONE) {
  const asIfUtc = Date.UTC(y, m - 1, d, h, mi);
  const offsetAt = (ts) => {
    const p = wallClockParts(new Date(ts), tz);
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ts / 1000) * 1000;
  };
  const first = asIfUtc - offsetAt(asIfUtc);
  return new Date(asIfUtc - offsetAt(first));
}

const todayIn = (now, tz = TIMEZONE) => {
  const p = wallClockParts(now, tz);
  return { y: p.year, m: p.month, d: p.day };
};
const addDays = ({ y, m, d }, n) => {
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
};

// ---------------------------------------------------------------------------------------------------------------------
// Parsing the visible text
// ---------------------------------------------------------------------------------------------------------------------

/**
 * "Today", "Tomorrow", "Sunday Sep 20", "Sep 20" or "Sep 20, 2027" -> {y, m, d}, or null if unrecognised.
 * A weekday pins the year: "Thursday Sep 16" can only be 2027, since Sep 16, 2026 is a Wednesday.
 */
function parseDateLabel(label, now = new Date()) {
  const text = String(label ?? '').trim();
  const today = todayIn(now);
  if (/^today$/i.test(text)) return today;
  if (/^tomorrow$/i.test(text)) return addDays(today, 1);

  const m = /^(?:([A-Za-z]{3,9}),?\s+)?([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:,?\s+(\d{4}))?$/.exec(text);
  if (!m) return null;
  const month = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()) + 1;
  const day = Number(m[3]);
  if (!month || day < 1 || day > 31) return null;
  const weekday = m[1] ? WEEKDAYS.indexOf(m[1].slice(0, 3).toLowerCase()) : -1;
  if (m[1] && weekday < 0) return null;

  const candidates = [today.y - 1, today.y, today.y + 1]
    .filter(y => !m[4] || y === Number(m[4]))
    .map(y => ({ y, m: month, d: day }))
    .filter(c => new Date(Date.UTC(c.y, c.m - 1, c.d)).getUTCMonth() === c.m - 1) // reject Feb 30 etc.
    .filter(c => weekday < 0 || new Date(Date.UTC(c.y, c.m - 1, c.d)).getUTCDay() === weekday);
  if (!candidates.length) return null;
  const distance = (c) => Math.abs(Date.UTC(c.y, c.m - 1, c.d) - Date.UTC(today.y, today.m - 1, today.d));
  // With a weekday there is at most one sensible year. Without one, take the nearest occurrence.
  return candidates.sort((a, b) => distance(a) - distance(b))[0];
}

/** "2:00 p.m. - 8:30 p.m." / "1:00 p.m." -> {start: {h, mi}, end: {h, mi} | null}, or null. */
function parseTimeRange(text) {
  const times = [...String(text ?? '').matchAll(/(\d{1,2})(?::(\d{2}))?\s*([ap])\.?\s*m\.?/gi)].map(([, h, mi, ap]) => {
    const hour = Number(h);
    if (hour < 1 || hour > 12) return null;
    return { h: (hour % 12) + (ap.toLowerCase() === 'p' ? 12 : 0), mi: Number(mi ?? 0) };
  });
  if (!times.length || times.includes(null)) return null;
  return { start: times[0], end: times[1] ?? null };
}

/** Combine a date label and a time text into instants. Either may be missing or unparseable. */
function resolveWhen(dateText, timeText, now) {
  const date = parseDateLabel(dateText, now);
  if (!date) return { startsAt: null, endsAt: null };
  const time = parseTimeRange(timeText);
  if (!time) return { startsAt: zonedToUtc({ ...date, h: 0, mi: 0 }), endsAt: null };

  const startsAt = zonedToUtc({ ...date, ...time.start });
  let endsAt = null;
  if (time.end) {
    endsAt = zonedToUtc({ ...date, ...time.end });
    if (endsAt <= startsAt) endsAt = zonedToUtc({ ...addDays(date, 1), ...time.end }); // e.g. 9 p.m. - 12:30 a.m.
  } else if (time.start.h === 0 && time.start.mi === 0) {
    endsAt = zonedToUtc({ ...date, h: 23, mi: 59 }); // a bare "12:00 a.m." means all day, not a one-minute event
  }
  return { startsAt, endsAt };
}

// ---------------------------------------------------------------------------------------------------------------------
// Turning the rendered page into event objects (pure: no browser, no network, no database)
// ---------------------------------------------------------------------------------------------------------------------

const clean = (s) => (s ?? '').replace(/\s+/g, ' ').trim() || null;

function absoluteUrl(href, baseUrl) {
  try {
    const u = new URL(href, baseUrl);
    return /^https?:$/.test(u.protocol) ? u.toString() : null;
  } catch {
    return null;
  }
}

function rowKind($row) {
  const icons = $row.find('svg').toArray().flatMap(s => (s.attribs?.class ?? '').split(/\s+/));
  if (icons.includes(ICON.date)) return 'date';
  if (icons.includes(ICON.time)) return 'time';
  if (icons.includes(ICON.place)) return 'place';
  if (icons.includes(ICON.price)) return 'price';
  if (ICON.ignore.some(i => icons.includes(i))) return 'ignore';
  if (icons.some(i => i.startsWith('lucide-'))) return 'tag'; // e.g. lucide-utensils next to "Pizza"
  return /registration/i.test($row.text()) ? 'registration' : 'ignore';
}

function parseCard($, a, { baseUrl, now }) {
  const $a = $(a);
  const id = HREF_RE.exec($a.attr('href') ?? '')?.[1];
  const title = clean($a.find(SEL.title).first().attr('title')) ?? clean($a.find(SEL.title).first().text()) ?? clean($a.find(SEL.image).first().attr('alt'));

  const rows = { date: null, time: null, place: null, price: null, tags: [], registration: false };
  $a.find(SEL.content).first().children().each((_, row) => {
    const $row = $(row);
    const text = clean($row.text());
    if (!text) return;
    switch (rowKind($row)) {
      case 'date': rows.date ??= text; break;
      case 'time': rows.time ??= text; break;
      case 'place': rows.place ??= clean($row.find('[title]').first().attr('title')) ?? text; break;
      case 'price': rows.price ??= text; break;
      case 'tag': rows.tags.push(text); break;
      case 'registration': rows.registration = true; break;
    }
  });

  // The organiser shows as an "@handle" pill on the image.
  const organizer = $a.find('div').filter((_, d) => !$(d).children().length && /^@[\w.]+$/.test($(d).text().trim())).first().text().trim() || null;
  const imgSrc = $a.find(SEL.image).first().attr('src');
  const tags = [...new Set(rows.tags)];
  const { startsAt, endsAt } = resolveWhen(rows.date, rows.time, now);

  return {
    source: SOURCE,
    sourceId: id ?? null,
    sourceUrl: id ? absoluteUrl(`/events/${id}`, baseUrl) : null,
    title,
    // The listing carries no free-text description, so build one from what the card actually shows.
    description: [organizer && `Hosted by ${organizer}`, tags.length && tags.join(', '), rows.registration && 'Registration required'].filter(Boolean).join('. ') || null,
    organizer,
    location: rows.place,
    startsAt,
    endsAt,
    priceText: rows.price,
    registrationRequired: rows.registration,
    imageUrl: imgSrc && !imgSrc.startsWith('data:') ? absoluteUrl(imgSrc, baseUrl) : null,
    externalCategory: tags.join(', ') || null,
  };
}

/**
 * @returns {{events: object[], discovered: number, skipped: number}}
 *   discovered = event cards found; skipped = cards we couldn't use (no id/title) or duplicates of an earlier card.
 */
function parseListing(html, { baseUrl = 'https://wat2do.ca', now = new Date() } = {}) {
  const $ = cheerio.load(html);
  const cards = $(SEL.eventLink).toArray().filter(a => HREF_RE.test($(a).attr('href') ?? '') && $(a).find(SEL.title).length);
  const events = new Map();
  let skipped = 0;
  for (const a of cards) {
    let e;
    try {
      e = parseCard($, a, { baseUrl, now });
    } catch (err) {
      console.warn('wat2do: could not parse a card:', err.message);
      skipped++;
      continue;
    }
    if (!e.sourceId || !e.title || events.has(e.sourceId)) { skipped++; continue; }
    events.set(e.sourceId, e);
  }
  return { events: [...events.values()], discovered: cards.length, skipped };
}

// ---------------------------------------------------------------------------------------------------------------------
// Fetching (headless Chromium)
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Loads the public listing in headless Chromium, scrolls until nothing new appears, and parses it.
 * Playwright is required lazily so the server (and tests) work without it when imports are disabled.
 * `launcher` is injectable for tests.
 */
async function scrapeWat2do({ baseUrl = 'https://wat2do.ca', now = new Date(), launcher, maxScrolls = MAX_SCROLLS } = {}) {
  const chromium = launcher ?? require('playwright').chromium;
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ userAgent: USER_AGENT, locale: 'en-CA', timezoneId: TIMEZONE });
    // Be polite: we only need the markup, so don't download images, fonts or media.
    await context.route('**/*', route => (['image', 'font', 'media'].includes(route.request().resourceType()) ? route.abort() : route.continue()));
    const page = await context.newPage();
    page.setDefaultNavigationTimeout(NAV_TIMEOUT_MS);
    page.setDefaultTimeout(SELECTOR_TIMEOUT_MS);

    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector(SEL.eventLink, { timeout: SELECTOR_TIMEOUT_MS });

    // The listing loads more cards as you scroll. Stop once two scrolls in a row add nothing.
    let last = 0;
    let stable = 0;
    for (let i = 0; i < maxScrolls && stable < 2; i++) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(SCROLL_DELAY_MS);
      const count = await page.locator(SEL.eventLink).count();
      stable = count === last ? stable + 1 : 0;
      last = count;
    }

    const result = parseListing(await page.content(), { baseUrl, now });
    if (!result.events.length) {
      // A silent empty import would look like success. If markup changed, say so.
      throw new Error(`WAT2DO markup not recognised: found ${result.discovered} event cards but none could be parsed (has the site been redesigned?)`);
    }
    return result;
  } finally {
    await browser?.close();
  }
}

module.exports = {
  SOURCE, TIMEZONE, USER_AGENT, SEL,
  scrapeWat2do, parseListing, parseDateLabel, parseTimeRange, resolveWhen, zonedToUtc,
};
