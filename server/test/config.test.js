const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('../config');

const withEnv = (vars, fn) => {
  const saved = Object.fromEntries(Object.keys(vars).map(k => [k, process.env[k]]));
  for (const [k, v] of Object.entries(vars)) (v === undefined ? delete process.env[k] : (process.env[k] = v));
  try { fn(); } finally { for (const [k, v] of Object.entries(saved)) (v === undefined ? delete process.env[k] : (process.env[k] = v)); }
};

test('the admin secret is used only when it is long enough and not the public placeholder', () => {
  withEnv({ ADMIN_IMPORT_SECRET: 'a-genuinely-long-random-secret-1234' }, () => assert.equal(config.adminSecret(), 'a-genuinely-long-random-secret-1234'));
  for (const bad of [undefined, '', 'short', '123456789012345', 'replace-with-a-long-random-secret']) {
    withEnv({ ADMIN_IMPORT_SECRET: bad }, () => assert.equal(config.adminSecret(), '', String(bad)));
  }
});

test('the importer is off by default and only "true" turns it on', () => {
  withEnv({ ENABLE_WAT2DO_IMPORT: undefined }, () => assert.equal(config.wat2doEnabled(), false));
  for (const v of ['false', '1', 'yes', 'TRUE', '']) withEnv({ ENABLE_WAT2DO_IMPORT: v }, () => assert.equal(config.wat2doEnabled(), false, v));
  withEnv({ ENABLE_WAT2DO_IMPORT: 'true' }, () => assert.equal(config.wat2doEnabled(), true));
});

test('cron defaults to hourly and the base URL to wat2do.ca, both overridable', () => {
  withEnv({ WAT2DO_IMPORT_CRON: undefined, WAT2DO_BASE_URL: undefined }, () => {
    assert.equal(config.wat2doCron(), '0 * * * *');
    assert.equal(config.wat2doBaseUrl(), 'https://wat2do.ca');
  });
  withEnv({ WAT2DO_IMPORT_CRON: '*/15 * * * *', WAT2DO_BASE_URL: 'https://wat2do.io' }, () => {
    assert.equal(config.wat2doCron(), '*/15 * * * *');
    assert.equal(config.wat2doBaseUrl(), 'https://wat2do.io');
  });
});
