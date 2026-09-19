const { q } = require('../db');

exports.byIds = (ids) =>
  q('select * from quests where id = any($1::int[]) order by array_position($1::int[], id)', [ids]);

// Best-fitting quests for a fresh match: shared archetypes first, free-only if either person needs it.
exports.pickForMatch = (sharedTags, freeOnly) =>
  q('select id from quests where (not $2 or free) order by (tags && $1) desc, random() limit 3', [sharedTags, freeOnly]);

// Deterministic (no random) so the list doesn't reshuffle every time the tab refreshes.
exports.suggested = (archetypes, freeOnly, excludeIds) =>
  q(`select * from quests where (not $2 or free) and not (id = any($3::int[]))
     order by (tags && $1) desc, id limit 3`, [archetypes, freeOnly, excludeIds]);
