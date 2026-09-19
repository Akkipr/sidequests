import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Btn, C, Screen, Txt } from '../../components/pixel-ui';
import { useSession } from '../../features/auth/SessionProvider';
import SignInScreen from '../../features/auth/SignInScreen';
import { DiscoveryProvider } from '../../features/discovery/DiscoveryProvider';
import MatchScreen from '../../features/matches/MatchScreen';
import OnboardingScreen from '../../features/onboarding/OnboardingScreen';
import QuestDetailScreen from '../../features/quests/QuestDetailScreen';
import MainTabs from './MainTabs';
import type { OnboardingParams, RootParams } from './types';

const Root = createNativeStackNavigator<RootParams>();
const Auth = createNativeStackNavigator<OnboardingParams>();

// The onboarding flow: create a player, or sign in to an existing one.
function AuthNavigator() {
  return (
    <Auth.Navigator screenOptions={{ headerShown: false, contentStyle: { backgroundColor: C.bg } }}>
      <Auth.Screen name="Onboarding" component={OnboardingScreen} />
      <Auth.Screen name="SignIn" component={SignInScreen} />
    </Auth.Navigator>
  );
}

export default function RootNavigator() {
  const { phase, error, retry } = useSession();

  if (phase === 'loading') return <Screen title="LOADING..."><Txt color={C.dim}>PRESS START</Txt></Screen>;
  if (phase === 'error') {
    return (
      <Screen title="GAME OVER">
        <Txt color={C.pink}>CAN'T REACH SERVER</Txt>
        <Txt size={8} color={C.dim}>{error}</Txt>
        <Txt size={8} color={C.dim}>Check EXPO_PUBLIC_API_URL in mobile/.env is your current tunnel URL and the server is running.</Txt>
        <Btn label="CONTINUE?" onPress={retry} />
      </Screen>
    );
  }

  const screenOptions = { headerShown: false, contentStyle: { backgroundColor: C.bg } } as const;
  if (phase === 'signedOut') {
    return (
      <Root.Navigator screenOptions={screenOptions}>
        <Root.Screen name="Auth" component={AuthNavigator} />
      </Root.Navigator>
    );
  }

  // Everything signed-in shares one discovery lifecycle, which drives the Match flow above the tabs.
  return (
    <DiscoveryProvider>
      <Root.Navigator screenOptions={screenOptions}>
        <Root.Screen name="Main" component={MainTabs} />
        <Root.Screen name="Match" component={MatchScreen} options={{ presentation: 'fullScreenModal', gestureEnabled: false }} />
        <Root.Screen name="QuestDetail" component={QuestDetailScreen} />
      </Root.Navigator>
    </DiscoveryProvider>
  );
}
