const { score, THRESHOLD } = require('./scoring');
const { httpError } = require('../errors');
const { validateWearableToken } = require('./validation');
const { toQuestDto } = require('./questDto');
const { withSpan, count, distribution, log } = require('../telemetry');

// Orchestrates proximity signals -> matches. Repositories are injected so this is testable without a database.
function createMatching({ profiles, matches, wearables, quests, config }) {
  // Decide whether this exact pair may match and return the match id (creating it if needed). The span records the
  // outcome so the dashboard shows why signals did or didn't turn into matches.
  const tryMatch = (me, peer) => withSpan('match.evaluate', {}, async (span) => {
    const done = (outcome, id = null) => { span.setAttribute('match.outcome', outcome); return id; };
    if (me === peer) return done('own_wearable');
    const [ua, ub] = [me, peer].sort();

    // Blocks and discovery come first so they also stop an existing match from being handed back.
    if (await matches.isBlocked(ua, ub)) { log.info('signal ignored: this pair is blocked'); return done('blocked'); }
    const [a, b] = await Promise.all([profiles.get(ua), profiles.get(ub)]);
    if (!a || !b || a.status === 'off' || b.status === 'off') return done('not_discoverable');

    const existing = await matches.findOpen(ua, ub, config.OPEN_MATCH_MINUTES); // one open match per pair at a time
    if (existing) return done('existing', existing.id);

    const s = score(a, b);
    if (!s || s.score < THRESHOLD) return done('below_threshold');

    const freeOnly = a.budget === 'free' || b.budget === 'free';
    const picks = await quests.pickForMatch(s.shared, freeOnly);
    await matches.insert({ ua, ub, score: s.score, reason: s.reason, shared: s.shared, questIds: picks.map(x => x.id) });
    count('matches.created');
    log.info('match created', { 'match.score': s.score, 'match.shared': s.shared.join(','), 'match.free_only': freeOnly });
    distribution('match.score', s.score, 'none');
    // Both phones may insert at once; everyone converges on the oldest row.
    return done('created', (await matches.findOpen(ua, ub, config.OPEN_MATCH_MINUTES)).id);
  });

  // Exact-peer pairing: the phone reports the wearable token it detected, so only that pair is scored.
  async function fromWearable(uid, body) {
    const token = validateWearableToken(body.detectedWearableToken);
    const rssi = Number.isFinite(body.rssi) ? Math.round(body.rssi) : null;
    const peer = await wearables.userForToken(token);
    if (!peer) return { matchId: null, reason: 'unknown_wearable' };
    await matches.recordProximity(uid, peer, rssi);
    return { matchId: await tryMatch(uid, peer) };
  }

  // LEGACY / DEMO ONLY. The current firmware sends a bare MATCH with no identity, so we pair with whoever else
  // reported in the last 20s. Two pairs meeting at the same time can be crossed, which is why this is gated.
  async function legacyTimeWindow(uid, body) {
    if (!config.demoMode()) throw httpError(403, 'legacy signals are disabled');
    await matches.recordProximity(uid, null, Number.isFinite(body.rssi) ? Math.round(body.rssi) : null);
    for (const peer of await matches.recentReporters(uid, config.LEGACY_WINDOW_SECONDS)) {
      const matchId = await tryMatch(uid, peer);
      if (matchId) return { matchId };
    }
    return { matchId: null };
  }

  const handleSignal = (uid, body = {}) => {
    const legacy = body.detectedWearableToken === undefined;
    return withSpan('signal.handle', { 'signal.kind': legacy ? 'legacy' : 'exact_peer' }, async (span) => {
      const result = await (legacy ? legacyTimeWindow(uid, body) : fromWearable(uid, body));
      span.setAttribute('signal.matched', !!result.matchId);
      return result;
    });
  };

  // ---- match views and actions ----

  async function load(uid, id) {
    const m = /^\d+$/.test(String(id)) ? await matches.getFor(uid, id) : null;
    if (!m) throw httpError(404, 'not found');
    return m;
  }

  const statusOf = (m) =>
    m.a_response === false || m.b_response === false ? 'declined'
      : m.a_response && m.b_response ? 'revealed' : 'pending';

  // Identity and quests appear ONLY once both people have waved.
  async function view(uid, m) {
    const me = m.user_a === uid ? 'a' : 'b';
    const them = me === 'a' ? 'b' : 'a';
    const status = statusOf(m);
    const revealed = status === 'revealed';
    return {
      id: Number(m.id), score: m.score, reason: m.reason, shared: m.shared,
      myResponse: m[`${me}_response`], status,
      other: revealed ? await profiles.card(m[`user_${them}`]) : null,
      quests: revealed ? (await quests.byIds(m.quest_ids)).map(toQuestDto) : [],
      questId: revealed ? m.quest_id ?? null : null,
      questStatus: revealed ? m.quest_status ?? null : null,
    };
  }

  const get = async (uid, id) => view(uid, await load(uid, id));

  // Both phones must end up in the match, but only the one whose signal created it gets the id back.
  // The other polls this while scanning.
  async function current(uid) {
    const m = await matches.currentFor(uid, config.CURRENT_MATCH_MINUTES);
    return m ? view(uid, m) : null;
  }

  // A wave can be withdrawn (wave=false) until the match resolves; once revealed or declined it is final.
  const respond = (uid, id, wave) => withSpan('match.respond', { 'match.wave': !!wave }, async (span) => {
    const m = await load(uid, id);
    if (statusOf(m) === 'pending') await matches.setResponse(m.id, m.user_a === uid ? 'a' : 'b', !!wave);
    const result = await view(uid, await load(uid, id));
    span.setAttribute('match.status', result.status);
    log.info(result.status === 'revealed' ? 'party formed' : wave ? 'wave sent' : 'wave withdrawn', { 'match.status': result.status });
    return result;
  });

  async function block(uid, id, reason) {
    const m = await load(uid, id);
    await matches.block(uid, m.user_a === uid ? m.user_b : m.user_a, reason);
    await matches.declineFor(m.id, uid);
  }

  return { tryMatch, handleSignal, get, current, respond, block, statusOf };
}

module.exports = { createMatching };
