const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyEvent, isSupported } = require('../services/eventClassifier');
const { ARCHETYPES } = require('../services/validation');

const cls = (title, extra = {}) => classifyEvent({ title, ...extra });

test('food events are foodie', () => {
  assert.equal(cls('Ice Cream Cooldown'), 'foodie');
  assert.equal(cls('Fruit & Veggie Market'), 'foodie');
  assert.equal(cls('Cheese Club Meeting'), 'foodie');
  assert.equal(cls('Grand Opening: JSA BoT Konbini Night'), 'foodie');
  assert.equal(cls('Pizza Night'), 'foodie');
});

test('sports and fitness events are active', () => {
  assert.equal(cls('Terry Fox Run'), 'active');
  assert.equal(cls('UW Muay Thai Free Try It Sessions'), 'active');
  assert.equal(cls('Learn To Curl'), 'active');
  assert.equal(cls('Canoeing the Grand'), 'active');
  assert.equal(cls('Pickleball Club Sessions'), 'active');
  assert.equal(cls('Trauma-Informed Yoga for Students'), 'active');
});

test('arts, music and making are creator', () => {
  assert.equal(cls('One Day Choir'), 'creator');
  assert.equal(cls('Improv UW Drop-in Jams'), 'creator');
  assert.equal(cls('Cuban Salsa Classes'), 'creator');
  assert.equal(cls('UW Game Jam'), 'creator');
  assert.equal(cls('EngPlay Auditions'), 'creator');
  assert.equal(cls('Bandwidth Listening Party'), 'creator');
});

test('lectures, careers, games and socials fold into explorer (the app has no learner/social archetype)', () => {
  assert.equal(cls('Deloitte Info Session and Networking Event'), 'explorer');
  assert.equal(cls('Board Game Social Night'), 'explorer');
  assert.equal(cls('Interview Skills Workshop'), 'explorer');
  assert.equal(cls('Campus Life Fair'), 'explorer');
  assert.equal(cls('Shaw Festival Trip'), 'explorer');
  assert.equal(cls('Ganesh Utsav'), 'explorer'); // no keywords at all
});

test('a food tag only decides when the title says nothing (it usually means food is provided)', () => {
  assert.equal(cls('Open Night', { externalCategory: 'Pizza, Lunch' }), 'foodie');
  assert.equal(cls('Fall Hiring Event', { externalCategory: 'Food' }), 'foodie');
  // title keywords win, so a directors' meet-and-greet with pizza is not a "foodie" event
  assert.equal(cls('Meet the WUSA Directors', { externalCategory: 'Pizza' }), 'explorer');
  assert.equal(cls('Campus Life Fair', { externalCategory: 'Food' }), 'explorer');
  assert.equal(cls('Choir Night', { externalCategory: 'Pizza' }), 'creator');
});

test('the description is used as a weak fallback', () => {
  assert.equal(cls('Weekly Session', { description: 'We climb and boulder together.' }), 'active');
  // ...but the title still wins over it
  assert.equal(cls('Choir Night', { description: 'Pizza afterwards' }), 'creator');
});

test('ties go to the more specific archetype, never the catch-all', () => {
  assert.equal(cls('Sports Trivia Night'), 'active'); // active(sports) vs explorer(trivia)
});

test('matching is whole-word, so look-alikes do not fire', () => {
  assert.equal(cls('Party at the Artisan Market'), 'foodie'); // "market" counts; "artisan" is not "art"
  assert.equal(cls('Rundown of the Semester'), 'explorer'); // "run" is not inside "rundown"
});

test('null, empty and missing fields fall back to explorer without throwing', () => {
  assert.equal(classifyEvent(), 'explorer');
  assert.equal(classifyEvent({}), 'explorer');
  assert.equal(classifyEvent({ title: null, description: null, externalCategory: null }), 'explorer');
  assert.equal(classifyEvent({ title: '' }), 'explorer');
});

test('is deterministic', () => {
  const e = { title: 'Social Ride', externalCategory: 'Food', description: 'Coffee after' };
  assert.equal(classifyEvent(e), classifyEvent({ ...e }));
});

test('only ever returns archetypes the app supports', () => {
  const samples = ['Yoga', 'Pizza', 'Choir', 'Lecture', '', 'Zzz', 'Hackathon', 'Camping Trip', 'Bake Sale', 'Ultimate Frisbee'];
  for (const t of samples) {
    const a = cls(t);
    assert.ok(ARCHETYPES.includes(a) && isSupported(a), `${t} -> ${a}`);
  }
});
