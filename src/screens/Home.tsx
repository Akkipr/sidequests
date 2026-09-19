import { View } from 'react-native';
import { Profile, Status } from '../api';
import { ARCHETYPES, STATUSES } from '../archetypes';
import { Btn, C, Chip, Panel, Row, Screen, Txt, useBlink } from '../ui';

export type Wearable = { state: 'idle' | 'connecting' | 'connected' | 'error'; msg?: string };

const LINK = {
  idle: ['NO SIGNAL', C.dim],
  connecting: ['SEARCHING...', C.cyan],
  connected: ['LINKED', C.green],
  error: ['LINK FAILED', C.pink],
} as const;

export default function Home({ profile, status, onStatus, wearable, onConnect }: {
  profile: Profile; status: Status; onStatus: (s: Status) => void; wearable: Wearable; onConnect: () => void;
}) {
  const blink = useBlink();
  const [label, color] = LINK[wearable.state];
  const live = status !== 'off' && wearable.state === 'connected';

  return (
    <Screen title="SIDEQUESTS">
      <Panel>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Txt size={32} style={{ lineHeight: 44 }}>{profile.avatar}</Txt>
          <View style={{ flex: 1, gap: 4 }}>
            <Txt size={12}>{profile.nickname}</Txt>
            <Txt size={8} color={C.dim}>
              {profile.archetypes.map(id => ARCHETYPES.find(a => a.id === id)?.icon).join(' ')}
            </Txt>
          </View>
          <Txt color={C.gold}>★{profile.points}</Txt>
        </View>
      </Panel>

      <Panel>
        <Txt size={8} color={C.dim}>WEARABLE</Txt>
        <Txt color={color}>■ {label}</Txt>
        {wearable.msg && <Txt size={8} color={C.pink}>{wearable.msg}</Txt>}
        {(wearable.state === 'idle' || wearable.state === 'error') && <Btn small label="CONNECT" color={C.cyan} onPress={onConnect} />}
      </Panel>

      <Panel>
        <Txt size={8} color={C.dim}>DISCOVERY</Txt>
        <Row>
          {STATUSES.filter(s => s.id !== 'off').map(s => (
            <Chip key={s.id} label={s.label} on={status === s.id} onPress={() => onStatus(s.id)} />
          ))}
        </Row>
        {status !== 'off' && <Btn label="GO PRIVATE" color={C.pink} onPress={() => onStatus('off')} />}
      </Panel>

      <Panel color={live ? C.bg : C.panel}>
        <Txt color={live ? C.green : C.dim} style={{ textAlign: 'center' }}>
          {live ? `SCANNING FOR PARTY${blink ? '_' : ' '}` : status === 'off' ? 'YOU ARE INVISIBLE' : 'LINK WEARABLE TO SCAN'}
        </Txt>
        <Txt size={8} color={C.dim} style={{ textAlign: 'center' }}>
          {live ? 'Keep the app open. We\'ll ping you when a match is near.' : 'Your wearable never broadcasts who you are.'}
        </Txt>
      </Panel>
    </Screen>
  );
}
