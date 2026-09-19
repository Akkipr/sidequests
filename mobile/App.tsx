import { PressStart2P_400Regular, useFonts } from '@expo-google-fonts/press-start-2p';
import AppProviders from './src/app/providers/AppProviders';
import RootNavigator from './src/app/navigation/RootNavigator';

export default function App() {
  const [fonts] = useFonts({ PressStart2P_400Regular });
  if (!fonts) return null;
  return (
    <AppProviders>
      <RootNavigator />
    </AppProviders>
  );
}
