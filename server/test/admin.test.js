const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const adminRoutes = require('../routes/admin');
const errorHandler = require('../middleware/errors');
const { httpError } = require('../errors');

const SECRET = 'a-long-random-test-secret-0123456789';
const SUMMARY = { discovered: 12, inserted: 5, updated: 6, skipped: 1, failed: 0 };

// Mounts the real admin route + real error handler with a fake importer. No network, no browser, no database.
async function withServer({ importWat2do = async () => SUMMARY, secret = SECRET } = {}, fn) {
  const calls = { n: 0 };
  const importer = { importWat2do: async () => { calls.n++; return importWat2do(); } };
  const app = express();
  app.use(adminRoutes({ importer, getSecret: () => secret }));
  app.use(errorHandler);
  const server = app.listen(0);
  const url = `http://127.0.0.1:${server.address().port}/admin/import-wat2do`;
  const realError = console.error;
  console.error = () => {}; // the handler logs unexpected errors; keep test output clean
  try {
    await fn({ url, calls, post: (headers = {}) => fetch(url, { method: 'POST', headers }) });
  } finally {
    console.error = realError;
    await new Promise(r => server.close(r));
  }
}

test('no Authorization header -> 401, and the importer never runs', async () => {
  await withServer({}, async ({ post, calls }) => {
    const res = await post();
    assert.equal(res.status, 401);
    assert.deepEqual(await res.json(), { error: 'unauthorized' });
    assert.equal(calls.n, 0);
  });
});

test('wrong, malformed or empty secrets -> 401 with an identical body, and nothing runs', async () => {
  await withServer({}, async ({ post, calls }) => {
    for (const h of [
      { Authorization: 'Bearer wrong-secret' },
      { Authorization: 'Bearer ' },
      { Authorization: 'Bearer' },
      { Authorization: SECRET },                  // no scheme
      { Authorization: `Basic ${SECRET}` },       // wrong scheme
      { Authorization: `bearer ${SECRET}` },      // scheme is case-sensitive
      { Authorization: `Bearer ${SECRET}x` },     // near miss
      { Authorization: `Bearer ${SECRET.slice(0, -1)}` },
    ]) {
      const res = await post(h);
      assert.equal(res.status, 401, JSON.stringify(h));
      assert.deepEqual(await res.json(), { error: 'unauthorized' });
    }
    assert.equal(calls.n, 0);
  });
});

test('if no secret is configured the endpoint is locked for everyone', async () => {
  await withServer({ secret: '' }, async ({ post, calls }) => {
    for (const h of [{}, { Authorization: 'Bearer ' }, { Authorization: 'Bearer anything' }, { Authorization: 'Bearer undefined' }]) {
      assert.equal((await post(h)).status, 401, JSON.stringify(h));
    }
    assert.equal(calls.n, 0);
  });
});

test('the correct secret runs the import and returns the summary', async () => {
  await withServer({}, async ({ post, calls }) => {
    const res = await post({ Authorization: `Bearer ${SECRET}` });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), SUMMARY);
    assert.equal(calls.n, 1);
  });
});

test('an import that fails answers 502 with a generic message: no stack trace, no cause, no secret', async () => {
  const failing = async () => { throw Object.assign(httpError(502, 'import failed'), { cause: new Error(`selector a[href^="/events/"] timed out at /srv/app/wat2do.js:42 (secret ${SECRET})`) }); };
  await withServer({ importWat2do: failing }, async ({ post }) => {
    const res = await post({ Authorization: `Bearer ${SECRET}` });
    const text = await res.text();
    assert.equal(res.status, 502);
    assert.deepEqual(JSON.parse(text), { error: 'import failed' });
    assert.ok(!text.includes(SECRET) && !text.includes('wat2do.js') && !text.includes('at '), text);
  });
});

test('an unexpected crash is a generic 500 without a stack trace or secret', async () => {
  await withServer({ importWat2do: async () => { throw new Error(`kaboom with ${SECRET}\n    at Object.<anonymous> (/srv/x.js:1:1)`); } }, async ({ post }) => {
    const res = await post({ Authorization: `Bearer ${SECRET}` });
    const text = await res.text();
    assert.equal(res.status, 500);
    assert.deepEqual(JSON.parse(text), { error: 'internal error' });
    assert.ok(!text.includes(SECRET) && !text.includes('/srv/x.js'), text);
  });
});

test('an import that is already running answers 409', async () => {
  await withServer({ importWat2do: async () => { throw httpError(409, 'an import is already running'); } }, async ({ post }) => {
    const res = await post({ Authorization: `Bearer ${SECRET}` });
    assert.equal(res.status, 409);
    assert.deepEqual(await res.json(), { error: 'an import is already running' });
  });
});

test('only POST is exposed', async () => {
  await withServer({}, async ({ url }) => {
    assert.equal((await fetch(url, { headers: { Authorization: `Bearer ${SECRET}` } })).status, 404);
  });
});
