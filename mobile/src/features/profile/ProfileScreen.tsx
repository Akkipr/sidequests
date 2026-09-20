import { useEffect, useState } from 'react';
import { Alert, View } from 'react-native';
import { AvatarPicker, ArchetypePicker, Prefs, Quiz, quizComplete, toProfileInput } from '../../components/pixel-ui/fields';
import { Btn, C, Panel, Screen, Txt } from '../../components/pixel-ui';
import { archetypeById } from '../../constants/archetypes';
import { DEMO_MODE } from '../../config';
import { errorMessage } from '../../services/api';
import { monitoringEnabled, sendTestError } from '../../services/monitoring';
import type { ProfileInput } from '../../types/api';
import { useProfile, useSession } from '../auth/SessionProvider';
import { useDiscovery } from '../discovery/DiscoveryProvider';
import { useBlocks } from './useBlocks';

const WEARABLE_TEXT = { none: 'NO SIGNAL', connecting: 'CONNECTING...', linked: 'LINKED', failed: 'FAILED' } as const;
const confirm = (title: string, body: string, action: string, onYes: () => void, destructive = false) =>
  Alert.alert(title, body, [{ text: 'Cancel', style: 'cancel' }, { text: action, style: destructive ? 'destructive' : 'default', onPress: onYes }]);

export default function ProfileScreen() {
  const profile = useProfile();
  const { saveProfile, signOut } = useSession();
  const d = useDiscovery();
  const { blocks, remove } = useBlocks();

  const original: ProfileInput = {
    avatar: profile.avatar, archetypes: profile.archetypes, answers: profile.answers, wants: profile.wants, budget: profile.budget,
  };
  const [form, setForm] = useState<ProfileInput>(original);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const set = (patch: Partial<ProfileInput>) => { setSaved(false); setForm(f => ({ ...f, ...patch })); };

  // Follow the server copy after a save (or a refresh) so "unsaved changes" is always accurate.
  useEffect(() => { setForm(original); }, [profile]);
  const clean = toProfileInput(form);
  const dirty = JSON.stringify(clean) !== JSON.stringify(toProfileInput(original));
  const valid = form.archetypes.length > 0 && quizComplete(form.archetypes, form.answers);

  async function save() {
    setSaving(true);
    try {
      await saveProfile(clean);
      setSaved(true);
    } catch (e) {
      Alert.alert('Save failed', errorMessage(e));
    }
    setSaving(false);
  }

  const w = d.model.wearable;

  return (
    <Screen title="PROFILE">
      <Panel>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Txt size={32} style={{ lineHeight: 44 }}>{form.avatar}</Txt>
          <View style={{ flex: 1, gap: 4 }}>
            <Txt size={12}>{profile.nickname}</Txt>
            <Txt size={8} color={C.dim}>
              {form.archetypes.map(id => archetypeById(id)?.icon).join(' ')}
            </Txt>
            <Txt size={7} color={C.dim}>Your name is your login, so it can't be changed.</Txt>
          </View>
          <Txt color={C.gold} accessibilityLabel={`${profile.points} points`}>★{profile.points}</Txt>
        </View>
      </Panel>

      <AvatarPicker value={form.avatar} onChange={avatar => set({ avatar })} />
      <Txt color={C.gold}>YOUR CLASS</Txt>
      <ArchetypePicker value={form.archetypes} onChange={archetypes => set({ archetypes })} />
      <Txt color={C.gold}>QUIZ ANSWERS</Txt>
      <Quiz archetypes={form.archetypes} answers={form.answers} onChange={answers => set({ answers })} />
      <Txt color={C.gold}>PARTY PREFS</Txt>
      <Prefs wants={form.wants} budget={form.budget} onWants={wants => set({ wants })} onBudget={budget => set({ budget })} />

      <Btn label={saving ? 'SAVING...' : saved && !dirty ? '✓ SAVED' : 'SAVE CHANGES'} color={C.green}
        disabled={!dirty || !valid || saving} onPress={() => void save()} />
      {dirty && !valid && <Txt size={8} color={C.pink}>ANSWER EVERY QUIZ QUESTION FOR YOUR CLASSES TO SAVE.</Txt>}

      <Txt color={C.gold}>WEARABLE</Txt>
      <Panel>
        <Txt color={w.kind === 'linked' ? C.green : w.kind === 'failed' ? C.pink : C.dim}>
          {w.kind === 'failed' ? '▲' : '■'} {WEARABLE_TEXT[w.kind]}
        </Txt>
        {w.message && w.kind !== 'linked' && <Txt size={8} color={C.pink}>{w.message}</Txt>}
        {w.kind !== 'linked' && w.kind !== 'connecting' && (
          <Btn small color={C.cyan} label="CONNECT WEARABLE" onPress={() => void d.connectWearable()} />
        )}
        <Btn small color={C.dim} label="RE-PAIR WEARABLE" hint="Forget this wearable and pair again"
          disabled={w.kind === 'connecting'}
          onPress={() => confirm('Re-pair wearable?', 'This forgets your current wearable and searches for the strongest one nearby. Hold the one you want close.', 'Re-pair', () => void d.repairWearable())} />
      </Panel>

      <Txt color={C.gold}>PRIVACY</Txt>
      <Panel>
        <Txt size={8} color={C.dim}>
          You start every session invisible. While you're discoverable, your wearable only tells the app that a wearable is close.
          {'\n\n'}
          Nobody sees your name or avatar unless you both wave. Blocking someone means you'll never be matched again.
        </Txt>
      </Panel>

      <Txt color={C.gold}>BLOCKED PLAYERS</Txt>
      {blocks === null ? <Txt size={8} color={C.dim}>LOADING...</Txt>
        : blocks.length === 0 ? <Panel><Txt size={8} color={C.dim}>NO ONE BLOCKED.</Txt></Panel>
        : blocks.map((b, i) => (
          <Panel key={b.id}>
            <Txt size={9}>BLOCKED PLAYER #{blocks.length - i}</Txt>
            <Txt size={8} color={C.dim}>{new Date(b.created_at).toLocaleDateString()}</Txt>
            <Btn small color={C.dim} label="UNBLOCK"
              onPress={() => confirm('Unblock?', 'You could be matched with this person again.', 'Unblock', () => void remove(b.id).catch(e => Alert.alert('Error', errorMessage(e))))} />
          </Panel>
        ))}

      {DEMO_MODE && monitoringEnabled && (
        <Btn small color={C.dim} label="SEND TEST ERROR TO SENTRY"
          onPress={() => void sendTestError().then(() => Alert.alert('Sent', 'A test error was sent to Sentry. Check the sydequestshtn project.'))} />
      )}

      <Btn small color={C.pink} label="SIGN OUT"
        onPress={() => confirm('SIGN OUT?', "You'll need your name and password to come back.", 'Sign out', () => void signOut(), true)} />
    </Screen>
  );
}
