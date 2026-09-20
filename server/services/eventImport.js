const { classifyEvent } = require('./eventClassifier');
const { httpError } = require('../errors');
const { TIMEZONE } = require('./wat2do');
const { withSpan, count } = require('../telemetry');

const DEFAULT_MINUTES = 60;
const MIN_MINUTES = 15;
const MAX_MINUTES = 480;

const clock = (date) => new Intl.DateTimeFormat('en-US', { timeZone: TIMEZONE, hourCycle: 'h23', hour: '2-digit', minute: '2-digit' }).format(date);

// "Sat, Sep 19, 2:00 PM" in Waterloo time. (Newer ICU puts a narrow no-break space before PM; normalise it.)
// An event that starts at exactly midnight has no real start time (WAT2DO shows "12:00 a.m." for all-day events, and we
// use midnight when the time is unknown), so show only the date rather than a misleading "12:00 AM".
function formatStarts(startsAt, endsAt = null) {
  const opts = { timeZone: TIMEZONE, weekday: 'short', month: 'short', day: 'numeric' };
  if (clock(startsAt) === '00:00') {
    const date = new Intl.DateTimeFormat('en-US', opts).format(startsAt);
    return endsAt && clock(endsAt) === '23:59' ? `${date} (all day)` : date;
  }
  return new Intl.DateTimeFormat('en-US', { ...opts, hour: 'numeric', minute: '2-digit' }).format(startsAt).replace(/\u202f/g, ' ');
}

const minutesBetween = (a, b) => (a && b ? Math.min(MAX_MINUTES, Math.max(MIN_MINUTES, Math.round((b - a) / 60000))) : DEFAULT_MINUTES);

/**
 * Turns a scraped event into a row for the existing `quests` table. Pure. The quest columns that were already
 * required (starts, cost, minutes, tags) are filled with sensible values, so a missing field never blocks an import.
 */
function toQuestRecord(event, classify = classifyEvent) {
  // The description WAT2DO gives us is built from its own tags, so classify on title + tags only (no double counting).
  const archetype = classify({ title: event.title, externalCategory: event.externalCategory });
  const price = event.priceText ?? null;
  return {
    source: event.source,
    sourceId: event.sourceId,
    sourceUrl: event.sourceUrl ?? null,
    title: event.title,
    description: event.description ?? 'Event from WAT2DO',
    organizer: event.organizer ?? null,
    location: event.location ?? 'See event page',
    starts: event.startsAt ? formatStarts(event.startsAt, event.endsAt) : 'See event page',
    startsAt: event.startsAt ?? null,
    endsAt: event.endsAt ?? null,
    cost: price ?? 'See event page',
    priceText: price,
    free: /^free$/i.test(price ?? ''), // unknown price is NOT assumed free
    registrationRequired: !!event.registrationRequired,
    imageUrl: event.imageUrl ?? null,
    externalCategory: event.externalCategory ?? null,
    archetype,
    tags: [archetype],
    minutes: minutesBetween(event.startsAt, event.endsAt),
  };
}

/**
 * The one importer. The admin endpoint and the scheduler both call this, so they can never diverge.
 * `scrape` and the quests repository are injected, so tests need no browser, network or database.
 *
 * Resolves to { discovered, inserted, updated, skipped, failed }. Rejects with an HttpError (409 when an import is
 * already running, 502 when the source could not be read); the underlying cause is logged, never returned.
 */
function createEventImporter({ scrape, quests, config, logger = console, now = () => new Date() }) {
  let running = false;

  const importWat2do = ({ dryRun = false } = {}) => withSpan('wat2do.import', { 'import.dry_run': dryRun }, async (span) => {
    if (running) throw httpError(409, 'an import is already running');
    running = true;
    try {
      let scraped;
      try {
        scraped = await withSpan('wat2do.scrape', {}, () => scrape({ baseUrl: config.wat2doBaseUrl(), now: now() }));
      } catch (e) {
        logger.error('wat2do import: could not read the source:', e);
        throw Object.assign(httpError(502, 'import failed'), { cause: e });
      }

      // Belt and braces: the scraper already dedupes, but never trust that with a unique constraint at stake.
      const seen = new Set();
      const records = [];
      let skipped = scraped.skipped ?? 0;
      for (const event of scraped.events ?? []) {
        if (!event?.sourceId || !event.title || seen.has(event.sourceId)) { skipped++; continue; }
        seen.add(event.sourceId);
        records.push(toQuestRecord(event));
      }

      let inserted = 0;
      let updated = 0;
      let failed = 0;
      if (!dryRun && records.length) {
        let results;
        try {
          results = await withSpan('wat2do.upsert', { 'import.records': records.length }, () => quests.upsertExternal(records));
        } catch (e) {
          logger.error('wat2do import: database error:', e);
          throw Object.assign(httpError(502, 'import failed'), { cause: e });
        }
        for (const r of results) {
          if (r.error) { failed++; logger.error(`wat2do import: could not save event ${r.sourceId}: ${r.error}`); }
          else if (r.inserted) inserted++;
          else updated++;
        }
      }
      const summary = { discovered: scraped.discovered ?? (scraped.events ?? []).length, inserted, updated, skipped, failed };
      for (const [k, v] of Object.entries(summary)) span.setAttribute(`import.${k}`, v);
      count('wat2do.events_inserted', inserted);
      count('wat2do.events_updated', updated);
      return summary;
    } finally {
      running = false;
    }
  });

  return { importWat2do, isRunning: () => running };
}

module.exports = { createEventImporter, toQuestRecord, formatStarts };
