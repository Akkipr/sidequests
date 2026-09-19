import { Alert } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Btn, C, Panel, Screen, Txt, useBlink } from '../../components/pixel-ui';
import type { RootParams } from '../../app/navigation/types';
import { useDiscovery } from '../discovery/DiscoveryProvider';
import { QuestFacts } from './QuestCard';

export default function QuestDetailScreen({ navigation, route }: NativeStackScreenProps<RootParams, 'QuestDetail'>) {
  const { quest, run, alternatives } = route.params;
  const d = useDiscovery();
  const blink = useBlink();

  const complete = () =>
    Alert.alert('Complete this quest?', "Only mark it complete once you've actually done it together. You'll both earn points.", [
      { text: 'Not yet', style: 'cancel' },
      { text: 'Complete', onPress: async () => { if (run && (await d.completeRun(run))) navigation.goBack(); } },
    ]);

  const nextIdea = alternatives?.[(alternatives.findIndex(q => q.id === quest.id) + 1) % (alternatives?.length || 1)];

  return (
    <Screen title={quest.title.toUpperCase()} onBack={() => navigation.goBack()}>
      <QuestFacts quest={quest} />

      {run?.status === 'active' && (
        <>
          <Panel color={C.bg}>
            <Txt color={C.green}>QUEST ACTIVE{blink ? ' ■' : ''}</Txt>
            <Txt size={8} color={C.dim}>Meet at {quest.location}{run.partner ? ` with ${run.partner.nickname}` : ''}.</Txt>
          </Panel>
          <Btn label="COMPLETE QUEST" color={C.gold} onPress={complete} />
        </>
      )}

      {run?.status === 'selected' && (
        <>
          <Btn label="START QUEST" color={C.green} onPress={async () => { if (await d.startRun(run)) navigation.goBack(); }} />
          <Btn label="◀ SUGGEST ANOTHER" color={C.dim} small onPress={async () => { if (await d.suggestAnother(run)) navigation.goBack(); }} />
        </>
      )}

      {run?.status === 'completed' && (
        <Panel color={C.bg}><Txt color={C.green}>✓ QUEST COMPLETE</Txt></Panel>
      )}

      {!run && (
        <>
          <Panel color={C.bg}>
            <Txt size={8} color={C.dim}>Quests start from a match: wave at a compatible player nearby and pick this together.</Txt>
          </Panel>
          {nextIdea && nextIdea.id !== quest.id && (
            <Btn label="◀ SUGGEST ANOTHER" color={C.dim} small
              onPress={() => navigation.replace('QuestDetail', { quest: nextIdea, alternatives })} />
          )}
        </>
      )}
    </Screen>
  );
}
