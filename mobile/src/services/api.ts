import { API_URL } from '../config';
import type {
  BlockedEntry, MatchView, Profile, ProfileInput, QuestOverview, QuestRun, SignalPayload, SignalResult,
  SignupInput, Status,
} from '../types/api';
import { routeName } from './monitoringFilters';
import { appLog, traced } from './monitoring';
import { storage } from './storage';

// ---- session token ----
let token: string | null | undefined; // undefined = not read from storage yet

export async function getToken() {
  token ??= await storage.get('token');
  return token;
}
async function setToken(t: string | null) {
  token = t;
  await (t ? storage.set('token', t) : storage.remove('token'));
}

// A 401 on an authed call (session revoked or signed out elsewhere) clears the token and calls this.
let authLost = () => {};
export const onAuthLost = (fn: () => void) => { authLost = fn; };

export class AuthError extends Error {
  name = 'AuthError';
}
export class ApiError extends Error {
  name = 'ApiError';
  constructor(message: string, readonly status: number) { super(message); }
}
export const isAuthError = (e: unknown): e is AuthError => e instanceof Error && e.name === 'AuthError';
export const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

// ---- transport ----
// An unreachable server otherwise hangs forever (campus Wi-Fi often blocks phone -> laptop).
function send(url: string, init: RequestInit = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 10000);
  return fetch(url, { ...init, signal: ctl.signal })
    .catch((e: unknown) => { throw new Error(ctl.signal.aborted ? `Timed out reaching ${API_URL}` : errorMessage(e)); })
    .finally(() => clearTimeout(t));
}

// Every call is timed as `METHOD /route/:pattern`, which feeds Sentry's Performance and Apdex.
const request = <T>(method: string, path: string, body?: object): Promise<T> =>
  traced(`${method} ${routeName(path)}`, () => rawRequest<T>(method, path, body));

async function rawRequest<T>(method: string, path: string, body?: object): Promise<T> {
  const t = await getToken();
  if (!t) throw new AuthError('Not signed in');
  const r = await send(`${API_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` },
    body: body && JSON.stringify(body),
  });
  if (r.status === 401) {
    appLog.warn('session expired');
    await setToken(null);
    authLost();
    throw new AuthError('Session expired');
  }
  if (!r.ok) {
    const { error } = (await r.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(error ?? `${path} failed: ${r.status}`, r.status);
  }
  return r.json() as Promise<T>;
}
const get = <T>(path: string) => request<T>('GET', path);
const post = <T>(path: string, body: object = {}) => request<T>('POST', path, body);

// ---- auth (the only unauthenticated calls) ----
async function authenticate(path: '/signup' | '/login', body: object): Promise<Profile> {
  const r = await traced(`POST ${path}`, () => send(`${API_URL}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }));
  if (!r.ok) {
    const { error } = (await r.json().catch(() => ({ error: `${path} failed: ${r.status}` }))) as { error: string };
    appLog.warn(path === '/signup' ? 'sign-up failed' : 'sign-in failed', { 'http.status': r.status });
    throw new ApiError(error, r.status);
  }
  await setToken(((await r.json()) as { token: string }).token);
  appLog.info(path === '/signup' ? 'signed up' : 'signed in');
  return getProfile();
}
export const signup = (input: SignupInput) => authenticate('/signup', input);
export const login = (nickname: string, password: string) => authenticate('/login', { nickname, password });

// Best effort: if the server can't be reached we still sign out locally.
export async function logout() {
  await post('/logout').catch(() => {});
  await setToken(null);
  appLog.info('signed out');
}

// ---- profile ----
export const getProfile = () => get<Profile | null>('/profile') as Promise<Profile>;
export const updateProfile = (input: ProfileInput) => request<Profile>('PUT', '/profile', input);
export const setStatus = (status: Status) => post<{ ok: true }>('/status', { status });

// ---- signals & wearables ----
export const sendSignal = (payload: SignalPayload) => post<SignalResult>('/signal', payload);
export const linkWearable = (wearableToken: string) => post<{ ok: true }>('/wearables/link', { wearableToken });

// ---- matches ----
export const getMatch = (id: number) => get<MatchView>(`/matches/${id}`);
// A match the partner's signal created: our own wearable may never have reported them.
export const getCurrentMatch = () => get<MatchView | null>('/matches/current');
export const respondToMatch = (id: number, wave: boolean) => post<MatchView>(`/matches/${id}/respond`, { wave });
export const blockMatch = (id: number) => post<{ ok: true }>(`/matches/${id}/block`, { reason: 'user report' });

// ---- quests ----
export const getQuests = () => get<QuestOverview>('/quests');
export const selectQuest = (matchId: number, questId: number) => post<{ run: QuestRun }>(`/matches/${matchId}/quest`, { questId });
export const startQuest = (matchId: number) => post<{ run: QuestRun }>(`/matches/${matchId}/quest/start`);
export const completeQuest = (matchId: number) => post<{ run: QuestRun; awarded: boolean }>(`/matches/${matchId}/quest/complete`);

// ---- blocks ----
export const getBlocks = () => get<BlockedEntry[]>('/blocks');
export const unblock = (id: string) => request<{ ok: true }>('DELETE', `/blocks/${id}`);

// ---- demo mode (the server 404s these unless DEMO_MODE=true) ----
export const simulateNearby = () => post<{ matchId: number }>('/demo/nearby');
