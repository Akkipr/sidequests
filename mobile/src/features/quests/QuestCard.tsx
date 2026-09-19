import { Pressable } from 'react-native';
import { C, Panel, Txt } from '../../components/pixel-ui';
import type { Quest } from '../../types/api';

export const QuestCard = ({ quest, badge, onPress }: { quest: Quest; badge?: string; onPress?: () => void }) => (
  <Pressable onPress={onPress} disabled={!onPress} accessibilityRole="button"
    accessibilityLabel={`${quest.title}. ${quest.location}, ${quest.minutes} minutes, ${quest.cost}`}>
    <Panel>
      {badge && <Txt size={8} color={C.gold}>{badge}</Txt>}
      <Txt>▶ {quest.title}</Txt>
      <Txt size={8} color={C.dim}>{quest.location} · {quest.minutes} MIN · {quest.cost}</Txt>
    </Panel>
  </Pressable>
);

// Title, description and the facts people need to actually go do it.
export const QuestFacts = ({ quest }: { quest: Quest }) => {
  const facts = [['WHERE', quest.location], ['WHEN', quest.starts], ['COST', quest.cost], ['TIME', `${quest.minutes} MIN`]];
  return (
    <>
      <Panel><Txt>{quest.description}</Txt></Panel>
      <Panel>
        {facts.map(([k, v]) => <Txt key={k}><Txt color={C.dim}>{k}: </Txt>{v}</Txt>)}
      </Panel>
    </>
  );
};
