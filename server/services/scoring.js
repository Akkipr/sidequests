// Matching score
// 40% shared interests, 30% preference alignment, 20% availability/intent, 10% practical fit (budget).
// Distance is not scored: the wearable already confirmed proximity.
const THRESHOLD = 70;
const BUDGETS = ['free', 'low', 'any'];
const LABEL = { explorer: 'Explorers', foodie: 'Foodies', active: 'into being Active', creator: 'Creators' };
const STATUS = { open: 'open to meeting someone', food: 'looking for food', hour: 'free for the next hour' };

const jaccard = (x, y) => {
  const union = new Set([...x, ...y]).size;
  return union ? x.filter(v => y.includes(v)).length / union : 0;
};

const answerAgreement = (a, b) => {
  const keys = Object.keys(a.answers).filter(k => k in b.answers);
  return keys.length ? keys.filter(k => a.answers[k] === b.answers[k]).length / keys.length : 0;
};

// Hard minimum: if you listed who you want to meet, the other person must be one of them.
const wantsOk = (a, b) => !a.wants.length || a.wants.some(w => b.archetypes.includes(w));
const prefFit = (a, b) =>
  a.wants.length ? a.wants.filter(w => b.archetypes.includes(w)).length / Math.min(a.wants.length, b.archetypes.length) : 0.75;

function score(a, b) {
  if (a.status === 'off' || b.status === 'off') return null;
  if (!wantsOk(a, b) || !wantsOk(b, a)) return null;

  const shared = a.archetypes.filter(x => b.archetypes.includes(x));
  const interests = 0.5 * jaccard(a.archetypes, b.archetypes) + 0.5 * answerAgreement(a, b);
  const pref = (prefFit(a, b) + prefFit(b, a)) / 2;
  const avail = a.status === b.status ? 1 : a.status === 'open' || b.status === 'open' ? 0.7 : 0.3;
  const practical = 1 - Math.abs(BUDGETS.indexOf(a.budget) - BUDGETS.indexOf(b.budget)) / 2;
  const total = Math.round(100 * (0.4 * interests + 0.3 * pref + 0.2 * avail + 0.1 * practical));

  const names = shared.map(s => LABEL[s] ?? s);
  const both = names.length ? `You're both ${names.join(' and ')}` : 'You have different vibes that fit';
  const when = a.status === b.status ? `and you're both ${STATUS[a.status]} right now.` : "and you're both around right now.";
  return { score: total, shared, reason: `${both}, ${when}` };
}

module.exports = { score, THRESHOLD };
