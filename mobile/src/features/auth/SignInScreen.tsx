import { useState } from 'react';
import { Alert } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { errorMessage } from '../../services/api';
import { Btn, C, Field, Panel, Screen, Txt } from '../../components/pixel-ui';
import type { OnboardingParams } from '../../app/navigation/types';
import { useSession } from './SessionProvider';

export default function SignInScreen({ navigation }: NativeStackScreenProps<OnboardingParams, 'SignIn'>) {
  const { signIn } = useSession();
  const [nickname, setNickname] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      await signIn(nickname.trim(), password); // signing in swaps the whole navigator, so no navigation here
    } catch (e) {
      Alert.alert('Sign in failed', errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <Screen title="SIGN IN">
      <Panel>
        <Txt>NAME:</Txt>
        <Field value={nickname} onChangeText={setNickname} maxLength={24} autoFocus autoCapitalize="none" autoCorrect={false}
          accessibilityLabel="Nickname" />
      </Panel>
      <Panel>
        <Txt>PASSWORD:</Txt>
        <Field value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" autoCorrect={false}
          accessibilityLabel="Password" />
      </Panel>
      <Btn label={busy ? 'SIGNING IN...' : 'SIGN IN ▶'} disabled={!nickname.trim() || !password || busy} onPress={submit} />
      <Btn small color={C.dim} label="◀ NEW PLAYER" onPress={() => navigation.goBack()} />
    </Screen>
  );
}
