const { q, tx } = require('../db');

const first = async (p) => (await p)[0];

// Last link wins: one wearable per account, and a token moves to whoever linked it most recently.
exports.link = (uid, token) => tx(async (client) => {
  await q('delete from wearables where user_id = $1 and wearable_token <> $2', [uid, token], client);
  await q(`insert into wearables (user_id, wearable_token) values ($1,$2)
           on conflict (wearable_token) do update set user_id = $1, updated_at = now()`, [uid, token], client);
});

exports.userForToken = async (token) =>
  (await first(q('select user_id from wearables where wearable_token = $1', [token])))?.user_id;

exports.forUser = (uid) => first(q('select updated_at from wearables where user_id = $1', [uid]));

exports.unlink = (uid) => q('delete from wearables where user_id = $1', [uid]);
