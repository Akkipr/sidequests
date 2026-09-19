import { useState } from 'react';
import { View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Btn, C, Chip, Panel, Row, Screen, Txt, useBlink, useTicker } from '../../components/pixel-ui';
import { INTENTS } from '../../constants/archetypes';
import { DEMO_MODE } from '../../config';
import type { RootParams } from '../../app/navigation/types';
import type { WearableStatus } from '../../state/discoveryMachine';
import type { Intent } from '../../types/api';
import { QuestCard } from '../quests/QuestCard';
import { useQuests } from '../quests/useQuests';
import { useDiscovery } from './DiscoveryProvider';

const LINK: Record<WearableStatus['kind'], [string, string]> = {
  none: ['■ NO SIGNAL', C.dim],
  connecting: ['■ CONNECTING...', C.cyan],
  linked: ['■ LINKED', C.green],
  failed: ['▲ FAILED', C.pink],
};
const RADAR = ['■---', '-■--', '--■-', '---■'];

const PARTY_TEXT: Record<string, string> = {
  candidate_detected: '! PLAYER NEARBY !',
  waiting_for_wave: 'WAVE SENT. WAITING...',
  matched: 'PARTY FORMED',
  quest_selected: 'QUEST READY TO START',
};

export default function DiscoverScreen() {
  const d = useDiscovery();
  const { model } = d;
  const navigation = useNavigation<NativeStackNavigationProp<RootParams>>();
  const { data } = useQuests();
  const blink = useBlink();
  const radar = useTicker(RADAR.length, 350);
  const [pick, setPick] = useState<Intent>(model.intent);

  const { state, wearable } = model;
  const active = state === 'connecting' || state === 'scanning';
  const inParty = state === 'candidate_detected' || state === 'waiting_for_wave' || state === 'matched' || state === 'quest_selected';
  const intent = state === 'private' ? pick : model.intent;
  const [linkLabel, linkColor] = LINK[wearable.kind];
  const preview = data?.suggested[0];

  return (
    <Screen title="DISCOVER">
      {inParty ? (
        <>
          <Panel color={C.bg}>
            <Txt color={C.green} accessibilityLiveRegion="polite">{PARTY_TEXT[state]}{blink ? '_' : ' '}</Txt>
          </Panel>
          <Btn big color={C.green} label="OPEN MATCH" onPress={() => navigation.navigate('Match')} />
        </>
      ) : state === 'quest_active' ? (
        <>
          <Panel color={C.bg}><Txt color={C.green}>QUEST ACTIVE ■</Txt></Panel>
          <Btn big color={C.green} label="VIEW QUEST" onPress={() => navigation.navigate('Main', { screen: 'Quests' })} />
        </>
      ) : active ? (
        <Btn big color={C.pink} label="GO PRIVATE" hint="Stop being discoverable" onPress={d.goPrivate} />
      ) : (
        <Btn big color={C.green} label="START DISCOVERING" hint="Become discoverable to compatible players nearby"
          onPress={() => d.start(intent)} />
      )}

      {model.message && (
        <Panel color={C.bg}><Txt size={8} color={C.gold} accessibilityLiveRegion="polite">{model.message}</Txt></Panel>
      )}

      <Panel color={state === 'scanning' ? C.bg : C.panel}>
        {state === 'scanning' ? (
          <>
            <Txt color={C.green} style={{ textAlign: 'center' }} accessibilityLiveRegion="polite">
              SCANNING FOR PARTY{blink ? '_' : ' '}
            </Txt>
            <Txt color={C.cyan} style={{ textAlign: 'center' }} accessibilityElementsHidden>{RADAR[radar]}</Txt>
            <Txt size={8} color={C.dim} style={{ textAlign: 'center' }}>
              {wearable.kind === 'linked' ? "Keep the app open. We'll ping you when a match is near." : 'Demo mode: no wearable linked.'}
            </Txt>
          </>
        ) : state === 'connecting' ? (
          <Txt color={C.cyan} style={{ textAlign: 'center' }}>LINKING WEARABLE{blink ? '...' : ''}</Txt>
        ) : state === 'private' ? (
          <>
            <Txt color={C.dim} style={{ textAlign: 'center' }}>YOU ARE INVISIBLE</Txt>
            <Txt size={8} color={C.dim} style={{ textAlign: 'center' }}>Your wearable never broadcasts who you are.</Txt>
          </>
        ) : null}
      </Panel>

      {(state === 'private' || active) && (
        <Panel>
          <Txt size={8} color={C.dim}>I'M...</Txt>
          <Row>
            {INTENTS.map(i => (
              <Chip key={i.id} radio label={i.label} on={intent === i.id}
                onPress={() => (state === 'private' ? setPick(i.id) : d.changeIntent(i.id))} />
            ))}
          </Row>
        </Panel>
      )}

      <Panel>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <Txt size={8} color={C.dim}>WEARABLE</Txt>
          <Txt size={9} color={linkColor} accessibilityLabel={`Wearable ${linkLabel.slice(2).toLowerCase()}`}>{linkLabel}</Txt>
        </View>
        {wearable.message && wearable.kind !== 'linked' && <Txt size={8} color={C.pink}>{wearable.message}</Txt>}
        {(wearable.kind === 'none' || wearable.kind === 'failed') && (
          <Btn small color={C.cyan} label={wearable.kind === 'failed' ? 'RETRY' : 'CONNECT WEARABLE'} onPress={() => void d.connectWearable()} />
        )}
      </Panel>

      {DEMO_MODE && state === 'scanning' && (
        <Btn small color={C.dim} label="SIMULATE NEARBY PLAYER" onPress={() => void d.simulateNearby()} />
      )}

      {preview && (
        <>
          <Txt size={8} color={C.dim}>NEARBY SIDEQUEST</Txt>
          <QuestCard quest={preview} onPress={() => navigation.navigate('QuestDetail', { quest: preview, alternatives: data?.suggested })} />
        </>
      )}
    </Screen>
  );
}
