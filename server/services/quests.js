const { httpError } = require('../errors');

const shape = (r) => ({
  matchId: Number(r.match_id),
  status: r.status,
  quest: { id: r.quest_id, title: r.title, description: r.description, location: r.location, starts: r.starts, cost: r.cost, minutes: r.minutes },
  partner: r.revealed && r.partner_nickname ? { nickname: r.partner_nickname, avatar: r.partner_avatar } : null,
  startedAt: r.quest_started_at ?? null,
  completedAt: r.quest_completed_at ?? null,
});

// Quest progress: selected -> active -> completed. Every step is idempotent, and completion pays out once.
function createQuests({ matches, quests, profiles, config }) {
  async function revealedMatch(uid, matchId) {
    const m = /^\d+$/.test(String(matchId)) ? await matches.getFor(uid, matchId) : null;
    if (!m) throw httpError(404, 'not found');
    if (!(m.a_response && m.b_response)) throw httpError(409, 'both players must wave first');
    return m;
  }

  const runOf = async (uid, matchId) => {
    const runs = await matches.runsFor(uid);
    return shape(runs.find(r => Number(r.match_id) === Number(matchId)));
  };

  async function select(uid, matchId, questId) {
    const m = await revealedMatch(uid, matchId);
    if (!m.quest_ids.includes(questId)) throw httpError(400, 'that quest was not offered for this match');
    if (m.quest_status === 'active' || m.quest_status === 'completed') {
      if (m.quest_id === questId) return { run: await runOf(uid, m.id) }; // repeat of the same choice
      throw httpError(409, 'quest already started');
    }
    await matches.selectQuest(m.id, questId); // swapping while still 'selected' is allowed ("suggest another")
    return { run: await runOf(uid, m.id) };
  }

  async function start(uid, matchId) {
    const m = await revealedMatch(uid, matchId);
    if (!m.quest_status) throw httpError(409, 'pick a quest first');
    if (m.quest_status === 'selected') {
      const others = await matches.runsFor(uid);
      if (others.some(r => r.status === 'active' && Number(r.match_id) !== Number(m.id)))
        throw httpError(409, 'finish your current quest first');
      await matches.markStarted(m.id);
    }
    return { run: await runOf(uid, m.id) }; // already active or completed: unchanged
  }

  async function complete(uid, matchId) {
    const m = await revealedMatch(uid, matchId);
    if (m.quest_status === 'selected' || !m.quest_status) throw httpError(409, 'start the quest first');
    const awarded = m.quest_status === 'active' ? await matches.completeAndAward(m.id, config.QUEST_POINTS) : false;
    return { run: await runOf(uid, m.id), awarded };
  }

  // Everything the Quests tab needs in one call.
  async function overview(uid) {
    const runs = (await matches.runsFor(uid)).map(shape);
    const profile = await profiles.get(uid);
    const done = runs.filter(r => r.status === 'completed');
    const current = runs.find(r => r.status === 'active') ?? runs.find(r => r.status === 'selected') ?? null;
    const suggested = profile
      ? await quests.suggested(profile.archetypes, profile.budget === 'free', runs.map(r => r.quest.id)) : [];
    return { active: current, suggested, history: done };
  }

  return { select, start, complete, overview };
}

module.exports = { createQuests };
