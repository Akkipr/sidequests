import AsyncStorage from '@react-native-async-storage/async-storage';

// Your laptop's LAN IP running server/ (the phone can't reach "localhost"). Set in mobile/.env
const API = process.env.EXPO_PUBLIC_API_URL ?? 'http://192.168.1.10:3000';

let key: string | null = null;

// An unreachable server otherwise hangs forever (campus Wi-Fi often blocks phone -> laptop).
function send(url: string, init: RequestInit = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 10000);
  return fetch(url, { ...init, signal: ctl.signal })
    .catch(e => { throw new Error(ctl.signal.aborted ? `Timed out reaching ${API}` : e.message); })
    .finally(() => clearTimeout(t));
}

async function deviceKey() {
  key ??= await AsyncStorage.getItem('deviceKey');
  if (!key) {
    const r = await send(`${API}/register`, { method: 'POST' });
    if (!r.ok) throw new Error(`register failed: ${r.status}`);
    key = (await r.json()).key as string;
    await AsyncStorage.setItem('deviceKey', key);
  }
  return key;
}

export async function api<T = any>(path: string, body?: object): Promise<T> {
  const r = await send(`${API}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await deviceKey()}` },
    body: body && JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${path} failed: ${r.status} ${await r.text()}`);
  return r.json();
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
