#!/usr/bin/env node
// Generates SYNTHETIC traffic against a running server so its Sentry dashboard has something to show without needing a
// crowd of people: disposable players sign up, go discoverable, get matched with a simulated player, wave, pick a quest,
// start it and complete it, plus the everyday error paths (wrong password, unknown match, duplicate name).
//
// It is honest by construction:
//  - every request carries X-SideQuests-Synthetic: 1, which the server turns into a `synthetic:true` tag in Sentry, so
//    dashboards can filter it out (or in). Say it is synthetic when you show it.
//  - it only works against a server started with DEMO_MODE=true (it drives POST /demo/nearby) and stops otherwise.
//  - its players are deleted afterwards (use --keep to leave them).
//
//   npm run demo:traffic -- --players 8 --rounds 2 --concurrency 4
//
// For a clean dashboard, start the server with SENTRY_ENVIRONMENT=demo first.

const RUN_ID = Date.now().toString(36);
const ARCHETYPES = ['explorer', 'foodie', 'active', 'creator'];
const AVATARS = ['🧙', '🥷', '🧑‍🚀', '🦊', '🐸', '🤖', '👾', '🐱'];
const INTENTS = ['open', 'food', 'hour'];
const LIMITS = { players: 200, rounds: 20, concurrency: 10, boom: 20 };

// ---------------------------------------------------------------- small pure helpers (tested)

function parseArgs(argv = [], env = {}) {
  const out = { players: 6, rounds: 2, concurrency: 3, boom: 2, keep: false, help: false, base: env.BASE || 'http://localhost:3000', seed: null };
  for (let i = 0; i < argv.length; i++) {
    const eq = argv[i].indexOf('=');
    const flag = eq < 0 ? argv[i] : argv[i].slice(0, eq);
    const inline = eq < 0 ? undefined : argv[i].slice(eq + 1); // split on the FIRST '=' only, so URLs with '=' survive
    const value = () => (inline !== undefined ? inline : argv[++i]);
    const int = (name) => {
      const n = Number(value());
      if (!Number.isInteger(n) || n < 0 || n > LIMITS[name]) throw new Error(`--${name} must be a whole number from 0 to ${LIMITS[name]}`);
      out[name] = n;
    };
    switch (flag) {
      case '--players': case '--rounds': case '--concurrency': case '--boom': int(flag.slice(2)); break;
      case '--base': out.base = value(); break;
      case '--seed': out.seed = Number(value()); break;
      case '--keep': out.keep = true; break;
      case '--help': case '-h': out.help = true; break;
      default: throw new Error(`unknown option ${flag}`);
    }
  }
  if (out.players < 1 || out.rounds < 1 || out.concurrency < 1) throw new Error('--players, --rounds and --concurrency must be at least 1');
  out.base = out.base.replace(/\/+$/, '');
  return out;
}

/** p in 0..100 over an unsorted list; nearest-rank. */
function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];
}

// Groups /matches/123/respond and /matches/456/respond into one row of the summary.
const UUID = /\/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}(?=\/|$)/g;
const NUMBER = /\/\d+(?=\/|$)/g; // a whole path segment, so a UUID that starts with a digit isn't cut in half
const routeKey = (method, path) => `${method} ${path.replace(/\?.*$/, '').replace(UUID, '/:id').replace(NUMBER, '/:id')}`;

// Small seeded PRNG, so a run can be repeated exactly with --seed.
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------- the run

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function makeClient(base, stats) {
  return async function call(method, path, { token, body } = {}) {
    const started = performance.now();
    let status = 0;
    let json = null;
    try {
      const res = await fetch(base + path, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'SideQuests-demo-traffic/1',
          'X-SideQuests-Synthetic': '1',
          ...(token && { Authorization: `Bearer ${token}` }),
        },
        body: body && JSON.stringify(body),
      });
      status = res.status;
      json = await res.json().catch(() => null);
    } catch (e) {
      json = { error: e.message };
    }
    stats.push({ key: routeKey(method, path), status, ms: performance.now() - started });
    return { status, json };
  };
}

async function runPlayer(i, ctx) {
  const { call, rand, opts, log } = ctx;
  const pick = (xs) => xs[Math.floor(rand() * xs.length)];
  const name = `synthetic-${RUN_ID}-${i}`;
  const password = `synthetic-${RUN_ID}-pass`;
  const mine = ARCHETYPES.filter(() => rand() < 0.5);
  const archetypes = mine.length ? mine : [pick(ARCHETYPES)];

  const signup = await call('POST', '/signup', { body: { nickname: name, password, avatar: pick(AVATARS), archetypes, answers: {}, wants: [], budget: pick(['free', 'low', 'any']) } });
  if (signup.status !== 200) throw new Error(`signup failed (${signup.status}): ${JSON.stringify(signup.json)}`);
  const token = signup.json.token;
  const stat = { completed: 0, declined: 0 };

  await call('PUT', '/profile', { token, body: { avatar: pick(AVATARS), archetypes, answers: {}, wants: [], budget: 'low' } });
  await call('POST', '/status', { token, body: { status: pick(INTENTS) } });

  for (let r = 0; r < opts.rounds; r++) {
    await call('GET', '/quests', { token });
    const demo = await call('POST', '/demo/nearby', { token });
    if (demo.status === 404) throw Object.assign(new Error('this server is not in demo mode (start it with DEMO_MODE=true)'), { fatal: true });
    if (demo.status !== 200) { log(`  player ${i} round ${r + 1}: demo/nearby -> ${demo.status}`); continue; }
    const id = demo.json.matchId;
    await call('GET', `/matches/${id}`, { token });

    if (rand() < 0.2) { // some people say "not now"
      await call('POST', `/matches/${id}/respond`, { token, body: { wave: false } });
      await call('GET', `/matches/${id}`, { token });
      stat.declined++;
      continue;
    }
    await call('POST', `/matches/${id}/respond`, { token, body: { wave: true } });
    let match = null;
    for (let t = 0; t < 15; t++) { // the app polls while it waits for the other wave
      await sleep(1000);
      match = (await call('GET', `/matches/${id}`, { token })).json;
      if (match?.status !== 'pending') break;
    }
    if (match?.status !== 'revealed' || !match.quests?.length) continue;

    const quests = match.quests;
    if (quests.length > 1 && rand() < 0.3) await call('POST', `/matches/${id}/quest`, { token, body: { questId: quests[0].id } }); // "suggest another"
    await call('POST', `/matches/${id}/quest`, { token, body: { questId: pick(quests).id } });
    await call('POST', `/matches/${id}/quest/start`, { token });
    await call('GET', '/quests', { token });
    const done = await call('POST', `/matches/${id}/quest/complete`, { token });
    await call('POST', `/matches/${id}/quest/complete`, { token }); // a repeated tap must not pay twice
    await call('GET', '/profile', { token });
    if (done.json?.awarded) stat.completed++;
  }

  { // the everyday failures a real app sees
    await call('POST', '/login', { body: { nickname: name, password: 'definitely-wrong' } });
    await call('POST', '/signup', { body: { nickname: name, password, avatar: '🦊', archetypes: ['foodie'] } });
    await call('GET', '/matches/999999999', { token });
    await call('POST', '/wearables/link', { token, body: { wearableToken: 'not a valid token' } });
  }
  if (i === 0) for (let b = 0; b < opts.boom; b++) await call('POST', '/demo/test-error', { token }); // real 500s for error monitoring

  await call('POST', '/status', { token, body: { status: 'off' } });
  await call('POST', '/logout', { token });
  log(`  player ${i + 1}/${opts.players} done: ${stat.completed} quest(s) completed, ${stat.declined} declined`);
  return stat;
}

async function pool(items, size, fn) {
  const queue = [...items];
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (queue.length) await fn(queue.shift());
  }));
}

async function cleanup(log) {
  require('dotenv').config({ quiet: true });
  const { pool: db } = require('../db');
  try {
    const r = await db.query('delete from users where nickname_key like $1 returning id', [`synthetic-${RUN_ID}-%`]);
    log(`cleaned up ${r.rowCount} synthetic player(s) and everything they created`);
  } finally {
    await db.end();
  }
}

function report(stats, wallMs, log) {
  const byRoute = new Map();
  for (const s of stats) {
    if (!byRoute.has(s.key)) byRoute.set(s.key, []);
    byRoute.get(s.key).push(s);
  }
  log(`\n${'route'.padEnd(36)} ${'n'.padStart(5)} ${'p50'.padStart(7)} ${'p95'.padStart(7)}  2xx  4xx  5xx`);
  for (const [key, rows] of [...byRoute].sort((a, b) => b[1].length - a[1].length)) {
    const ms = rows.map(r => r.ms);
    const c = (lo, hi) => rows.filter(r => r.status >= lo && r.status < hi).length;
    log(`${key.padEnd(36)} ${String(rows.length).padStart(5)} ${percentile(ms, 50).toFixed(0).padStart(6)}ms ${percentile(ms, 95).toFixed(0).padStart(5)}ms ${String(c(200, 300)).padStart(4)} ${String(c(400, 500)).padStart(4)} ${String(c(500, 600)).padStart(4)}`);
  }
  const all = stats.map(s => s.ms);
  log(`\n${stats.length} requests in ${(wallMs / 1000).toFixed(1)}s (${(stats.length / (wallMs / 1000)).toFixed(1)}/s), p50 ${percentile(all, 50).toFixed(0)}ms, p95 ${percentile(all, 95).toFixed(0)}ms`);
}

async function main() {
  const log = (...a) => console.log(...a);
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2), process.env);
  } catch (e) {
    console.error(e.message);
    process.exit(2);
  }
  if (opts.help) {
    log('usage: npm run demo:traffic -- [--players 6] [--rounds 2] [--concurrency 3] [--boom 2] [--base http://localhost:3000] [--seed N] [--keep]');
    return;
  }

  const stats = [];
  const call = makeClient(opts.base, stats);
  const rand = mulberry32(opts.seed ?? Date.now());
  log(`SYNTHETIC traffic (tagged synthetic:true in Sentry) -> ${opts.base}`);
  log(`${opts.players} players x ${opts.rounds} rounds, ${opts.concurrency} at a time. Start the server with SENTRY_ENVIRONMENT=demo for a clean dashboard.\n`);

  const started = performance.now();
  let failures = 0;
  await pool([...Array(opts.players).keys()], opts.concurrency, async (i) => {
    try {
      await runPlayer(i, { call, rand, opts, log });
    } catch (e) {
      failures++;
      log(`  player ${i + 1} failed: ${e.message}`);
      if (e.fatal) process.exitCode = 1;
    }
  });
  report(stats, performance.now() - started, log);

  if (!opts.keep) await cleanup(log).catch(e => log(`cleanup failed (${e.message}); remove them with: delete from users where nickname_key like 'synthetic-${RUN_ID}-%'`));
  const unexpected5xx = stats.filter(s => s.status >= 500 && s.key !== 'POST /demo/test-error').length;
  if (failures || unexpected5xx) process.exitCode = 1;
}

if (require.main === module) main();

module.exports = { parseArgs, percentile, routeKey, mulberry32, LIMITS };
