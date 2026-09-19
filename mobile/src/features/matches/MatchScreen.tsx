import { useEffect, useRef } from 'react';
import { Alert, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Bar, Btn, C, Panel, Row, Screen, Txt, useBlink } from '../../components/pixel-ui';
import { archetypeById } from '../../constants/archetypes';
import type { MatchView } from '../../types/api';
import { useDiscovery } from '../discovery/DiscoveryProvider';
import { QuestCard, QuestFacts } from '../quests/QuestCard';

const icon = (id: string) => archetypeById(id);

// The Match flow, one stage per lifecycle state (see state/discoveryMachine.ts). The provider opens and
// closes this screen as the state changes; this component only renders the current stage.
export default function MatchScreen() {
  const d = useDiscovery();
  const { model } = d;
  const navigation = useNavigation();
  const blink = useBlink(400);
  const m = model.match;
  const { state } = model;

  // Leaving this screen while a wave is still pending (e.g. Android back) withdraws it, so nobody is
  // left waiting on, or revealed to, someone who walked away. Normal exits happen after the state changed.
  const latest = useRef(d);
  latest.current = d;
  useEffect(() => () => {
    if (latest.current.model.state === 'waiting_for_wave') void latest.current.cancelWave();
  }, []);

  const confirmBlock = () =>
    Alert.alert('Block & report?', "You won't be matched with this person again.", [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Block', style: 'destructive', onPress: () => void d.reportAndBlock() },
    ]);

  // Only reachable if the screen outlives its state (e.g. reopened by hand): nothing to show, so say so.
  if (!m) {
    return (
      <Screen title="MATCH">
        <Txt color={C.dim}>THIS MATCH HAS ENDED.</Txt>
        <Btn label="BACK" onPress={() => navigation.goBack()} />
      </Screen>
    );
  }

  const title = { candidate_detected: blink ? '! PLAYER NEARBY !' : ' ', waiting_for_wave: 'WAVE SENT', matched: 'PARTY FORMED', quest_selected: 'QUEST READY' }[state as string] ?? 'MATCH';

  return (
    <Screen title={title}>
      {(state === 'candidate_detected' || state === 'waiting_for_wave') && <Compatibility m={m} />}

      {state === 'candidate_detected' && (
        <>
          <Btn label="👋 WAVE" color={C.green} hint="Say hi. They only see who you are if they wave back too." onPress={() => void d.wave()} />
          <Btn label="NOT NOW" color={C.dim} onPress={() => void d.notNow()} />
        </>
      )}

      {state === 'waiting_for_wave' && (
        <>
          <Panel color={C.bg}>
            <Txt color={C.cyan} accessibilityLiveRegion="polite">WAVE SENT{blink ? '...' : ''}</Txt>
            <Txt size={8} color={C.dim}>Waiting for them to wave back. They can't see who you are until they do.</Txt>
          </Panel>
          <Btn label="CANCEL WAVE" color={C.dim} hint="Withdraw your wave" onPress={() => void d.cancelWave()} />
        </>
      )}

      {(state === 'matched' || state === 'quest_selected') && <Party m={m} />}

      {state === 'matched' && (
        <>
          <Txt color={C.gold}>CHOOSE A SIDEQUEST</Txt>
          {m.quests.slice(0, 3).map(q => <QuestCard key={q.id} quest={q} onPress={() => void d.chooseQuest(q.id)} />)}
          <Btn label="DONE" color={C.dim} small onPress={d.leaveMatch} />
        </>
      )}

      {state === 'quest_selected' && <Chosen m={m} />}

      <Btn label="BLOCK / REPORT" color={C.pink} small onPress={confirmBlock} />
    </Screen>
  );
}

function Compatibility({ m }: { m: MatchView }) {
  return (
    <Panel>
      <Txt size={8} color={C.dim}>COMPATIBILITY</Txt>
      <Txt size={24} color={C.green} style={{ lineHeight: 36 }}>{m.score}%</Txt>
      <Bar pct={m.score} />
      <Txt>{m.reason}</Txt>
      {m.shared.length > 0 && (
        <Row>{m.shared.map(s => <Txt key={s} size={8} color={C.gold}>{icon(s)?.icon} {icon(s)?.name ?? s}</Txt>)}</Row>
      )}
    </Panel>
  );
}

// Only ever rendered once the server has revealed the other person (both waved).
function Party({ m }: { m: MatchView }) {
  if (!m.other) return null;
  return (
    <Panel color={C.bg}>
      <Txt size={8} color={C.dim}>PARTY MEMBER JOINED</Txt>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Txt size={32} style={{ lineHeight: 44 }}>{m.other.avatar}</Txt>
        <View style={{ gap: 4, flex: 1 }}>
          <Txt size={12}>{m.other.nickname}</Txt>
          <Txt size={8} color={C.dim}>{m.other.archetypes.map(a => icon(a)?.name ?? a).join(' · ')}</Txt>
        </View>
      </View>
    </Panel>
  );
}

function Chosen({ m }: { m: MatchView }) {
  const d = useDiscovery();
  const quest = m.quests.find(q => q.id === d.model.quest?.questId);
  if (!quest) return null;
  const next = m.quests[(m.quests.findIndex(q => q.id === quest.id) + 1) % m.quests.length];
  return (
    <>
      <Txt color={C.gold}>▶ {quest.title.toUpperCase()}</Txt>
      <QuestFacts quest={quest} />
      <Btn label="START QUEST" color={C.green} onPress={() => void d.startChosenQuest()} />
      {next && next.id !== quest.id && <Btn label="SUGGEST ANOTHER" color={C.dim} small onPress={() => void d.chooseQuest(next.id)} />}
      <Btn label="DONE" color={C.dim} small onPress={d.leaveMatch} />
    </>
  );
}
