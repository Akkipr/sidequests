const { httpError } = require('../errors');

const ARCHETYPES = ['explorer', 'foodie', 'active', 'creator'];
const BUDGETS = ['free', 'low', 'any'];
const STATUSES = ['off', 'open', 'food', 'hour'];

const onlyArchetypes = (xs) => Array.isArray(xs) && xs.every(x => ARCHETYPES.includes(x));

// Shared by signup and profile edits. Returns the cleaned profile fields or throws a 400.
function validateProfile(body = {}) {
  const { avatar, archetypes, answers = {}, wants = [], budget = 'low' } = body;
  if (typeof avatar !== 'string' || !avatar || avatar.length > 16) throw httpError(400, 'avatar required');
  if (!Array.isArray(archetypes) || !archetypes.length || !onlyArchetypes(archetypes))
    throw httpError(400, 'pick at least one archetype');
  if (!onlyArchetypes(wants)) throw httpError(400, 'invalid wants');
  if (!BUDGETS.includes(budget)) throw httpError(400, 'invalid budget');
  const entries = answers && typeof answers === 'object' && !Array.isArray(answers) ? Object.entries(answers) : null;
  if (!entries || entries.length > 20 || entries.some(([k, v]) => typeof v !== 'string' || v.length > 40 || k.length > 40))
    throw httpError(400, 'invalid answers');
  return {
    avatar,
    archetypes: [...new Set(archetypes)],
    wants: [...new Set(wants)],
    budget,
    answers: Object.fromEntries(entries),
  };
}

function validateStatus(status) {
  if (!STATUSES.includes(status)) throw httpError(400, 'invalid status');
  return status;
}

// Tokens travel in "NEAR:<token>:<rssi>", so ':' is not allowed inside one.
const TOKEN_RE = /^[A-Za-z0-9_.-]{4,128}$/;
function validateWearableToken(token) {
  if (typeof token !== 'string' || !TOKEN_RE.test(token)) throw httpError(400, 'invalid wearable token');
  return token;
}

module.exports = { ARCHETYPES, BUDGETS, STATUSES, validateProfile, validateStatus, validateWearableToken };
