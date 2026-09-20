const { q, tx } = require('../db');

// Seeded quests (source null) are always on offer. Imported events only while they are upcoming or in progress; an
// event with no known end is treated as lasting three hours, and one with no known start is never offered.
const AVAILABLE = `(source is null or (starts_at is not null and coalesce(ends_at, starts_at + interval '3 hours') > now()))`;

exports.byIds = (ids) =>
  q('select * from quests where id = any($1::int[]) order by array_position($1::int[], id)', [ids]);

// Best-fitting quests for a fresh match: shared archetypes first, free-only if either person needs it.
exports.pickForMatch = (sharedTags, freeOnly) =>
  q(`select id from quests where (not $2 or free) and ${AVAILABLE} order by (tags && $1) desc, random() limit 3`, [sharedTags, freeOnly]);

// Deterministic (no random) so the list doesn't reshuffle every time the tab refreshes.
exports.suggested = (archetypes, freeOnly, excludeIds) =>
  q(`select * from quests where (not $2 or free) and ${AVAILABLE} and not (id = any($3::int[]))
     order by (tags && $1) desc, coalesce(starts_at, 'infinity') asc, id limit 3`, [archetypes, freeOnly, excludeIds]);

// ---- imported events ----

// Insert or update one event per (source, source_id). `updated_at` only moves when a tracked field really changed;
// `last_seen_at` moves on every import. `xmax = 0` is true only for rows this statement inserted.
const UPSERT = `
  insert into quests (source, source_id, source_url, title, description, organizer, location, starts, starts_at, ends_at,
                      cost, price_text, free, registration_required, image_url, external_category, archetype, tags, minutes, last_seen_at)
  values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19, now())
  on conflict (source, source_id) do update set
    source_url = excluded.source_url, title = excluded.title, description = excluded.description,
    organizer = excluded.organizer, location = excluded.location, starts = excluded.starts,
    starts_at = excluded.starts_at, ends_at = excluded.ends_at, cost = excluded.cost, price_text = excluded.price_text,
    free = excluded.free, registration_required = excluded.registration_required, image_url = excluded.image_url,
    external_category = excluded.external_category, archetype = excluded.archetype, tags = excluded.tags,
    minutes = excluded.minutes, last_seen_at = now(),
    updated_at = case when (quests.source_url, quests.title, quests.description, quests.organizer, quests.location,
                            quests.starts_at, quests.ends_at, quests.price_text, quests.registration_required,
                            quests.image_url, quests.external_category, quests.archetype)
                       is distinct from
                           (excluded.source_url, excluded.title, excluded.description, excluded.organizer, excluded.location,
                            excluded.starts_at, excluded.ends_at, excluded.price_text, excluded.registration_required,
                            excluded.image_url, excluded.external_category, excluded.archetype)
                 then now() else quests.updated_at end
  returning (xmax = 0) as inserted`;

/**
 * Upserts a batch in one transaction. Each event runs in its own savepoint, so one bad row is reported and skipped
 * instead of aborting the rest. Returns [{ sourceId, inserted } | { sourceId, error }] in input order.
 */
exports.upsertExternal = (records) => tx(async (client) => {
  const results = [];
  for (const r of records) {
    await client.query('savepoint one_event');
    try {
      const [row] = await q(UPSERT, [
        r.source, r.sourceId, r.sourceUrl, r.title, r.description, r.organizer, r.location, r.starts, r.startsAt, r.endsAt,
        r.cost, r.priceText, r.free, r.registrationRequired, r.imageUrl, r.externalCategory, r.archetype, r.tags, r.minutes,
      ], client);
      await client.query('release savepoint one_event');
      results.push({ sourceId: r.sourceId, inserted: row.inserted });
    } catch (e) {
      await client.query('rollback to savepoint one_event');
      results.push({ sourceId: r.sourceId, error: e.message });
    }
  }
  return results;
});
