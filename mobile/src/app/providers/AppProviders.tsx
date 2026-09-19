import { ReactNode } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { SessionProvider } from '../../features/auth/SessionProvider';
import { navigationRef } from '../navigation/navigationRef';
import { pixelTheme } from '../navigation/theme';

export default function AppProviders({ children }: { children: ReactNode }) {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <NavigationContainer ref={navigationRef} theme={pixelTheme}>
        <SessionProvider>{children}</SessionProvider>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
