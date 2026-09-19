const { q } = require('../db');

const first = async (p) => (await p)[0];

exports.get = (uid) => first(q('select * from profiles where user_id = $1', [uid]));

exports.insert = (uid, p, client) =>
  q(`insert into profiles (user_id, nickname, avatar, archetypes, answers, wants, budget)
     values ($1,$2,$3,$4,$5,$6,$7)`,
    [uid, p.nickname, p.avatar, p.archetypes, p.answers, p.wants, p.budget], client);

// Nickname is the login name, so it is deliberately not editable here.
exports.update = (uid, p) =>
  first(q(`update profiles set avatar=$2, archetypes=$3, answers=$4, wants=$5, budget=$6, updated_at=now()
           where user_id = $1 returning *`,
    [uid, p.avatar, p.archetypes, p.answers, p.wants, p.budget]));

exports.setStatus = (uid, status) => q('update profiles set status = $2 where user_id = $1', [uid, status]);

// What a match sees, and only after both people have waved.
exports.card = (uid) => first(q('select nickname, avatar, archetypes from profiles where user_id = $1', [uid]));

// Demo mode: the simulated partner mirrors the real player so scoring is realistic.
exports.upsertDemo = (uid, p) =>
  q(`insert into profiles (user_id, nickname, avatar, archetypes, answers, wants, budget, status)
     values ($1,$2,$3,$4,$5,$6,$7,$8)
     on conflict (user_id) do update set nickname=$2, avatar=$3, archetypes=$4, answers=$5, wants=$6,
       budget=$7, status=$8, updated_at=now()`,
    [uid, p.nickname, p.avatar, p.archetypes, p.answers, p.wants, p.budget, p.status]);
