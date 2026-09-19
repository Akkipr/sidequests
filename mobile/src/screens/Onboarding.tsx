import { useState } from 'react';
import { Alert, Pressable } from 'react-native';
import { Profile, signup } from '../api';
import { ARCHETYPES, AVATARS } from '../archetypes';
import { Btn, C, Chip, Field, Panel, Row, Screen, Txt } from '../ui';
import SignIn from './SignIn';

const BUDGETS = [['free', 'Free only'], ['low', 'Cheap'], ['any', 'Whatever']] as const;
const MIN_PASSWORD = 8; // keep in sync with server/index.js
const toggle = (xs: string[], x: string) => (xs.includes(x) ? xs.filter(v => v !== x) : [...xs, x]);

export default function Onboarding({ onDone }: { onDone: (p: Profile) => void }) {
  const [step, setStep] = useState(0);
  const [signIn, setSignIn] = useState(false);
  const [nickname, setNickname] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [avatar, setAvatar] = useState(AVATARS[0]);
  const [archetypes, setArchetypes] = useState<string[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [wants, setWants] = useState<string[]>([]);
  const [budget, setBudget] = useState<Profile['budget']>('low');
  const [saving, setSaving] = useState(false);

  const chosen = ARCHETYPES.filter(a => archetypes.includes(a.id));
  const questions = chosen.flatMap((a): readonly { id: string; text: string; options: readonly string[] }[] => a.questions);

  async function save() {
    setSaving(true);
    try {
      // Drop answers for classes un-picked after answering, they'd skew scoring.
      const kept = Object.fromEntries(questions.map(q => [q.id, answers[q.id]]));
      onDone(await signup({ nickname: nickname.trim(), password, avatar, archetypes, answers: kept, wants, budget }));
    } catch (e: any) {
      if (e.status === 409) {
        Alert.alert('Name taken', 'Someone already has that name. Pick another.');
        setStep(0);
      } else {
        Alert.alert('Save failed', e.message);
      }
      setSaving(false);
    }
  }

  const steps = [
    {
      title: 'NEW PLAYER',
      ok: nickname.trim().length > 0 && password.length >= MIN_PASSWORD && password === confirm,
      body: (
        <>
          <Panel>
            <Txt>ENTER NAME:</Txt>
            <Field value={nickname} onChangeText={setNickname} maxLength={24} autoFocus />
          </Panel>
          <Panel>
            <Txt>PASSWORD:</Txt>
            <Field value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" autoCorrect={false} />
            {password.length > 0 && password.length < MIN_PASSWORD && (
              <Txt size={8} color={C.pink}>MIN {MIN_PASSWORD} CHARACTERS</Txt>
            )}
            <Txt>CONFIRM:</Txt>
            <Field value={confirm} onChangeText={setConfirm} secureTextEntry autoCapitalize="none" autoCorrect={false} />
            {confirm.length > 0 && confirm !== password && <Txt size={8} color={C.pink}>PASSWORDS DON'T MATCH</Txt>}
          </Panel>
          <Panel>
            <Txt>PICK AVATAR:</Txt>
            <Row>
              {AVATARS.map(a => (
                <Pressable key={a} onPress={() => setAvatar(a)} accessibilityLabel={`Avatar ${a}`}
                  style={{ borderWidth: 3, borderColor: a === avatar ? C.gold : 'transparent', padding: 6 }}>
                  <Txt size={24} style={{ lineHeight: 34 }}>{a}</Txt>
                </Pressable>
              ))}
            </Row>
          </Panel>
        </>
      ),
    },
    {
      title: 'CHOOSE CLASS',
      ok: archetypes.length > 0,
      body: (
        <Panel>
          <Txt color={C.dim} size={8}>Pick 1 or more</Txt>
          <Row>{ARCHETYPES.map(a => <Chip key={a.id} label={`${a.icon} ${a.name}`} on={archetypes.includes(a.id)} onPress={() => setArchetypes(toggle(archetypes, a.id))} />)}</Row>
        </Panel>
      ),
    },
    {
      title: 'QUICK QUIZ',
      ok: questions.every(q => answers[q.id]),
      body: questions.map(q => (
        <Panel key={q.id}>
          <Txt>{q.text}</Txt>
          <Row>{q.options.map(o => <Chip key={o} label={o.toUpperCase()} on={answers[q.id] === o} onPress={() => setAnswers({ ...answers, [q.id]: o })} />)}</Row>
        </Panel>
      )),
    },
    {
      title: 'PARTY PREFS',
      ok: true,
      body: (
        <>
          <Panel>
            <Txt>WANT TO MEET:</Txt>
            <Txt color={C.dim} size={8}>None picked = anyone</Txt>
            <Row>{ARCHETYPES.map(a => <Chip key={a.id} label={`${a.icon} ${a.name}`} on={wants.includes(a.id)} onPress={() => setWants(toggle(wants, a.id))} />)}</Row>
          </Panel>
          <Panel>
            <Txt>BUDGET:</Txt>
            <Row>{BUDGETS.map(([id, label]) => <Chip key={id} label={label} on={budget === id} onPress={() => setBudget(id)} />)}</Row>
          </Panel>
        </>
      ),
    },
  ];
  const s = steps[step];
  const last = step === steps.length - 1;

  if (signIn) return <SignIn onDone={onDone} onBack={() => setSignIn(false)} />;

  return (
    <Screen title={s.title}>
      <Txt color={C.dim} size={8}>STAGE {step + 1}/{steps.length}</Txt>
      {s.body}
      <Btn label={last ? (saving ? 'SAVING...' : 'START GAME') : 'NEXT ▶'} disabled={!s.ok || saving}
        onPress={last ? save : () => setStep(step + 1)} />
      {step > 0 && <Btn label="◀ BACK" color={C.dim} small onPress={() => setStep(step - 1)} />}
      {step === 0 && <Btn label="HAVE A PLAYER? SIGN IN" color={C.dim} small onPress={() => setSignIn(true)} />}
    </Screen>
  );
}
