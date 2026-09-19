import { useState } from 'react';
import { Alert } from 'react-native';
import { login, Profile } from '../api';
import { Btn, C, Field, Panel, Screen, Txt } from '../ui';

export default function SignIn({ onDone, onBack }: { onDone: (p: Profile) => void; onBack: () => void }) {
  const [nickname, setNickname] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      onDone(await login(nickname.trim(), password));
    } catch (e: any) {
      Alert.alert('Sign in failed', e.message);
      setBusy(false);
    }
  }

  return (
    <Screen title="SIGN IN">
      <Panel>
        <Txt>NAME:</Txt>
        <Field value={nickname} onChangeText={setNickname} maxLength={24} autoFocus autoCapitalize="none" autoCorrect={false} />
      </Panel>
      <Panel>
        <Txt>PASSWORD:</Txt>
        <Field value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" autoCorrect={false} />
      </Panel>
      <Btn label={busy ? 'SIGNING IN...' : 'SIGN IN ▶'} disabled={!nickname.trim() || !password || busy} onPress={submit} />
      <Btn small color={C.dim} label="◀ NEW PLAYER" onPress={onBack} />
    </Screen>
  );
}
