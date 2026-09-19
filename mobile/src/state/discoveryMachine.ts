import type { Intent, MatchView, Status } from '../types/api';

// The discovery lifecycle, centralized. This file is pure (no React, no native modules) so the rules can be
// tested directly. The provider (features/discovery/DiscoveryProvider.tsx) turns state changes into effects
// using the derived helpers at the bottom, so timers, BLE listeners and the server's discovery flag are all
// functions of `state` and can't drift out of sync with it.
//
//   private ─▶ connecting ─▶ scanning ─▶ candidate_detected ─▶ waiting_for_wave ─▶ matched
//                                                                                     │
//                                              private ◀── quest_active ◀── quest_selected
//
// Discovery ALWAYS starts as `private` (nothing here is persisted), whatever the server last said.

export type DiscoveryState =
  | 'private'
  | 'connecting'
  | 'scanning'
  | 'candidate_detected'
  | 'waiting_for_wave'
  | 'matched'
  | 'quest_selected'
  | 'quest_active';

export type WearableStatus = { kind: 'none' | 'connecting' | 'linked' | 'failed'; message?: string };

export type DiscoveryModel = {
  state: DiscoveryState;
  intent: Intent;
  wearable: WearableStatus;
  /** Demo mode: scanning is allowed without a linked wearable (signals are simulated). */
  allowSimulated: boolean;
  /** The match being handled, present exactly in candidate_detected / waiting_for_wave / matched / quest_selected. */
  match: MatchView | null;
  /** The chosen quest, present exactly in quest_selected / quest_active. */
  quest: { matchId: number; questId: number } | null;
  /** One-line notice for the UI ("NO WAVE BACK"), cleared by the next meaningful event. */
  message: string | null;
};

export type DiscoveryEvent =
  | { type: 'START'; intent: Intent }
  | { type: 'CHANGE_INTENT'; intent: Intent }
  | { type: 'GO_PRIVATE'; message?: string }
  | { type: 'WEARABLE_CONNECTING' }
  | { type: 'WEARABLE_LINKED' }
  | { type: 'WEARABLE_FAILED'; message: string }
  | { type: 'WEARABLE_LOST' }
  | { type: 'MATCH_DETECTED'; match: MatchView }
  | { type: 'WAVE_SENT'; match: MatchView }
  | { type: 'MATCH_UPDATED'; match: MatchView }
  | { type: 'MATCH_CLOSED'; message?: string }
  | { type: 'WAVE_TIMEOUT' }
  | { type: 'QUEST_SELECTED'; matchId: number; questId: number }
  | { type: 'QUEST_STARTED'; matchId: number; questId: number }
  | { type: 'QUEST_COMPLETED'; matchId: number };

export const initialModel = (allowSimulated = false): DiscoveryModel => ({
  state: 'private', intent: 'open', wearable: { kind: 'none' }, allowSimulated, match: null, quest: null, message: null,
});

const IN_MATCH: DiscoveryState[] = ['candidate_detected', 'waiting_for_wave', 'matched', 'quest_selected'];
const canScan = (m: DiscoveryModel) => m.wearable.kind === 'linked' || m.allowSimulated;

// Back to a state with no match and no quest, keeping the wearable and intent.
const settle = (m: DiscoveryModel, state: 'private' | 'scanning' | 'connecting', message: string | null = null): DiscoveryModel =>
  ({ ...m, state, match: null, quest: null, message });

// After a match ends we go back to looking, unless we no longer have a signal source (then: private).
const resume = (m: DiscoveryModel, message: string | null = null) => settle(m, canScan(m) ? 'scanning' : 'private', message);

/** The raw transition, exported for tests. Use `discoveryReducer`, which also refuses contradictory results. */
export function transition(m: DiscoveryModel, e: DiscoveryEvent): DiscoveryModel {
  switch (e.type) {
    case 'START':
      if (m.state !== 'private') return m;
      return settle({ ...m, intent: e.intent }, canScan(m) ? 'scanning' : 'connecting');

    case 'CHANGE_INTENT':
      return m.state === 'connecting' || m.state === 'scanning' ? { ...m, intent: e.intent } : m;

    case 'GO_PRIVATE':
      // Leaving a quest in progress is not "going private": the quest itself lives on the server.
      return settle(m, 'private', e.message ?? null);

    case 'WEARABLE_CONNECTING': {
      const next = { ...m, wearable: { kind: 'connecting' } as WearableStatus };
      // Reconnecting mid-scan means the signal source is gone until it links again.
      return m.state === 'scanning' && !canScan(next) ? settle(next, 'connecting') : next;
    }

    case 'WEARABLE_LINKED':
      return m.state === 'connecting'
        ? settle({ ...m, wearable: { kind: 'linked' } }, 'scanning')
        : { ...m, wearable: { kind: 'linked' } };

    case 'WEARABLE_FAILED':
    case 'WEARABLE_LOST': {
      const message = e.type === 'WEARABLE_FAILED' ? e.message : 'Wearable disconnected';
      const wearable: WearableStatus = { kind: e.type === 'WEARABLE_FAILED' ? 'failed' : 'none', message };
      const next = { ...m, wearable };
      // Never "scanning" without a signal source. A match already in progress is left alone.
      if (m.state === 'connecting' || (m.state === 'scanning' && !canScan(next))) return settle(next, 'private', message);
      return next;
    }

    case 'MATCH_DETECTED': {
      if (m.state !== 'scanning') return m; // signals only count while scanning
      const { match } = e;
      if (match.status === 'declined') return m;
      if (match.status === 'revealed') return { ...m, state: 'matched', match, message: null };
      return { ...m, state: match.myResponse ? 'waiting_for_wave' : 'candidate_detected', match, message: null };
    }

    case 'WAVE_SENT':
      return m.state === 'candidate_detected' ? { ...m, state: 'waiting_for_wave', match: e.match, message: null } : m;

    case 'MATCH_UPDATED': {
      if (m.state !== 'candidate_detected' && m.state !== 'waiting_for_wave') return m;
      if (e.match.id !== m.match?.id) return m;
      if (e.match.status === 'revealed') return { ...m, state: 'matched', match: e.match, message: null };
      if (e.match.status === 'declined') return resume(m, 'NOT THIS TIME. MORE QUESTS AWAIT.');
      return { ...m, match: e.match };
    }

    case 'MATCH_CLOSED':
      return IN_MATCH.includes(m.state) ? resume(m, e.message ?? null) : m;

    case 'WAVE_TIMEOUT':
      return m.state === 'waiting_for_wave' ? resume(m, 'NO WAVE BACK. KEEP EXPLORING.') : m;

    case 'QUEST_SELECTED':
      return m.state === 'matched' || m.state === 'quest_selected'
        ? { ...m, state: 'quest_selected', quest: { matchId: e.matchId, questId: e.questId }, message: null } : m;

    case 'QUEST_STARTED':
      // Valid from a fresh pick or from the Quests tab (e.g. after an app restart), so any state may enter it.
      return { ...m, state: 'quest_active', match: null, quest: { matchId: e.matchId, questId: e.questId }, message: null };

    case 'QUEST_COMPLETED':
      // Only the quest we are tracking resets discovery; finishing some other run from the Quests tab must not.
      return (m.state === 'quest_selected' || m.state === 'quest_active') && m.quest?.matchId === e.matchId ? settle(m, 'private') : m;
  }
}

/** Every rule that must hold for any reachable model. Empty = healthy. */
export function violations(m: DiscoveryModel): string[] {
  const v: string[] = [];
  const has = <T,>(x: T | null) => x !== null;
  if (m.state === 'private' && (has(m.match) || has(m.quest))) v.push('private with a match or quest');
  if (m.state === 'connecting' && (has(m.match) || has(m.quest))) v.push('connecting with a match or quest');
  if (m.state === 'scanning' && !canScan(m)) v.push('scanning without a linked wearable');
  if (m.state === 'scanning' && (has(m.match) || has(m.quest))) v.push('scanning with a match or quest');
  if (IN_MATCH.includes(m.state) && !m.match) v.push(`${m.state} without a match`);
  if (m.state === 'candidate_detected' && !(m.match?.status === 'pending' && m.match.myResponse === null)) v.push('candidate is not an unanswered pending match');
  if (m.state === 'waiting_for_wave' && !(m.match?.status === 'pending' && m.match.myResponse === true)) v.push('waiting without a sent wave');
  if ((m.state === 'matched' || m.state === 'quest_selected') && m.match?.status !== 'revealed') v.push(`${m.state} but not revealed`);
  if ((m.state === 'quest_selected' || m.state === 'quest_active') && !m.quest) v.push(`${m.state} without a selected quest`);
  if (m.state !== 'quest_selected' && m.state !== 'quest_active' && m.quest) v.push('quest set outside a quest state');
  if (m.match && !IN_MATCH.includes(m.state)) v.push('match set outside a match state');
  return v;
}

// An event that would leave the model contradictory is dropped, not applied.
export function discoveryReducer(m: DiscoveryModel, e: DiscoveryEvent): DiscoveryModel {
  const next = transition(m, e);
  return violations(next).length ? m : next;
}

// ---- everything below is DERIVED from state, so effects can't disagree with it ----

/** Only waiting_for_wave polls the match. Private, resolved and later states never do. */
export const isPolling = (m: DiscoveryModel) => m.state === 'waiting_for_wave';

/** Wearable signals are only acted on while scanning. */
export const isListening = (m: DiscoveryModel) => m.state === 'scanning';

/** What the server should currently believe. Discoverable only while actually looking (or mid-wave). */
export function serverStatus(m: DiscoveryModel): Status {
  return m.state === 'scanning' || m.state === 'candidate_detected' || m.state === 'waiting_for_wave' ? m.intent : 'off';
}

/** States in which the Match screen has something to show. */
export const inMatchFlow = (s: DiscoveryState) => IN_MATCH.includes(s);
