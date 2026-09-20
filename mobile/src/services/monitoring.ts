import * as Sentry from '@sentry/react-native';
import type { NavigationContainerRefWithCurrent, ParamListBase } from '@react-navigation/native';
import { expo } from '../../app.json';
import { API_URL, SENTRY_DEBUG, SENTRY_DSN, SENTRY_RELEASE, SENTRY_REPLAY_SESSION_RATE_RAW, SENTRY_TRACES_SAMPLE_RATE_RAW } from '../config';
import { dropExpected, parseSampleRate, releaseName, REPLAY_PRIVACY, replayRates, scrubLog } from './monitoringFilters';

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
  const replays = replayRates(SENTRY_REPLAY_SESSION_RATE_RAW, __DEV__);
  Sentry.init({
    dsn: SENTRY_DSN,
    debug: SENTRY_DEBUG,
    environment: __DEV__ ? 'development' : 'production',
    release: RELEASE,
    dist: DIST,
    sendDefaultPii: false,
    initialScope: { tags: { component: 'app' } }, // the API reports to this same project as component:api

    // Release health: one session per app use, ended after 30 s in the background. (These are the defaults, spelled out
    // because the metrics depend on them.)
    enableAutoSessionTracking: true,
    sessionTrackingIntervalMillis: 30000,

    // Performance / Apdex. Every session is traced while developing so data shows up quickly; production keeps 20%.
    tracesSampleRate: parseSampleRate(SENTRY_TRACES_SAMPLE_RATE_RAW, __DEV__ ? 1 : 0.2),
    // Logs: JavaScript only (no native OS logs), and only warnings and errors from the console. Every log is scrubbed.
    enableLogs: true,
    logsOrigin: 'js',
    beforeSendLog: scrubLog,
    // Session Replay: what people did on screen, with ALL text, images and icons masked (see REPLAY_PRIVACY).
    replaysSessionSampleRate: replays.session,
    replaysOnErrorSampleRate: replays.onError,
    integrations: [
      navigationIntegration,
      Sentry.consoleLoggingIntegration({ levels: ['warn', 'error'] }),
      Sentry.mobileReplayIntegration({ ...REPLAY_PRIVACY }),
    ],
    // Send trace headers to OUR API only, so an action in the app and the server request it caused show up as one trace.
    // (The headers carry ids and the release name, nothing about the player.)
    tracePropagationTargets: [API_URL],

    beforeSend: dropExpected,
  });
}

// Call once the navigation container is ready so screen changes become transactions.
export function registerNavigation(container: NavigationContainerRefWithCurrent<ParamListBase>) {
  if (monitoringEnabled) navigationIntegration.registerNavigationContainer(container);
}

// Times `fn` as its own span/transaction (this is what gives Performance and Apdex real numbers for the things people
// actually do). `name` must be a pattern like "POST /matches/:id/respond", never something containing a real id.
export function traced<T>(name: string, fn: () => Promise<T>): Promise<T> {
  return Sentry.startSpan({ name, op: 'app.action' }, fn);
}

// Deliberate usage logs: fixed messages and non-identifying attributes (an intent, a status), never names, ids or tokens.
// Safe to call when Sentry is off.
export const appLog = {
  info: (message: string, attributes?: Record<string, string | number | boolean>) => Sentry.logger.info(message, attributes),
  warn: (message: string, attributes?: Record<string, string | number | boolean>) => Sentry.logger.warn(message, attributes),
};

// Wraps the root component so render errors are caught and reported.
export const withMonitoring = Sentry.wrap;

// Demo-mode helper for checking the setup end to end: sends one clearly labelled error and waits for it to go out.
export async function sendTestError() {
  Sentry.captureException(new Error('SideQuests Sentry test (sent from the demo-mode button)'));
  await Sentry.flush(); // resolves once queued events are sent (or the SDK gives up)
}
