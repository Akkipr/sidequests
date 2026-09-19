// MVP: 4 archetypes, 2 quick questions each. Answer keys are compared across users for scoring.
export const ARCHETYPES = [
  { id: 'explorer', name: 'Explorer', icon: '🧭', questions: [
    { id: 'explorer_plan', text: 'Plan it or wing it?', options: ['plan', 'wing'] },
    { id: 'explorer_outdoor', text: 'Outdoors over indoors?', options: ['yes', 'no'] },
  ] },
  { id: 'foodie', name: 'Foodie', icon: '🍜', questions: [
    { id: 'foodie_spicy', text: 'Spicy food?', options: ['yes', 'no'] },
    { id: 'foodie_style', text: 'Street food or sit-down?', options: ['street', 'sit-down'] },
  ] },
  { id: 'active', name: 'Active', icon: '⚡', questions: [
    { id: 'active_level', text: 'Chill stroll or sweat?', options: ['stroll', 'sweat'] },
    { id: 'active_team', text: 'Team games?', options: ['yes', 'no'] },
  ] },
  { id: 'creator', name: 'Creator', icon: '🎨', questions: [
    { id: 'creator_medium', text: 'Draw, photo or build?', options: ['draw', 'photo', 'build'] },
    { id: 'creator_show', text: 'Share what you make?', options: ['yes', 'no'] },
  ] },
] as const;

export type Question = { id: string; text: string; options: readonly string[] };

export const AVATARS = ['🧙', '🥷', '🧑‍🚀', '🦊', '🐸', '🤖', '👾', '🐱'];

export const INTENTS = [
  { id: 'open', label: 'Open to meeting' },
  { id: 'food', label: 'Looking for food' },
  { id: 'hour', label: 'Free for the hour' },
] as const;

export const BUDGETS = [['free', 'Free only'], ['low', 'Cheap'], ['any', 'Whatever']] as const;

export const archetypeById = (id: string) => ARCHETYPES.find(a => a.id === id);

export const questionsFor = (archetypes: readonly string[]): Question[] =>
  ARCHETYPES.filter(a => archetypes.includes(a.id)).flatMap(a => a.questions as readonly Question[]);

// Drop answers for classes that were un-picked after answering, so they can't skew scoring.
export const keepAnswers = (archetypes: readonly string[], answers: Record<string, string>) =>
  Object.fromEntries(questionsFor(archetypes).flatMap(q => (answers[q.id] ? [[q.id, answers[q.id]]] : [])));
