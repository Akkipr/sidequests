// Wires the real repositories into the services. Routes import from here; tests build services with fakes instead.
const config = require('./config');
const { tx } = require('./db');
const repos = {
  accounts: require('./repositories/accounts'),
  profiles: require('./repositories/profiles'),
  wearables: require('./repositories/wearables'),
  matches: require('./repositories/matches'),
  quests: require('./repositories/quests'),
};
const { createAccounts } = require('./services/accounts');
const { createMatching } = require('./services/matching');
const { createQuests } = require('./services/quests');
const { createDemo } = require('./services/demo');

module.exports = {
  repos,
  config,
  accounts: createAccounts({ ...repos, tx, config }),
  matching: createMatching({ ...repos, config }),
  quests: createQuests({ ...repos, config }),
  demo: createDemo({ ...repos, config }),
};
