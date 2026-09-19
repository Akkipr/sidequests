const { q } = require('../db');

const first = async (p) => (await p)[0];
const SIDE = { a: 'a_response', b: 'b_response' }; // whitelist, since the column name is interpolated

exports.isBlocked = async (a, b) =>
  (await q('select 1 from blocks where (blocker = $1 and blocked = $2) or (blocker = $2 and blocked = $1)', [a, b])).length > 0;

// One-hour duplicate protection: the oldest match for this pair in the last hour.
exports.findRecent = (ua, ub) =>
  first(q(`select id from matches where user_a = $1 and user_b = $2 and created_at > now() - interval '1 hour'
           order by id limit 1`, [ua, ub]));

exports.insert = async ({ ua, ub, score, reason, shared, questIds }) =>
  (await first(q(`insert into matches (user_a, user_b, score, reason, shared, quest_ids)
                  values ($1,$2,$3,$4,$5,$6) returning id`, [ua, ub, score, reason, shared, questIds]))).id;

exports.getFor = (uid, id) => first(q('select * from matches where id = $1 and $2 in (user_a, user_b)', [id, uid]));

exports.setResponse = (id, side, value) => q(`update matches set ${SIDE[side]} = $2 where id = $1`, [id, value]);

exports.block = (blocker, blocked, reason) =>
  q('insert into blocks (blocker, blocked, reason) values ($1,$2,$3) on conflict do nothing', [blocker, blocked, reason ?? null]);

// Blocking also declines the match for the blocker so it can never reveal.
exports.declineFor = (id, uid) =>
  q(`update matches set a_response = case when user_a = $2 then false else a_response end,
                        b_response = case when user_b = $2 then false else b_response end where id = $1`, [id, uid]);

exports.listBlocks = (uid) =>
  q('select blocked as id, created_at from blocks where blocker = $1 order by created_at desc', [uid]);

exports.unblock = (blocker, blocked) => q('delete from blocks where blocker = $1 and blocked = $2', [blocker, blocked]);

exports.recordProximity = (uid, peer, rssi) =>
  q('insert into proximity_events (user_id, peer_user_id, rssi) values ($1,$2,$3)', [uid, peer, rssi]);

// LEGACY/DEMO ONLY: everyone else who reported a signal recently.
exports.recentReporters = async (uid, seconds) =>
  (await q(`select user_id from proximity_events where user_id <> $1 and time > now() - make_interval(secs => $2)
            group by user_id order by max(time) desc`, [uid, seconds])).map(r => r.user_id);

// --- quest progress. Each transition is one guarded UPDATE, so repeats are no-ops and return false. ---

exports.selectQuest = async (id, questId) =>
  !!(await first(q(`update matches set quest_id = $2, quest_status = 'selected'
                    where id = $1 and (quest_status is null or quest_status = 'selected') returning id`, [id, questId])));

exports.markStarted = async (id) =>
  !!(await first(q(`update matches set quest_status = 'active', quest_started_at = now()
                    where id = $1 and quest_status = 'selected' returning id`, [id])));

// Completes the quest and pays both players in ONE statement, so points can only be awarded once.
exports.completeAndAward = async (id, points) =>
  (await first(q(`with done as (
                    update matches set quest_status = 'completed', quest_completed_at = now()
                    where id = $1 and quest_status = 'active' returning user_a, user_b
                  ), paid as (
                    update profiles set points = points + $2
                    where user_id in (select user_a from done union select user_b from done)
                  )
                  select count(*)::int as n from done`, [id, points]))).n === 1;

// Every quest this person has picked, newest first, with the quest and (only if both waved) the partner.
exports.runsFor = (uid) =>
  q(`select m.id as match_id, m.quest_status as status, m.quest_started_at, m.quest_completed_at,
            (m.a_response is true and m.b_response is true) as revealed,
            qu.id as quest_id, qu.title, qu.description, qu.location, qu.starts, qu.cost, qu.free, qu.minutes,
            p.nickname as partner_nickname, p.avatar as partner_avatar
     from matches m
     join quests qu on qu.id = m.quest_id
     left join profiles p on p.user_id = case when m.user_a = $1 then m.user_b else m.user_a end
     where $1 in (m.user_a, m.user_b) and m.quest_status is not null
     order by coalesce(m.quest_completed_at, m.quest_started_at, m.created_at) desc`, [uid]);
