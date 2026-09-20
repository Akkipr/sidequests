const iso = (d) => (d ? new Date(d).toISOString() : null);

// The one place a quest row becomes API JSON. Seeded quests simply have null for the imported-event fields, so
// existing clients keep working and new fields are always optional.
const toQuestDto = (r) => ({
  id: r.id,
  title: r.title,
  description: r.description,
  location: r.location,
  starts: r.starts,
  cost: r.cost,
  minutes: r.minutes,
  free: r.free,
  tags: r.tags,
  source: r.source ?? null,
  sourceUrl: r.source_url ?? null,
  imageUrl: r.image_url ?? null,
  startsAt: iso(r.starts_at),
  endsAt: iso(r.ends_at),
  priceText: r.price_text ?? null,
  organizer: r.organizer ?? null,
  registrationRequired: r.registration_required ?? false,
  externalCategory: r.external_category ?? null,
  archetype: r.archetype ?? null,
});

module.exports = { toQuestDto };
