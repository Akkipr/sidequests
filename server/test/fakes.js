// In-memory stand-ins for the repositories, so services are tested without a database. They mirror the
// contracts in ../repositories (including the guarded, idempotent quest transitions).
const profile = (o) => ({ nickname: 'x', avatar: '🦊', archetypes: ['foodie'], answers: {}, wants: [], budget: 'low', status: 'open', points: 0, ...o });

function makeWorld({ demo = false } = {}) {
  const w = { profiles: new Map(), tokens: new Map(), blocks: [], matches: [], proximity: [], nextId: 1, demo };
  const config = { demoMode: () => w.demo, QUEST_POINTS: 50, MIN_PASSWORD: 8, DEMO_WAVE_DELAY_MS: 6000, LEGACY_WINDOW_SECONDS: 20, CURRENT_MATCH_MINUTES: 10, OPEN_MATCH_MINUTES: 10 };
  const QUESTS = [1, 2, 3, 4].map(id => ({ id, title: `Quest ${id}`, description: 'd', location: 'l', starts: 'Now', cost: 'Free', free: true, minutes: 30, tags: ['foodie'] }));
  const side = (m, uid) => (m.user_a === uid ? 'a' : 'b');

  const profiles = {
    get: async (uid) => w.profiles.get(uid),
    card: async (uid) => { const p = w.profiles.get(uid); return p && { nickname: p.nickname, avatar: p.avatar, archetypes: p.archetypes }; },
    upsertDemo: async (uid, p) => { w.profiles.set(uid, profile({ ...w.profiles.get(uid), ...p })); },
  };
  const wearables = {
    userForToken: async (t) => w.tokens.get(t),
    link: async (uid, t) => { for (const [k, v] of w.tokens) if (v === uid) w.tokens.delete(k); w.tokens.set(t, uid); },
  };
  const quests = {
    byIds: async (ids) => ids.map(id => QUESTS.find(q => q.id === id)),
    pickForMatch: async () => QUESTS.slice(0, 3).map(q => ({ id: q.id })),
    suggested: async (_a, _f, exclude) => QUESTS.filter(q => !exclude.includes(q.id)).slice(0, 3),
  };
  const matches = {
    isBlocked: async (a, b) => w.blocks.some(x => (x.blocker === a && x.blocked === b) || (x.blocker === b && x.blocked === a)),
    findOpen: async (ua, ub, minutes) => w.matches.find(m => m.user_a === ua && m.user_b === ub
      && m.a_response !== false && m.b_response !== false && !(m.a_response && m.b_response)
      && Date.now() - m.created_at <= minutes * 60000),
    insert: async ({ ua, ub, score, reason, shared, questIds }) => {
      const id = w.nextId++;
      w.matches.push({ id, user_a: ua, user_b: ub, score, reason, shared, quest_ids: questIds, a_response: null, b_response: null, created_at: Date.now(),
        quest_id: null, quest_status: null, quest_started_at: null, quest_completed_at: null });
      return id;
    },
    currentFor: async (uid) => [...w.matches].reverse().find(m =>
      (m.user_a === uid || m.user_b === uid) && m.a_response !== false && m.b_response !== false),
    getFor: async (uid, id) => w.matches.find(m => m.id === Number(id) && (m.user_a === uid || m.user_b === uid)),
    setResponse: async (id, s, v) => { w.matches.find(m => m.id === id)[`${s}_response`] = v; },
    block: async (blocker, blocked) => { w.blocks.push({ blocker, blocked }); },
    declineFor: async (id, uid) => { const m = w.matches.find(x => x.id === id); m[`${side(m, uid)}_response`] = false; },
    recordProximity: async (uid, peer, rssi) => { w.proximity.push({ uid, peer, rssi, at: Date.now() }); },
    recentReporters: async (uid) => [...new Set(w.proximity.filter(p => p.uid !== uid).map(p => p.uid))],
    selectQuest: async (id, questId) => {
      const m = w.matches.find(x => x.id === id);
      if (m.quest_status && m.quest_status !== 'selected') return false;
      m.quest_id = questId; m.quest_status = 'selected'; return true;
    },
    markStarted: async (id) => {
      const m = w.matches.find(x => x.id === id);
      if (m.quest_status !== 'selected') return false;
      m.quest_status = 'active'; m.quest_started_at = new Date(); return true;
    },
    completeAndAward: async (id, points) => {
      const m = w.matches.find(x => x.id === id);
      if (m.quest_status !== 'active') return false;
      m.quest_status = 'completed'; m.quest_completed_at = new Date();
      for (const uid of [m.user_a, m.user_b]) w.profiles.get(uid).points += points;
      return true;
    },
    runsFor: async (uid) => w.matches
      .filter(m => (m.user_a === uid || m.user_b === uid) && m.quest_status)
      .map(m => {
        const q = QUESTS.find(x => x.id === m.quest_id);
        const other = w.profiles.get(m.user_a === uid ? m.user_b : m.user_a);
        return { match_id: m.id, status: m.quest_status, quest_started_at: m.quest_started_at, quest_completed_at: m.quest_completed_at,
          revealed: m.a_response === true && m.b_response === true, quest_id: q.id, title: q.title, description: q.description,
          location: q.location, starts: q.starts, cost: q.cost, free: q.free, minutes: q.minutes,
          partner_nickname: other?.nickname, partner_avatar: other?.avatar };
      }),
  };
  const accounts = {
    findDemoPartner: async (owner) => w.demoPartners?.get(owner),
    createUser: async ({ demoOwner }) => {
      const id = `u-demo-${demoOwner}`;
      (w.demoPartners ??= new Map()).set(demoOwner, id);
      return id;
    },
  };
  return { w, config, repos: { profiles, wearables, quests, matches, accounts } };
}

// Two compatible, discoverable people with wearables, plus a third to prove unrelated users are never paired.
function seedPeople(world) {
  const { w } = world;
  const same = { archetypes: ['foodie', 'explorer'], answers: { foodie_spicy: 'yes' }, status: 'food' };
  w.profiles.set('u-alice', profile({ nickname: 'Alice', avatar: '🧙', ...same }));
  w.profiles.set('u-bob', profile({ nickname: 'Bob', avatar: '🥷', ...same }));
  w.profiles.set('u-carol', profile({ nickname: 'Carol', avatar: '🤖', ...same }));
  w.tokens.set('tok-alice', 'u-alice');
  w.tokens.set('tok-bob', 'u-bob');
  w.tokens.set('tok-carol', 'u-carol');
}

module.exports = { makeWorld, seedPeople, profile };
