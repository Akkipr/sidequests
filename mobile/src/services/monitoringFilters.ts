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

/**
 * The release name Sentry groups sessions and errors under ("number of releases", crash-free rates per release).
 * An explicit override (e.g. a git SHA set by CI) wins; otherwise it is `<slug>@<version>` from app.json, so bumping
 * the app version is what starts a new release.
 */
export function releaseName({ override, slug, version }: { override?: string | null; slug: string; version: string }): string {
  const custom = override?.trim();
  return custom ? custom : `${slug}@${version}`;
}

/** Parses a 0..1 sampling rate from an env string; anything missing, non-numeric or out of range uses the fallback. */
export function parseSampleRate(raw: string | undefined | null, fallback: number): number {
  if (raw === undefined || raw === null || raw.trim() === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : fallback;
}

const UUID = /\/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}(?=\/|$)/g;
const NUMBER = /\/\d+(?=\/|$)/g;

/** "/matches/123/respond?x=1" -> "/matches/:id/respond". Span names use the pattern, never a real id or query. */
export function routeName(path: string): string {
  return path.replace(/[?#].*$/, '').replace(UUID, '/:id').replace(NUMBER, '/:id');
}
