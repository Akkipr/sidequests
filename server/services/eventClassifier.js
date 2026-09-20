const { ARCHETYPES } = require('./validation');

// Maps an external event to one of the archetypes the app already supports (explorer, foodie, active, creator).
// Deterministic: keyword hits are counted per archetype, the highest score wins, and ties go to the more specific
// archetype. No hits -> explorer. The title counts double. WAT2DO's category tag ("Pizza", "Lunch") usually means food is
// *provided*, not that the event is about food, so it is weak evidence: it decides only when the title says nothing.
//
// The app has no "learner" or "social" archetype, so lectures, career events, games, parties and meetups all fold
// into explorer (its catch-all).
const RULES = {
  foodie: 'food|pizza|lunch|dinner|breakfast|brunch|snacks?|s\'?mores|bbq|barbecue|caf[eé]|coffee|tea|restaurants?|markets?|bak(?:e|ing|ery)|dumplings?|ice cream|cheese|tastings?|potluck|corn roast|konbini|fruits?|veg(?:gies?|etables?)|cook(?:ing)?|meals?|feast|dessert|boba|sushi|noodles?|bbq|oktoberfest|eat(?:ing)?',
  active: 'sports?|athletics?|running|runs?|5k|10k|marathon|fitness|workouts?|climb(?:ing)?|bould(?:er|ering)|hik(?:e|es|ing)|yoga|gym|pickleball|basketball|soccer|volleyball|badminton|tennis|swim(?:ming)?|pool|cycl(?:e|ing)|rides?|bikes?|muay thai|martial arts?|sanda|karate|judo|boxing|wrestling|open mat|curl(?:ing)?|canoe(?:ing)?|kayak(?:ing)?|skat(?:e|ing)|hockey|quadball|golf|tournaments?|regatta|dry-land|training|frisbee|ultimate|dodgeball|rowing|track',
  creator: 'art|arts|music|musical|concerts?|bands?|choir|sing(?:ing)?|jam|jams|crafts?|theat(?:re|er)|improv|drama|films?|photo(?:graphy|s)?|design|draw(?:ing)?|sketch(?:ing)?|paint(?:ing)?|poetry|writing|zines?|pottery|knit(?:ting)?|crochet|dance|dancing|salsa|bachata|auditions?|listening party|open mic|comedy|hack(?:athon|s)?|game jam|building|maker|studio|exhibit(?:ion)?|gallery',
  explorer: 'lectures?|talks?|career|networking|info(?:rmation)? sessions?|fairs?|festival|trip|tours?|explor(?:e|ing|ation)|camping|campfire|bonfire|culture|cultural|celebrations?|trivia|board games?|game night|social|meet(?:-?up)?s?|mixer|party|hangouts?|crawl|meet & greet|welcome|kick-?off|orientation|fundrais(?:er|ing)|charity|volunteer|clubs? (?:day|days|fair)|panel|seminar|workshops?|resume|interview|fireside chat|conference|speaker|mingle|movie',
};

const PATTERNS = Object.fromEntries(
  Object.entries(RULES).map(([archetype, words]) => [archetype, new RegExp(`\\b(?:${words})\\b`, 'gi')]));

// Earlier entries win ties, so a specific archetype beats the explorer catch-all.
const TIE_ORDER = ['foodie', 'active', 'creator', 'explorer'];

// Distinct keywords found, so repeating one word doesn't inflate a score.
const hits = (pattern, text) => new Set((text.match(pattern) ?? []).map(m => m.toLowerCase())).size;

/**
 * @param {{title?: string|null, description?: string|null, externalCategory?: string|null}} event
 * @returns {'explorer'|'foodie'|'active'|'creator'} always one of the archetypes the app supports
 */
function classifyEvent({ title, description, externalCategory } = {}) {
  const fields = [[externalCategory, 1], [title, 2], [description, 1]].map(([text, weight]) => [String(text ?? ''), weight]);
  const scores = Object.fromEntries(TIE_ORDER.map(a => [a, fields.reduce((sum, [text, w]) => sum + w * hits(PATTERNS[a], text), 0)]));
  const best = TIE_ORDER.reduce((a, b) => (scores[b] > scores[a] ? b : a)); // strictly greater, so earlier entries win ties
  return scores[best] > 0 ? best : 'explorer';
}

// Guard for the contract the rest of the app relies on.
const isSupported = (a) => ARCHETYPES.includes(a);

module.exports = { classifyEvent, isSupported };
