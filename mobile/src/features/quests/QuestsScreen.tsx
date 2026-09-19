import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Btn, C, Panel, Screen, Txt, useBlink } from '../../components/pixel-ui';
import type { RootParams } from '../../app/navigation/types';
import type { QuestRun } from '../../types/api';
import { useDiscovery } from '../discovery/DiscoveryProvider';
import { QuestCard } from './QuestCard';
import { useQuests } from './useQuests';

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString() : '');

export default function QuestsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootParams>>();
  const d = useDiscovery();
  const { data, error, loading, reload } = useQuests();
  const blink = useBlink();
  const open = (quest: QuestRun['quest'], run?: QuestRun) =>
    navigation.navigate('QuestDetail', { quest, run, alternatives: run ? undefined : data?.suggested });

  if (!data) {
    return (
      <Screen title="QUESTS">
        {error ? (
          <>
            <Txt color={C.pink}>CAN'T LOAD QUESTS</Txt>
            <Txt size={8} color={C.dim}>{error}</Txt>
            <Btn label="RETRY" onPress={() => void reload()} />
          </>
        ) : <Txt color={C.dim}>{loading ? 'LOADING...' : ''}</Txt>}
      </Screen>
    );
  }
  const { active, suggested, history } = data;

  return (
    <Screen title="QUESTS">
      <Txt size={8} color={C.dim}>ACTIVE QUEST</Txt>
      {active ? (
        <>
          <Panel color={C.bg}>
            <Txt color={active.status === 'active' ? C.green : C.gold}>
              {active.status === 'active' ? `IN PROGRESS${blink ? ' ■' : ''}` : 'PICKED · NOT STARTED'}
            </Txt>
            <Txt>▶ {active.quest.title}</Txt>
            <Txt size={8} color={C.dim}>{active.quest.location} · {active.quest.minutes} MIN</Txt>
            {active.partner && <Txt size={8} color={C.dim}>WITH {active.partner.avatar} {active.partner.nickname}</Txt>}
          </Panel>
          {active.status === 'selected'
            ? <Btn label="START QUEST" color={C.green} onPress={() => void d.startRun(active)} />
            : <Btn label="COMPLETE QUEST" color={C.gold} onPress={() => open(active.quest, active)} />}
          <Btn small color={C.dim} label="DETAILS" onPress={() => open(active.quest, active)} />
        </>
      ) : (
        <Panel><Txt color={C.dim}>NO ACTIVE QUEST. WAVE AT A PLAYER NEARBY TO GET ONE.</Txt></Panel>
      )}

      <Txt size={8} color={C.dim}>SUGGESTED NEARBY</Txt>
      {suggested.length ? suggested.map(q => <QuestCard key={q.id} quest={q} onPress={() => open(q)} />)
        : <Panel><Txt color={C.dim}>NOTHING NEW NEARBY RIGHT NOW.</Txt></Panel>}

      <Txt size={8} color={C.dim}>COMPLETED</Txt>
      {history.length ? history.map(r => (
        <QuestCard key={r.matchId} quest={r.quest} badge={`✓ DONE ${when(r.completedAt)}${r.partner ? ` · ${r.partner.avatar} ${r.partner.nickname}` : ''}`}
          onPress={() => open(r.quest, r)} />
      )) : <Panel><Txt color={C.dim}>NO COMPLETED QUESTS YET.</Txt></Panel>}
    </Screen>
  );
}
