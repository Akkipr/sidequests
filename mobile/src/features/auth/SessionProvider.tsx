import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import * as api from '../../services/api';
import { disconnectWearable } from '../../services/ble';
import type { Profile, ProfileInput, SignupInput } from '../../types/api';

// Who is signed in. Owns the session token lifecycle so no screen touches it.
type Session = {
  phase: 'loading' | 'signedOut' | 'signedIn' | 'error';
  profile: Profile | null; // non-null exactly when phase === 'signedIn'
  error: string;
  retry: () => void;
  signUp: (input: SignupInput) => Promise<void>;
  signIn: (nickname: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  saveProfile: (input: ProfileInput) => Promise<void>;
  refreshProfile: () => Promise<void>;
};

const Ctx = createContext<Session | null>(null);
export const useSession = () => {
  const s = useContext(Ctx);
  if (!s) throw new Error('useSession outside SessionProvider');
  return s;
};
// Convenience for screens that only render when signed in.
export const useProfile = () => {
  const { profile } = useSession();
  if (!profile) throw new Error('useProfile while signed out');
  return profile;
};

export function SessionProvider({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Session['phase']>('loading');
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState('');

  const signedIn = (p: Profile) => { setProfile(p); setPhase('signedIn'); };
  const signedOut = useCallback(() => { setProfile(null); setPhase('signedOut'); }, []);

  // A revoked session (401 anywhere) lands here. Registered before boot so it can't be missed.
  useEffect(() => { api.onAuthLost(signedOut); }, [signedOut]);

  const boot = useCallback(() => {
    setError('');
    setPhase('loading');
    // No token = never signed in (or signed out): straight to onboarding, no network needed.
    api.getToken().then(t => (t ? api.getProfile() : null)).then(
      p => (p ? signedIn(p) : signedOut()),
      (e: unknown) => {
        if (api.isAuthError(e)) return; // already handled by onAuthLost
        setError(api.errorMessage(e));
        setPhase('error');
      });
  }, [signedOut]);
  useEffect(boot, [boot]);

  const value = useMemo<Session>(() => ({
    phase, profile, error, retry: boot,
    signUp: async (input) => signedIn(await api.signup(input)),
    signIn: async (nickname, password) => signedIn(await api.login(nickname, password)),
    signOut: async () => {
      // A wearable belongs to one person: drop the link before the session ends.
      await disconnectWearable();
      await api.logout();
      signedOut();
    },
    saveProfile: async (input) => setProfile(await api.updateProfile(input)),
    refreshProfile: async () => setProfile(await api.getProfile()),
  }), [phase, profile, error, boot, signedOut]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
