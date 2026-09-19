const { q } = require('../db');

const first = async (p) => (await p)[0];

exports.createUser = async ({ passwordHash, nicknameKey, demoOwner = null }, client) =>
  (await first(q('insert into users (password_hash, nickname_key, demo_owner) values ($1,$2,$3) returning id',
    [passwordHash, nicknameKey, demoOwner], client))).id;

exports.findLogin = (nicknameKey) =>
  first(q('select id, password_hash from users where nickname_key = $1', [nicknameKey]));

exports.createSession = (userId, tokenHash, client) =>
  q('insert into sessions (token_hash, user_id) values ($1,$2)', [tokenHash, userId], client);

exports.userForSession = async (tokenHash) =>
  (await first(q('select user_id from sessions where token_hash = $1', [tokenHash])))?.user_id;

exports.deleteSession = (tokenHash) => q('delete from sessions where token_hash = $1', [tokenHash]);

exports.findDemoPartner = async (ownerId) =>
  (await first(q('select id from users where demo_owner = $1', [ownerId])))?.id;
