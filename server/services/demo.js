const { score } = require('./scoring');
const { httpError } = require('../errors');
const { withSpan, log } = require('../telemetry');

// DEMO MODE ONLY (DEMO_MODE=true). Simulates a nearby player so the whole match -> quest flow works without
// Bluetooth hardware. The partner is a throwaway user owned by the real player (never a login) and is removed
// with them. Nothing here is reachable when demo mode is off.
const NAMES = ['Juno', 'Pixel', 'Kestrel', 'Mango', 'Sprout', 'Nova'];
const AVATARS = ['🧙', '🥷', '🧑‍🚀', '🦊', '🐸', '🤖', '👾', '🐱'];

function createDemo({ accounts, profiles, matches, quests, config, schedule = setTimeout }) {
  const simulateNearby = (uid) => withSpan('demo.simulate_nearby', {}, async () => {
    if (!config.demoMode()) throw httpError(404, 'not found');
    const me = await profiles.get(uid);
    if (!me) throw httpError(409, 'finish onboarding first');
    if (me.status === 'off') throw httpError(409, 'start discovering first');

    const partnerId = (await accounts.findDemoPartner(uid)) ?? (await accounts.createUser({ passwordHash: null, nicknameKey: null, demoOwner: uid }));
    const seed = [...uid].reduce((n, c) => n + c.charCodeAt(0), 0) + Math.floor(Date.now() / 60000);
    const partner = {
      nickname: NAMES[seed % NAMES.length],
      avatar: AVATARS.filter(a => a !== me.avatar)[seed % (AVATARS.length - 1)],
      // Mirror the player, plus one class they said they want to meet, so the pair always fits.
      archetypes: [...new Set([...me.archetypes, ...me.wants.slice(0, 1)])],
      answers: me.answers, wants: [], budget: me.budget, status: me.status,
    };
    await profiles.upsertDemo(partnerId, partner);

    const [ua, ub] = [uid, partnerId].sort();
    const s = score(me, partner) ?? { score: 88, shared: me.archetypes, reason: "You're both looking for a side quest right now." };
    const picks = await quests.pickForMatch(s.shared, me.budget === 'free');
    const matchId = await matches.insert({ ua, ub, score: s.score, reason: s.reason, shared: s.shared, questIds: picks.map(x => x.id) });

    // The simulated player waves back shortly after, so the "waiting" stage is visible.
    const side = partnerId === ua ? 'a' : 'b';
    schedule(() => matches.setResponse(matchId, side, true).catch(console.error), config.DEMO_WAVE_DELAY_MS);
    log.info('simulated nearby player created (demo mode)');
    return { matchId };
  });
  return { simulateNearby };
}

module.exports = { createDemo };
