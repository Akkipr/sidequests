import { useEffect, useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import { api, Match as M, Quest } from '../api';
import { ARCHETYPES } from '../archetypes';
import { Bar, Btn, C, Panel, Row, Screen, Txt, useBlink } from '../ui';

const icon = (id: string) => ARCHETYPES.find(a => a.id === id);

export default function Match({ id, onQuest, onExit }: { id: number; onQuest: (q: Quest) => void; onExit: () => void }) {
  const [m, setM] = useState<M | null>(null);
  const [err, setErr] = useState('');
  const blink = useBlink(400);

  const load = () => api<M>(`/matches/${id}`).then(setM, e => setErr(e.message));
  useEffect(() => { load(); }, [id]);

  // ponytail: 3s polling while waiting on the other person; swap for push/websocket if it matters.
  useEffect(() => {
    if (m?.status !== 'pending') return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [m?.status]);

  const respond = async (wave: boolean) => {
    await api(`/matches/${id}/respond`, { wave }).catch(e => Alert.alert('Error', e.message));
    wave ? load() : onExit();
  };

  const block = () =>
    Alert.alert('Block & report?', "You won't be matched with this person again.", [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Block', style: 'destructive', onPress: () => api(`/matches/${id}/block`, { reason: 'user report' }).finally(onExit) },
    ]);

  if (!m) return (
    <Screen title="MATCH!">
      <Txt color={err ? C.pink : C.dim}>{err || 'LOADING...'}</Txt>
      {!!err && <Btn label="BACK" onPress={onExit} />}
    </Screen>
  );

  return (
    <Screen title={blink ? '! PLAYER NEARBY !' : ' '}>
      <Panel>
        <Txt size={8} color={C.dim}>COMPATIBILITY</Txt>
        <Txt size={24} color={C.green} style={{ lineHeight: 36 }}>{m.score}%</Txt>
        <Bar pct={m.score} />
        <Txt>{m.reason}</Txt>
        {m.shared.length > 0 && (
          <Row>{m.shared.map(s => <Txt key={s} size={8} color={C.gold}>{icon(s)?.icon} {icon(s)?.name ?? s}</Txt>)}</Row>
        )}
      </Panel>

      {m.status === 'pending' && m.myResponse === null && (
        <>
          <Btn label="👋 WAVE" color={C.green} onPress={() => respond(true)} />
          <Btn label="NOT NOW" color={C.dim} onPress={() => respond(false)} />
        </>
      )}

      {m.status === 'pending' && m.myResponse && (
        <Panel><Txt color={C.cyan}>WAITING FOR THEM TO WAVE BACK{blink ? '...' : ''}</Txt></Panel>
      )}

      {m.status === 'declined' && (
        <>
          <Panel><Txt color={C.dim}>NOT THIS TIME. MORE QUESTS AWAIT.</Txt></Panel>
          <Btn label="BACK HOME" onPress={onExit} />
        </>
      )}

      {m.status === 'revealed' && m.other && (
        <>
          <Panel color={C.bg}>
            <Txt size={8} color={C.dim}>PARTY MEMBER JOINED</Txt>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Txt size={32} style={{ lineHeight: 44 }}>{m.other.avatar}</Txt>
              <View style={{ gap: 4 }}>
                <Txt size={12}>{m.other.nickname}</Txt>
                <Txt size={8} color={C.dim}>{m.other.archetypes.map(a => icon(a)?.name ?? a).join(' · ')}</Txt>
              </View>
            </View>
          </Panel>
          <Txt color={C.gold}>CHOOSE A SIDEQUEST</Txt>
          {m.quests.map(q => (
            <Pressable key={q.id} onPress={() => onQuest(q)} accessibilityRole="button" accessibilityLabel={q.title}>
              <Panel>
                <Txt>▶ {q.title}</Txt>
                <Txt size={8} color={C.dim}>{q.location} · {q.minutes} MIN · {q.cost}</Txt>
              </Panel>
            </Pressable>
          ))}
          <Btn label="DONE" color={C.dim} small onPress={onExit} />
        </>
      )}

      {m.status !== 'declined' && <Btn label="BLOCK / REPORT" color={C.pink} small onPress={block} />}
    </Screen>
  );
}
