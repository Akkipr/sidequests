// EXPO_PUBLIC_* values are inlined at bundle time, so restart Metro with --clear after changing .env.
export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://192.168.1.10:3000';

// Demo mode (must match DEMO_MODE on the server): shows "SIMULATE NEARBY PLAYER" and lets discovery run
// without a wearable. Off by default; when off, none of the demo UI is rendered.
export const DEMO_MODE = process.env.EXPO_PUBLIC_DEMO_MODE === 'true';

// Sentry error reporting. The DSN is not a secret, but it is kept out of the source so a public repo can't be used to
// spam the project. Unset = Sentry is off. (Uploading source maps at build time needs SENTRY_AUTH_TOKEN, which must
// never be committed; see the README.)
export const SENTRY_DSN = process.env.EXPO_PUBLIC_SENTRY_DSN ?? '';

// Optional overrides for release health / performance (see services/monitoring.ts). Leave unset for the defaults:
// release = <slug>@<version> from app.json, and tracing on for every session in development, 20% otherwise.
// Prints what the Sentry SDK is doing (replay starting, envelopes sent, errors) to the Metro console. For diagnosing only.
export const SENTRY_DEBUG = process.env.EXPO_PUBLIC_SENTRY_DEBUG === 'true';
export const SENTRY_RELEASE = process.env.EXPO_PUBLIC_SENTRY_RELEASE ?? '';
export const SENTRY_TRACES_SAMPLE_RATE_RAW = process.env.EXPO_PUBLIC_SENTRY_TRACES_SAMPLE_RATE;
// Share of sessions to record with Session Replay (0 to 1). Default: every session while developing, 10% otherwise.
export const SENTRY_REPLAY_SESSION_RATE_RAW = process.env.EXPO_PUBLIC_SENTRY_REPLAY_SESSION_RATE;
