// Pure helpers for what we do and don't send to Sentry (no React Native imports, so they can be unit-tested).

// Errors that are part of normal use, not bugs: the session ended or the user isn't signed in. The app already handles
// them by returning to sign-in, so reporting them would only add noise.
const EXPECTED = new Set(['AuthError']);

export function isExpectedError(error: unknown): boolean {
  const name = (error as { name?: unknown } | null | undefined)?.name;
  return typeof name === 'string' && EXPECTED.has(name);
}

// Sentry passes the event and a hint holding the original exception. Returning null drops the event.
export function dropExpected<E>(event: E, hint?: { originalException?: unknown }): E | null {
  return isExpectedError(hint?.originalException) ? null : event;
}
