import { useState } from 'react';
import { Alert } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ApiError, errorMessage } from '../../services/api';
import { AvatarPicker, ArchetypePicker, Prefs, Quiz, quizComplete, toProfileInput } from '../../components/pixel-ui/fields';
import { Btn, C, Field, Panel, Screen, Txt } from '../../components/pixel-ui';
import { AVATARS } from '../../constants/archetypes';
import type { OnboardingParams } from '../../app/navigation/types';
import type { Budget } from '../../types/api';
import { useSession } from '../auth/SessionProvider';

const MIN_PASSWORD = 8; // keep in sync with server/config.js

// A four-stage wizard. The account is created at the end, in one call, so an abandoned wizard leaves nothing behind.
export default function OnboardingScreen({ navigation }: NativeStackScreenProps<OnboardingParams, 'Onboarding'>) {
  const { signUp } = useSession();
  const [step, setStep] = useState(0);
  const [nickname, setNickname] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [avatar, setAvatar] = useState(AVATARS[0]);
  const [archetypes, setArchetypes] = useState<string[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [wants, setWants] = useState<string[]>([]);
  const [budget, setBudget] = useState<Budget>('low');
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await signUp({ nickname: nickname.trim(), password, ...toProfileInput({ avatar, archetypes, answers, wants, budget }) });
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        Alert.alert('Name taken', 'Someone already has that name. Pick another.');
        setStep(0);
      } else {
        Alert.alert('Save failed', errorMessage(e));
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
            <Field value={nickname} onChangeText={setNickname} maxLength={24} autoFocus accessibilityLabel="Nickname" />
          </Panel>
          <Panel>
            <Txt>PASSWORD:</Txt>
            <Field value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" autoCorrect={false}
              accessibilityLabel="Password" />
            {password.length > 0 && password.length < MIN_PASSWORD && <Txt size={8} color={C.pink}>MIN {MIN_PASSWORD} CHARACTERS</Txt>}
            <Txt>CONFIRM:</Txt>
            <Field value={confirm} onChangeText={setConfirm} secureTextEntry autoCapitalize="none" autoCorrect={false}
              accessibilityLabel="Confirm password" />
            {confirm.length > 0 && confirm !== password && <Txt size={8} color={C.pink}>PASSWORDS DON'T MATCH</Txt>}
          </Panel>
          <AvatarPicker value={avatar} onChange={setAvatar} />
        </>
      ),
    },
    { title: 'CHOOSE CLASS', ok: archetypes.length > 0, body: <ArchetypePicker value={archetypes} onChange={setArchetypes} /> },
    {
      title: 'QUICK QUIZ',
      ok: quizComplete(archetypes, answers),
      body: <Quiz archetypes={archetypes} answers={answers} onChange={setAnswers} />,
    },
    {
      title: 'PARTY PREFS',
      ok: true,
      body: <Prefs wants={wants} budget={budget} onWants={setWants} onBudget={setBudget} />,
    },
  ];
  const s = steps[step];
  const last = step === steps.length - 1;

  return (
    <Screen title={s.title}>
      <Txt color={C.dim} size={8}>STAGE {step + 1}/{steps.length}</Txt>
      {s.body}
      <Btn label={last ? (saving ? 'SAVING...' : 'START GAME') : 'NEXT ▶'} disabled={!s.ok || saving}
        onPress={last ? save : () => setStep(step + 1)} />
      {step > 0 && <Btn label="◀ BACK" color={C.dim} small onPress={() => setStep(step - 1)} />}
      {step === 0 && <Btn label="HAVE A PLAYER? SIGN IN" color={C.dim} small onPress={() => navigation.navigate('SignIn')} />}
    </Screen>
  );
}
