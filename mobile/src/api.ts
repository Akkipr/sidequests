import AsyncStorage from '@react-native-async-storage/async-storage';

// Your laptop's LAN IP running server/ (the phone can't reach "localhost"). Set in mobile/.env
const API = process.env.EXPO_PUBLIC_API_URL ?? 'http://192.168.1.10:3000';

// Session token from /signup or /login. undefined = not read from storage yet.
let token: string | null | undefined;

export async function getToken() {
  token ??= await AsyncStorage.getItem('token');
  return token;
}
async function setToken(t: string | null) {
  token = t;
  await (t ? AsyncStorage.setItem('token', t) : AsyncStorage.removeItem('token'));
}

// A 401 on an authed call (session revoked or signed out elsewhere) clears the token and calls this.
let authLost = () => {};
export const onAuthLost = (fn: () => void) => { authLost = fn; };
export const isAuthError = (e: any) => e?.name === 'AuthError';

// An unreachable server otherwise hangs forever (campus Wi-Fi often blocks phone -> laptop).
function send(url: string, init: RequestInit = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 10000);
  return fetch(url, { ...init, signal: ctl.signal })
    .catch(e => { throw new Error(ctl.signal.aborted ? `Timed out reaching ${API}` : e.message); })
    .finally(() => clearTimeout(t));
}

export async function api<T = any>(path: string, body?: object): Promise<T> {
  const t = await getToken();
  if (!t) throw Object.assign(new Error('Not signed in'), { name: 'AuthError' });
  const r = await send(`${API}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` },
    body: body && JSON.stringify(body),
  });
  if (r.status === 401) {
    await setToken(null);
    authLost();
    throw Object.assign(new Error('Session expired'), { name: 'AuthError' });
  }
  if (!r.ok) throw new Error(`${path} failed: ${r.status} ${await r.text()}`);
  return r.json();
}

// /signup and /login are the only unauthenticated calls; both hand back a session token.
async function authenticate(path: '/signup' | '/login', body: object): Promise<Profile> {
  const r = await send(`${API}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!r.ok) {
    const { error } = await r.json().catch(() => ({ error: `${path} failed: ${r.status}` }));
    throw Object.assign(new Error(error), { status: r.status });
  }
  await setToken((await r.json()).token);
  return api<Profile>('/profile');
}

export type Signup = Pick<Profile, 'nickname' | 'avatar' | 'archetypes' | 'answers' | 'wants' | 'budget'> & { password: string };
export const signup = (body: Signup) => authenticate('/signup', body);
export const login = (nickname: string, password: string) => authenticate('/login', { nickname, password });

// Best effort: if the server can't be reached we still sign out locally.
export async function logout() {
  await api('/logout', {}).catch(() => {});
  await setToken(null);
}

export type Status = 'off' | 'open' | 'food' | 'hour';
export type Quest = { id: number; title: string; description: string; location: string; starts: string; cost: string; minutes: number };
export type Match = {
  id: number; score: number; reason: string; shared: string[];
  myResponse: boolean | null; status: 'pending' | 'revealed' | 'declined';
  other: { nickname: string; avatar: string; archetypes: string[] } | null;
  quests: Quest[];
};
export type Profile = {
  nickname: string; avatar: string; archetypes: string[]; answers: Record<string, string>;
  wants: string[]; budget: 'free' | 'low' | 'any'; status: Status; points: number;
};
