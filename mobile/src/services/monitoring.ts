import * as Sentry from '@sentry/react-native';
import type { NavigationContainerRefWithCurrent, ParamListBase } from '@react-navigation/native';
import { expo } from '../../app.json';
import { SENTRY_DSN, SENTRY_RELEASE, SENTRY_TRACES_SAMPLE_RATE_RAW } from '../config';
import { dropExpected, parseSampleRate, releaseName } from './monitoringFilters';

// Crash and error reporting plus release health and performance. Off unless EXPO_PUBLIC_SENTRY_DSN is set.
//
// Privacy first: SideQuests promises identity stays hidden until both people wave, so we never attach IP addresses,
// cookies or a user (sendDefaultPii is off and we never call Sentry.setUser). "Crash-free users" still works because
// the native SDK tags every session with a random per-install ID that is not linked to a nickname or account.
export const monitoringEnabled = SENTRY_DSN.length > 0;

// What each Sentry metric is fed by:
//  - releases and crash-free sessions/users: `release` (below) sent with the SDK's automatic sessions;
//  - Apdex: transactions, i.e. timed screen changes (this integration) and app start. Apdex needs tracing to be on.
export const RELEASE = releaseName({ override: SENTRY_RELEASE, slug: expo.slug, version: expo.version });
const DIST = expo.ios.buildNumber; // identifies the native build within a release (bump it for each new build)

// Times every screen change as a transaction. It has to exist before Sentry.init and be given the navigation container.
const navigationIntegration = Sentry.reactNavigationIntegration();

export function initMonitoring() {
  if (!monitoringEnabled) return;
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: __DEV__ ? 'development' : 'production',
    release: RELEASE,
    dist: DIST,
    sendDefaultPii: false,

    // Release health: one session per app use, ended after 30 s in the background. (These are the defaults, spelled out
    // because the metrics depend on them.)
    enableAutoSessionTracking: true,
    sessionTrackingIntervalMillis: 30000,

    // Performance / Apdex. Every session is traced while developing so data shows up quickly; production keeps 20%.
    tracesSampleRate: parseSampleRate(SENTRY_TRACES_SAMPLE_RATE_RAW, __DEV__ ? 1 : 0.2),
    integrations: [navigationIntegration],

    beforeSend: dropExpected,
  });
}

// Call once the navigation container is ready so screen changes become transactions.
export function registerNavigation(container: NavigationContainerRefWithCurrent<ParamListBase>) {
  if (monitoringEnabled) navigationIntegration.registerNavigationContainer(container);
}

// Wraps the root component so render errors are caught and reported.
export const withMonitoring = Sentry.wrap;

// Demo-mode helper for checking the setup end to end: sends one clearly labelled error and waits for it to go out.
export async function sendTestError() {
  Sentry.captureException(new Error('SideQuests Sentry test (sent from the demo-mode button)'));
  await Sentry.flush(); // resolves once queued events are sent (or the SDK gives up)
}
