import * as Sentry from '@sentry/react-native';
import { SENTRY_DSN } from '../config';
import { dropExpected } from './monitoringFilters';

// Crash and error reporting. Off unless EXPO_PUBLIC_SENTRY_DSN is set. Privacy first: SideQuests promises that who you
// are stays hidden until both people wave, so we never attach IP addresses, cookies or a user (sendDefaultPii is off)
// and we never call Sentry.setUser.
export function initMonitoring() {
  if (!SENTRY_DSN) return;
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: __DEV__ ? 'development' : 'production',
    sendDefaultPii: false,
    tracesSampleRate: 0.2, // performance traces for a fifth of sessions; the docs' example of 1.0 is for testing
    beforeSend: dropExpected,
  });
}

// Wraps the root component so render errors are caught and reported.
export const withMonitoring = Sentry.wrap;

export const monitoringEnabled = SENTRY_DSN.length > 0;

// Demo-mode helper for checking the setup end to end: sends one clearly labelled error and waits for it to go out.
export async function sendTestError() {
  Sentry.captureException(new Error('SideQuests Sentry test (sent from the demo-mode button)'));
  await Sentry.flush(); // resolves once queued events are sent (or the SDK gives up)
}
