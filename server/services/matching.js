const { score, THRESHOLD } = require('./scoring');
const { httpError } = require('../errors');
const { validateWearableToken } = require('./validation');
const { toQuestDto } = require('./questDto');

// Orchestrates proximity signals -> matches. Repositories are injected so this is testable without a database.
function createMatching({ profiles, matches, wearables, quests, config }) {
  // Decide whether this exact pair may match and return the match id (creating it if needed).
  async function tryMatch(me, peer) {
    if (me === peer) return null;
    const [ua, ub] = [me, peer].sort();

    // Blocks and discovery come first so they also stop an existing match from being handed back.
    if (await matches.isBlocked(ua, ub)) return null;
    const [a, b] = await Promise.all([profiles.get(ua), profiles.get(ub)]);
    if (!a || !b || a.status === 'off' || b.status === 'off') return null;

    const existing = await matches.findRecent(ua, ub); // one-hour duplicate protection
    if (existing) return existing.id;

    const s = score(a, b);
    if (!s || s.score < THRESHOLD) return null;

    const freeOnly = a.budget === 'free' || b.budget === 'free';
    const picks = await quests.pickForMatch(s.shared, freeOnly);
    await matches.insert({ ua, ub, score: s.score, reason: s.reason, shared: s.shared, questIds: picks.map(x => x.id) });
    // Both phones may insert at once; everyone converges on the oldest row.
    return (await matches.findRecent(ua, ub)).id;
  }

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

  const handleSignal = (uid, body = {}) =>
    body.detectedWearableToken === undefined ? legacyTimeWindow(uid, body) : fromWearable(uid, body);

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

  // A wave can be withdrawn (wave=false) until the match resolves; once revealed or declined it is final.
  async function respond(uid, id, wave) {
    const m = await load(uid, id);
    if (statusOf(m) === 'pending') await matches.setResponse(m.id, m.user_a === uid ? 'a' : 'b', !!wave);
    return view(uid, await load(uid, id));
  }

  async function block(uid, id, reason) {
    const m = await load(uid, id);
    await matches.block(uid, m.user_a === uid ? m.user_b : m.user_a, reason);
    await matches.declineFor(m.id, uid);
  }

  return { tryMatch, handleSignal, get, respond, block, statusOf };
}

module.exports = { createMatching };
