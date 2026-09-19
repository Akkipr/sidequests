const crypto = require('crypto');
const { promisify } = require('util');
const { httpError } = require('../errors');
const { validateProfile } = require('./validation');
const { sha } = require('../tokens');

const scrypt = promisify(crypto.scrypt);

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  return `${salt.toString('hex')}:${(await scrypt(password, salt, 64)).toString('hex')}`;
}
async function checkPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  return crypto.timingSafeEqual(await scrypt(password, Buffer.from(salt, 'hex'), 64), Buffer.from(hash, 'hex'));
}
// Burn the same scrypt time for unknown nicknames so login timing doesn't reveal which exist.
const DUMMY = hashPassword('not-a-real-password');

// Accounts: the nickname is the login name (unique, case-insensitive); the phone holds a session token.
function createAccounts({ accounts, profiles, tx, config }) {
  const newSession = async (userId, client) => {
    const token = crypto.randomBytes(32).toString('hex');
    await accounts.createSession(userId, sha(token), client);
    return token;
  };

  async function signup(body = {}) {
    const name = typeof body.nickname === 'string' ? body.nickname.trim().slice(0, 24) : '';
    if (!name) throw httpError(400, 'nickname required');
    const { password } = body;
    if (typeof password !== 'string' || password.length < config.MIN_PASSWORD || password.length > 200)
      throw httpError(400, `password must be ${config.MIN_PASSWORD}-200 characters`);
    const profile = validateProfile(body);
    const passwordHash = await hashPassword(password);
    try {
      return await tx(async (client) => {
        const userId = await accounts.createUser({ passwordHash, nicknameKey: name.toLowerCase() }, client);
        await profiles.insert(userId, { ...profile, nickname: name }, client);
        return { token: await newSession(userId, client) };
      });
    } catch (e) {
      if (e.code === '23505') throw httpError(409, 'nickname taken');
      throw e;
    }
  }

  async function login({ nickname, password } = {}) {
    const u = typeof nickname === 'string' ? await accounts.findLogin(nickname.trim().toLowerCase()) : null;
    const ok = typeof password === 'string' && password.length <= 200
      && await checkPassword(password, u?.password_hash ?? await DUMMY) && !!u;
    if (!ok) throw httpError(401, 'wrong nickname or password');
    return { token: await newSession(u.id) };
  }

  async function logout(uid, tokenHash) {
    await accounts.deleteSession(tokenHash);
    await profiles.setStatus(uid, 'off');
  }

  return { signup, login, logout };
}

module.exports = { createAccounts };
