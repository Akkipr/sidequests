import { useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useFonts, PressStart2P_400Regular } from '@expo-google-fonts/press-start-2p';
import { api, Profile, Quest as Q, Status } from './src/api';
import { connectWearable } from './src/ble';
import { Btn, C, Screen, Txt } from './src/ui';
import Onboarding from './src/screens/Onboarding';
import Home, { Wearable } from './src/screens/Home';
import Match from './src/screens/Match';
import Quest from './src/screens/Quest';

type Route = { name: 'home' } | { name: 'match'; id: number } | { name: 'quest'; matchId: number; quest: Q };

export default function App() {
  const [fonts] = useFonts({ PressStart2P_400Regular });
  const [profile, setProfile] = useState<Profile | null | undefined>(undefined); // undefined = loading
  const [bootErr, setBootErr] = useState('');
  const [route, setRoute] = useState<Route>({ name: 'home' });
  const [status, setStatus] = useState<Status>('off');
  const [wearable, setWearable] = useState<Wearable>({ state: 'idle' });

  // BLE callbacks outlive renders, so they read current state through refs.
  const live = useRef({ route, status });
  live.current = { route, status };
  const seen = useRef(new Set<number>());
  const busy = useRef(false);
  const near = useRef(false);

  const boot = () => {
    setBootErr('');
    api<Profile | null>('/profile').then(p => {
      // Discovery is off by default every launch.
      if (p && p.status !== 'off') api('/status', { status: 'off' }).catch(() => {});
      setProfile(p);
    }, e => setBootErr(e.message));
  };
  useEffect(boot, []);

  // The wearable notifies MATCH once per encounter and IDLE when out of range. The other phone may
  // report a few seconds later, so keep asking the server (~20s) while still in range.
  async function onSignal(sig: 'MATCH' | 'IDLE') {
    near.current = sig === 'MATCH';
    if (!near.current || busy.current) return;
    busy.current = true;
    try {
      for (let i = 0; i < 7 && near.current; i++) {
        if (live.current.status !== 'off') {
          const { matchId } = await api<{ matchId: number | null }>('/signal', {})
            .catch(e => (console.warn('signal failed', e), { matchId: null }));
          if (matchId) {
            if (!seen.current.has(matchId) && live.current.route.name === 'home') {
              seen.current.add(matchId);
              setRoute({ name: 'match', id: matchId });
            }
            break;
          }
        }
        await new Promise(r => setTimeout(r, 3000));
      }
    } finally {
      busy.current = false;
    }
  }

  async function connect() {
    setWearable({ state: 'connecting' });
    try {
      await connectWearable(onSignal, () => {
        near.current = false;
        setWearable({ state: 'idle', msg: 'Wearable disconnected' });
      });
      setWearable({ state: 'connected' });
    } catch (e: any) {
      setWearable({ state: 'error', msg: e.message });
    }
  }
  useEffect(() => { if (profile) connect(); }, [!!profile]);

  function changeStatus(s: Status) {
    setStatus(s);
    api('/status', { status: s }).catch(e => Alert.alert('Status not saved', e.message));
  }

  if (!fonts) return null;
  const home = () => setRoute({ name: 'home' });

  return (
    <>
      <StatusBar style="light" />
      {bootErr ? (
        <Screen title="GAME OVER">
          <Txt color={C.pink}>CAN'T REACH SERVER</Txt>
          <Txt size={8} color={C.dim}>{bootErr}</Txt>
          <Txt size={8} color={C.dim}>Check EXPO_PUBLIC_API_URL in mobile/.env is your current tunnel URL and the server is running.</Txt>
          <Btn label="CONTINUE?" onPress={boot} />
        </Screen>
      ) : profile === undefined ? (
        <Screen title="LOADING..."><Txt color={C.dim}>PRESS START</Txt></Screen>
      ) : profile === null ? (
        <Onboarding onDone={setProfile} />
      ) : route.name === 'match' ? (
        <Match id={route.id} onExit={home} onQuest={quest => setRoute({ name: 'quest', matchId: route.id, quest })} />
      ) : route.name === 'quest' ? (
        <Quest quest={route.quest} onBack={() => setRoute({ name: 'match', id: route.matchId })} />
      ) : (
        <Home profile={profile} status={status} onStatus={changeStatus} wearable={wearable} onConnect={connect} />
      )}
    </>
  );
}
