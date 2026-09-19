require('dotenv').config();
const crypto = require('crypto');
const { promisify } = require('util');
const express = require('express');
const { Pool } = require('pg');
const { score, THRESHOLD } = require('./score');

const db = new Pool({ connectionString: process.env.DATABASE_URL }); // Tiger URL carries sslmode=require
const q = (sql, params) => db.query(sql, params).then(r => r.rows);
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

const app = express();
app.use(express.json());

// Accounts: the nickname is the login name (unique, case-insensitive) and the phone holds a random
// session token; we only store its hash. Signing out deletes the session row.
const scrypt = promisify(crypto.scrypt);
const MIN_PASSWORD = 8;

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  return `${salt.toString('hex')}:${(await scrypt(password, salt, 64)).toString('hex')}`;
}
async function checkPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const got = await scrypt(password, Buffer.from(salt, 'hex'), 64);
  return crypto.timingSafeEqual(got, Buffer.from(hash, 'hex'));
}
// Burn the same scrypt time for unknown nicknames so login timing doesn't reveal which exist.
const DUMMY = hashPassword('not-a-real-password');

async function newSession(client, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  await client.query('insert into sessions (token_hash, user_id) values ($1,$2)', [sha(token), userId]);
  return token;
}

const ARCHETYPES = ['explorer', 'foodie', 'active', 'creator'];
const onlyArchetypes = (xs) => Array.isArray(xs) && xs.every(x => ARCHETYPES.includes(x));

app.post('/signup', async (req, res) => {
  const { nickname, password, avatar, archetypes, answers = {}, wants = [], budget = 'low' } = req.body;
  const name = typeof nickname === 'string' ? nickname.trim().slice(0, 24) : '';
  if (!name || !avatar || !archetypes?.length || !onlyArchetypes(archetypes) || !onlyArchetypes(wants))
    return res.status(400).json({ error: 'nickname, avatar and at least one archetype required' });
  if (typeof password !== 'string' || password.length < MIN_PASSWORD || password.length > 200)
    return res.status(400).json({ error: `password must be ${MIN_PASSWORD}-200 characters` });

  const client = await db.connect();
  try {
    await client.query('begin');
    const { rows: [u] } = await client.query(
      'insert into users (password_hash, nickname_key) values ($1,$2) returning id',
      [await hashPassword(password), name.toLowerCase()]);
    await client.query(
      `insert into profiles (user_id, nickname, avatar, archetypes, answers, wants, budget)
       values ($1,$2,$3,$4,$5,$6,$7)`,
      [u.id, name, avatar, archetypes, answers, wants, budget]);
    const token = await newSession(client, u.id);
    await client.query('commit');
    res.json({ token });
  } catch (e) {
    await client.query('rollback').catch(() => {});
    if (e.code === '23505') return res.status(409).json({ error: 'nickname taken' });
    throw e;
  } finally {
    client.release();
  }
});

app.post('/login', async (req, res) => {
  const { nickname, password } = req.body;
  const [u] = typeof nickname === 'string'
    ? await q('select id, password_hash from users where nickname_key = $1', [nickname.trim().toLowerCase()])
    : [];
  const ok = typeof password === 'string' && password.length <= 200
    && await checkPassword(password, u?.password_hash ?? await DUMMY) && !!u;
  if (!ok) return res.status(401).json({ error: 'wrong nickname or password' });
  res.json({ token: await newSession(db, u.id) });
});

app.use(async (req, res, next) => {
  const token = req.headers.authorization?.replace('Bearer ', '') ?? '';
  const [s] = await q('select user_id from sessions where token_hash = $1', [sha(token)]);
  if (!s) return res.status(401).json({ error: 'unauthorized' });
  req.uid = s.user_id;
  req.tokenHash = sha(token);
  next();
});

app.post('/logout', async (req, res) => {
  await q('delete from sessions where token_hash = $1', [req.tokenHash]);
  await q("update profiles set status = 'off' where user_id = $1", [req.uid]);
  res.json({ ok: true });
});

app.get('/profile', async (req, res) => {
  const [p] = await q('select * from profiles where user_id = $1', [req.uid]);
  res.json(p ?? null);
});

app.post('/status', async (req, res) => {
  await q('update profiles set status = $2 where user_id = $1', [req.uid, req.body.status]);
  res.json({ ok: true });
});

// Phone's wearable saw another wearable up close. Wearables broadcast no identity, so pair with
// whoever else reported within the window.
// ponytail: time-window pairing; two separate pairs meeting in the same 20s can get crossed.
// Upgrade: have wearables advertise a per-user rotating token and look it up here.
const WINDOW = "interval '20 seconds'";
app.post('/signal', async (req, res) => {
  await q('insert into proximity_events (user_id, rssi) values ($1, $2)', [req.uid, req.body.rssi ?? null]);
  const peers = await q(
    `select user_id from proximity_events where user_id <> $1 and time > now() - ${WINDOW}
     group by user_id order by max(time) desc`, [req.uid]);
  for (const p of peers) {
    const matchId = await matchWith(req.uid, p.user_id);
    if (matchId) return res.json({ matchId });
  }
  res.json({ matchId: null });
});

async function matchWith(me, peer) {
  const [ua, ub] = [me, peer].sort();
  const recent = `select id from matches where user_a = $1 and user_b = $2 and created_at > now() - interval '1 hour' order by id limit 1`;
  const [existing] = await q(recent, [ua, ub]);
  if (existing) return existing.id;

  const [blocked] = await q('select 1 from blocks where (blocker = $1 and blocked = $2) or (blocker = $2 and blocked = $1)', [ua, ub]);
  if (blocked) return null;

  const rows = await q('select * from profiles where user_id = any($1)', [[ua, ub]]);
  const a = rows.find(r => r.user_id === ua), b = rows.find(r => r.user_id === ub);
  const s = a && b && score(a, b);
  if (!s || s.score < THRESHOLD) return null;

  const freeOnly = a.budget === 'free' || b.budget === 'free';
  const quests = await q('select id from quests where (not $2 or free) order by (tags && $1) desc, random() limit 3', [s.shared, freeOnly]);
  await q('insert into matches (user_a, user_b, score, reason, shared, quest_ids) values ($1,$2,$3,$4,$5,$6)',
    [ua, ub, s.score, s.reason, s.shared, quests.map(x => x.id)]);
  // Both phones may insert at once; everyone converges on the oldest row.
  const [m] = await q(recent, [ua, ub]);
  return m.id;
}

async function myMatch(req) {
  const [m] = await q('select * from matches where id = $1 and $2 in (user_a, user_b)', [req.params.id, req.uid]);
  return m;
}

app.get('/matches/:id', async (req, res) => {
  const m = await myMatch(req);
  if (!m) return res.status(404).json({ error: 'not found' });
  const me = m.user_a === req.uid ? 'a' : 'b', them = me === 'a' ? 'b' : 'a';
  const status = m.a_response === false || m.b_response === false ? 'declined'
    : m.a_response && m.b_response ? 'revealed' : 'pending';
  // Full profile only once both have waved.
  const [other] = status === 'revealed'
    ? await q('select nickname, avatar, archetypes from profiles where user_id = $1', [m[`user_${them}`]]) : [];
  const quests = await q('select * from quests where id = any($1)', [m.quest_ids]);
  res.json({ id: m.id, score: m.score, reason: m.reason, shared: m.shared, myResponse: m[`${me}_response`], status, other: other ?? null, quests });
});

app.post('/matches/:id/respond', async (req, res) => {
  const m = await myMatch(req);
  if (!m) return res.status(404).json({ error: 'not found' });
  const col = m.user_a === req.uid ? 'a_response' : 'b_response';
  await q(`update matches set ${col} = $2 where id = $1`, [m.id, !!req.body.wave]);
  res.json({ ok: true });
});

app.post('/matches/:id/block', async (req, res) => {
  const m = await myMatch(req);
  if (!m) return res.status(404).json({ error: 'not found' });
  const other = m.user_a === req.uid ? m.user_b : m.user_a;
  await q('insert into blocks (blocker, blocked, reason) values ($1,$2,$3) on conflict do nothing', [req.uid, other, req.body.reason ?? null]);
  await q('update matches set a_response = case when user_a = $2 then false else a_response end, b_response = case when user_b = $2 then false else b_response end where id = $1', [m.id, req.uid]);
  res.json({ ok: true });
});

const port = process.env.PORT ?? 3000;
app.listen(port, '0.0.0.0', () => console.log(`SideQuests API on :${port}`));
