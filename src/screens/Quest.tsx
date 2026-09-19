import { useState } from 'react';
import { Quest as Q } from '../api';
import { Btn, C, Panel, Screen, Txt, useBlink } from '../ui';

export default function Quest({ quest, onBack }: { quest: Q; onBack: () => void }) {
  const [started, setStarted] = useState(false);
  const blink = useBlink();
  const stats = [['WHERE', quest.location], ['WHEN', quest.starts], ['COST', quest.cost], ['TIME', `${quest.minutes} MIN`]];

  return (
    <Screen title={quest.title.toUpperCase()}>
      <Panel><Txt>{quest.description}</Txt></Panel>
      <Panel>
        {stats.map(([k, v]) => (
          <Txt key={k}><Txt color={C.dim}>{k}: </Txt>{v}</Txt>
        ))}
      </Panel>
      {started ? (
        <Panel color={C.bg}>
          <Txt color={C.green}>QUEST ACTIVE{blink ? ' ■' : ''}</Txt>
          <Txt size={8} color={C.dim}>Meet at {quest.location}. Photo check-in unlocks points.</Txt>
        </Panel>
      ) : (
        <Btn label="START QUEST" color={C.green} onPress={() => setStarted(true)} />
      )}
      <Btn label="◀ SUGGEST ANOTHER" color={C.dim} small onPress={onBack} />
    </Screen>
  );
}
