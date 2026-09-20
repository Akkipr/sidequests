import { useState } from 'react';
import { Image, Pressable, View } from 'react-native';
import { Btn, C, FONT, Panel, Txt } from '../../components/pixel-ui';
import { openWebLink } from '../../services/links';
import type { Quest } from '../../types/api';

// Where an outside event came from, shown so it is never mistaken for one of our own quests.
const SOURCE_LABEL: Record<string, string> = { wat2do: 'WAT2DO' };
const sourceLabel = (q: Quest) => (q.source ? SOURCE_LABEL[q.source] ?? q.source.toUpperCase() : null);

export const QuestCard = ({ quest, badge, onPress }: { quest: Quest; badge?: string; onPress?: () => void }) => {
  const label = sourceLabel(quest);
  const top = badge ?? (label ? `${label} · ${quest.starts}` : undefined);
  return (
    <Pressable onPress={onPress} disabled={!onPress} accessibilityRole="button"
      accessibilityLabel={`${quest.title}. ${quest.starts}. ${quest.location}, ${quest.minutes} minutes, ${quest.cost}`}>
      <Panel>
        {top && <Txt size={8} color={C.gold}>{top}</Txt>}
        <Txt>▶ {quest.title}</Txt>
        <Txt size={8} color={C.dim}>{quest.location} · {quest.minutes} MIN · {quest.cost}</Txt>
      </Panel>
    </Pressable>
  );
};

// The event's picture, in a pixel frame. If it's missing or fails to load, a ticket placeholder keeps the layout.
function EventImage({ uri, title }: { uri?: string | null; title: string }) {
  const [failed, setFailed] = useState(false);
  const frame = { borderWidth: 3, borderColor: C.ink, height: 150, backgroundColor: C.panel, overflow: 'hidden' as const };
  return (
    <View style={{ marginRight: 4, marginBottom: 4 }}>
      <View style={{ position: 'absolute', top: 4, left: 4, right: -4, bottom: -4, backgroundColor: C.shadow }} />
      {uri && !failed ? (
        <Image source={{ uri }} style={frame} resizeMode="cover" onError={() => setFailed(true)}
          accessible accessibilityRole="image" accessibilityLabel={`Picture for ${title}`} />
      ) : (
        <View style={[frame, { alignItems: 'center', justifyContent: 'center' }]} accessible accessibilityLabel="No picture available">
          <Txt size={32} style={{ lineHeight: 44 }}>🎟️</Txt>
        </View>
      )}
    </View>
  );
}

// Title, description and the facts people need to actually go do it. Outside events add their picture, host,
// a link to the event page, and clear attribution.
export const QuestFacts = ({ quest }: { quest: Quest }) => {
  const label = sourceLabel(quest);
  const facts: [string, string][] = [['WHERE', quest.location], ['WHEN', quest.starts], ['COST', quest.cost], ['TIME', `${quest.minutes} MIN`]];
  if (quest.organizer) facts.push(['HOST', quest.organizer]);
  if (quest.registrationRequired) facts.push(['SIGN-UP', 'REGISTRATION REQUIRED']);
  return (
    <>
      {label && <EventImage uri={quest.imageUrl} title={quest.title} />}
      <Panel><Txt>{quest.description}</Txt></Panel>
      <Panel>
        {facts.map(([k, v]) => <Txt key={k}><Txt color={C.dim}>{k}: </Txt>{v}</Txt>)}
      </Panel>
      {label && (
        <>
          <Txt size={8} color={C.dim} style={{ fontFamily: FONT }}>Event from {label}.</Txt>
          {quest.sourceUrl && <Btn small color={C.cyan} label="VIEW EVENT DETAILS" hint={`Opens the ${label} page in your browser`} onPress={() => void openWebLink(quest.sourceUrl!)} />}
        </>
      )}
    </>
  );
};
