import { createContext, ReactNode, useContext, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { DEMO_MODE } from '../../config';
import { navigationRef } from '../../app/navigation/navigationRef';
import * as api from '../../services/api';
import {
  connectWearable as bleConnect, disconnectWearable, onWearableDisconnect, onWearableMessage, WearableMessage,
  writeWearableState,
} from '../../services/ble';
import {
  DiscoveryModel, discoveryReducer, inMatchFlow, initialModel, isListening, isPolling, serverStatus, wearableState,
} from '../../state/discoveryMachine';
import type { Intent, QuestRun } from '../../types/api';
import { appLog, traced } from '../../services/monitoring';
import { useSession } from '../auth/SessionProvider';

const POLL_MS = 3000;            // how often to ask whether the other person waved back
const WAVE_TIMEOUT_MS = 120000;  // give up waiting after 2 minutes
const NEAR_COOLDOWN_MS = 10000;  // wearables may repeat NEAR; don't hit the server for the same peer every second
const LEGACY_TRIES = 7;          // LEGACY MATCH signals: keep asking for ~20s while the other phone reports
const LEGACY_GAP_MS = 3000;
const CURRENT_MATCH_MS = 5000;  // only one of the two wearables may report; the other polls for the match

export type Discovery = {
  model: DiscoveryModel;
  /** Bumps whenever quest data changed, so the Quests tab knows to reload. */
  questsVersion: number;
  start: (intent: Intent) => void;
  changeIntent: (intent: Intent) => void;
  goPrivate: () => void;
  connectWearable: () => Promise<void>;
  repairWearable: () => Promise<void>;
  wave: () => Promise<void>;
  notNow: () => Promise<void>;
  cancelWave: () => Promise<void>;
  leaveMatch: () => void;
  reportAndBlock: () => Promise<void>;
  chooseQuest: (questId: number) => Promise<void>;
  startChosenQuest: () => Promise<void>;
  // The run actions resolve true on success, so callers can close their screen only when it worked.
  startRun: (run: QuestRun) => Promise<boolean>;
  completeRun: (run: QuestRun) => Promise<boolean>;
  suggestAnother: (run: QuestRun) => Promise<boolean>;
  simulateNearby: () => Promise<void>;
};

const Ctx = createContext<Discovery | null>(null);
export const useDiscovery = () => {
  const d = useContext(Ctx);
  if (!d) throw new Error('useDiscovery outside DiscoveryProvider');
  return d;
};

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const fail = (e: unknown) => { if (!api.isAuthError(e)) Alert.alert('Error', api.errorMessage(e)); };

// Turns discovery STATE into side effects. Every timer, listener and server flag below is a function of
// `model` (via the helpers in state/discoveryMachine), so none can outlive the state that justifies it.
export function DiscoveryProvider({ children }: { children: ReactNode }) {
  const { refreshProfile } = useSession();
  const [model, dispatch] = useReducer(discoveryReducer, DEMO_MODE, initialModel); // always starts private
  const [questsVersion, setQuestsVersion] = useState(0);

  const modelRef = useRef(model);
  modelRef.current = model;
  const mounted = useRef(true);
  const seen = useRef(new Set<number>());       // matches already surfaced this session
  const lastNear = useRef(new Map<string, number>());
  const legacyBusy = useRef(false);
  const inflight = useRef<Promise<{ token: string | null }> | null>(null);
  useEffect(() => () => { mounted.current = false; }, []);

  const send = (e: Parameters<typeof dispatch>[0]) => { if (mounted.current) dispatch(e); };
  const bump = () => setQuestsVersion(v => v + 1);

  // ---- 1. The server's discoverability flag mirrors the state. This also resets it to private on launch. ----
  const wantStatus = serverStatus(model);
  useEffect(() => {
    let cancelled = false;
    api.setStatus(wantStatus).catch((e: unknown) => {
      // If we can't tell the server we're discoverable, we must not pretend to be scanning.
      if (!cancelled && wantStatus !== 'off' && !api.isAuthError(e)) {
        send({ type: 'GO_PRIVATE', message: `Couldn't go live: ${api.errorMessage(e)}` });
      }
    });
    return () => { cancelled = true; };
  }, [wantStatus]);

  // ---- 2. Wearable connection ----
  async function runConnect() {
    send({ type: 'WEARABLE_CONNECTING' });
    inflight.current ??= traced('wearable.connect', bleConnect).finally(() => { inflight.current = null; }); // never two connects at once
    try {
      const { token } = await inflight.current;
      // Exact-peer pairing needs the server to know which account owns this wearable.
      if (token) await api.linkWearable(token).catch((e: unknown) => console.warn('wearable link failed', e));
      appLog.info('wearable linked', { 'wearable.has_token': !!token });
      send({ type: 'WEARABLE_LINKED' });
    } catch (e) {
      appLog.warn('wearable connect failed'); // the reason stays on the phone, shown to the player
      send({ type: 'WEARABLE_FAILED', message: api.errorMessage(e) });
    }
  }
  useEffect(() => { if (model.state === 'connecting') void runConnect(); }, [model.state]);
  useEffect(() => onWearableDisconnect(() => send({ type: 'WEARABLE_LOST' })), []);

  // ---- 3. Wearable signals: only while scanning ----
  const listening = isListening(model);
  useEffect(() => {
    if (!listening) return;
    let active = true;
    const surface = async (matchId: number | null) => {
      if (!matchId || seen.current.has(matchId) || !active) return false;
      seen.current.add(matchId);
      const match = await api.getMatch(matchId);
      if (active) send({ type: 'MATCH_DETECTED', match });
      return true;
    };
    const onMessage = async (msg: WearableMessage) => {
      try {
        if (msg.kind === 'near') {
          if (Date.now() - (lastNear.current.get(msg.token) ?? 0) < NEAR_COOLDOWN_MS) return;
          lastNear.current.set(msg.token, Date.now());
          const r = await api.sendSignal({ detectedWearableToken: msg.token, rssi: msg.rssi, timestamp: Math.floor(Date.now() / 1000) });
          await surface(r.matchId);
        } else if (msg.kind === 'legacy_match' && !legacyBusy.current) {
          // LEGACY / demo-only: the old firmware reports "someone is near" with no identity.
          legacyBusy.current = true;
          try {
            for (let i = 0; i < LEGACY_TRIES && active; i++) {
              const r = await api.sendSignal({}).catch(() => ({ matchId: null }));
              if (await surface(r.matchId)) break;
              await sleep(LEGACY_GAP_MS);
            }
          } finally {
            legacyBusy.current = false;
          }
        }
      } catch (e) {
        console.warn('signal failed', e);
      }
    };
    const off = onWearableMessage(m => { void onMessage(m); });

    // Matching is one-sided: the server hands the id only to the phone whose signal created the match.
    // Without this, the partner sees nothing unless their own wearable happens to report too.
    const poll = setInterval(() => {
      api.getCurrentMatch().then(m => { if (m) void surface(m.id); }, () => {});
    }, CURRENT_MATCH_MS);

    return () => { active = false; off(); clearInterval(poll); };
  }, [listening]);

  // ---- 3b. The wearable's display mirrors the match state, and its buttons answer the match. ----
  // Unlike signals, this is not limited to scanning: the prompt appears exactly while a candidate is open.
  const shownOnWearable = wearableState(model);
  useEffect(() => { void writeWearableState(shownOnWearable); }, [shownOnWearable]);

  // ---- 4. Waiting for the other wave: poll, with a timeout. Only exists in waiting_for_wave. ----
  const polling = isPolling(model);
  const pollId = model.match?.id;
  useEffect(() => {
    if (!polling || pollId === undefined) return;
    let active = true;
    const interval = setInterval(() => {
      api.getMatch(pollId).then(match => { if (active) send({ type: 'MATCH_UPDATED', match }); }, () => {});
    }, POLL_MS);
    const timeout = setTimeout(() => {
      if (!active) return;
      active = false;
      api.respondToMatch(pollId, false).catch(() => {}); // withdraw, so a late wave can't reveal you unexpectedly
      send({ type: 'WAVE_TIMEOUT' });
    }, WAVE_TIMEOUT_MS);
    return () => { active = false; clearInterval(interval); clearTimeout(timeout); };
  }, [polling, pollId]);

  // ---- 5. Navigation follows the lifecycle: the Match flow opens and closes with the state ----
  const prevState = useRef(model.state);
  useEffect(() => {
    const was = prevState.current;
    prevState.current = model.state;
    if (!navigationRef.isReady()) return;
    const onMatch = navigationRef.getCurrentRoute()?.name === 'Match';
    if (inMatchFlow(model.state) && !inMatchFlow(was) && !onMatch) navigationRef.navigate('Match');
    else if (!inMatchFlow(model.state) && inMatchFlow(was) && onMatch) {
      if (model.state === 'quest_active') navigationRef.navigate('Main', { screen: 'Quests' });
      else navigationRef.goBack();
    }
  }, [model.state]);

  // ---- actions (screens call these; none of them touch the network directly) ----
  const actions = useMemo(() => {
    const cur = () => modelRef.current;
    const matchId = () => cur().match?.id ?? cur().quest?.matchId;

    const closeMatch = async (respond: boolean) => {
      const id = cur().match?.id;
      if (id !== undefined && respond) await api.respondToMatch(id, false);
      send({ type: 'MATCH_CLOSED' });
    };

    return {
      start: (intent: Intent) => {
        seen.current.clear();     // a fresh start may show a still-open match (and re-report a nearby wearable) again
        lastNear.current.clear();
        appLog.info('discovery started', { intent });
        send({ type: 'START', intent });
      },
      changeIntent: (intent: Intent) => send({ type: 'CHANGE_INTENT', intent }),
      goPrivate: () => {
        const { state, match } = cur();
        if (state === 'waiting_for_wave' && match) api.respondToMatch(match.id, false).catch(() => {}); // withdraw the wave
        appLog.info('discovery stopped');
        send({ type: 'GO_PRIVATE' });
      },
      connectWearable: runConnect,
      repairWearable: async () => {
        await disconnectWearable();
        send({ type: 'WEARABLE_LOST' });
        await runConnect();
      },
      wave: async () => {
        const m = cur().match;
        if (!m || cur().state !== 'candidate_detected') return;
        try {
          const match = await api.respondToMatch(m.id, true);
          appLog.info('wave sent', { 'match.status': match.status });
          send(match.status === 'pending' ? { type: 'WAVE_SENT', match } : { type: 'MATCH_UPDATED', match });
        } catch (e) { fail(e); }
      },
      notNow: async () => { try { await closeMatch(true); appLog.info('match declined'); } catch (e) { fail(e); } },
      cancelWave: async () => { try { await closeMatch(true); } catch (e) { fail(e); } },
      leaveMatch: () => send({ type: 'MATCH_CLOSED' }),
      reportAndBlock: async () => {
        const id = matchId();
        if (id === undefined) return;
        try {
          await api.blockMatch(id);
          send({ type: 'MATCH_CLOSED', message: "BLOCKED. YOU WON'T MEET AGAIN." });
        } catch (e) { fail(e); }
      },
      chooseQuest: async (questId: number) => {
        const id = cur().match?.id;
        if (id === undefined) return;
        try {
          await api.selectQuest(id, questId);
          appLog.info('quest chosen');
          send({ type: 'QUEST_SELECTED', matchId: id, questId });
          bump();
        } catch (e) { fail(e); }
      },
      startChosenQuest: async () => {
        const q = cur().quest;
        if (!q) return;
        try {
          await api.startQuest(q.matchId);
          appLog.info('quest started');
          send({ type: 'QUEST_STARTED', ...q });
          bump();
        } catch (e) { fail(e); }
      },
      // From the Quests tab (works after an app restart, because the run lives on the server).
      startRun: async (run: QuestRun) => {
        try {
          await api.startQuest(run.matchId);
          appLog.info('quest started');
          send({ type: 'QUEST_STARTED', matchId: run.matchId, questId: run.quest.id });
          bump();
          return true;
        } catch (e) { fail(e); return false; }
      },
      // Swap a picked-but-not-started quest for the next one this match was offered.
      suggestAnother: async (run: QuestRun) => {
        try {
          const { quests } = await api.getMatch(run.matchId);
          const next = quests[(quests.findIndex(q => q.id === run.quest.id) + 1) % quests.length];
          if (!next || next.id === run.quest.id) return true; // only one quest was offered
          await api.selectQuest(run.matchId, next.id);
          send({ type: 'QUEST_SELECTED', matchId: run.matchId, questId: next.id });
          bump();
          return true;
        } catch (e) { fail(e); return false; }
      },
      completeRun: async (run: QuestRun) => {
        try {
          await api.completeQuest(run.matchId); // safe to repeat: the server pays out once
          appLog.info('quest completed');
          send({ type: 'QUEST_COMPLETED', matchId: run.matchId });
          bump();
          await refreshProfile(); // new points total
          return true;
        } catch (e) { fail(e); return false; }
      },
      // DEMO MODE ONLY (the control is only rendered when DEMO_MODE is on; the server also refuses when it is off).
      simulateNearby: async () => {
        try {
          const { matchId: id } = await api.simulateNearby();
          seen.current.add(id);
          appLog.info('simulated nearby player (demo)');
          send({ type: 'MATCH_DETECTED', match: await api.getMatch(id) });
        } catch (e) { fail(e); }
      },
    };
  }, [refreshProfile]);

  // Wave / Not now pressed on the wearable itself. The actions already refuse when no candidate is open,
  // so a stray press can't answer a match that isn't there.
  useEffect(() => onWearableMessage(m => {
    if (m.kind === 'wave') void actions.wave();
    else if (m.kind === 'pass') void actions.notNow();
  }), [actions]);

  const value = useMemo<Discovery>(() => ({ model, questsVersion, ...actions }), [model, questsVersion, actions]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
