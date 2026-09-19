import AsyncStorage from '@react-native-async-storage/async-storage';

// Everything the app keeps on the phone. (Discovery state is deliberately NOT here: it always resets to private.)
const KEYS = { token: 'token', wearableId: 'wearableId' } as const;
type Key = keyof typeof KEYS;

export const storage = {
  get: (k: Key) => AsyncStorage.getItem(KEYS[k]),
  set: (k: Key, v: string) => AsyncStorage.setItem(KEYS[k], v),
  remove: (k: Key) => AsyncStorage.removeItem(KEYS[k]),
};
