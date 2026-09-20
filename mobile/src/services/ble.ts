import { BleManager, Device, State, Subscription } from 'react-native-ble-plx';
import { PermissionsAndroid, Platform } from 'react-native';
import { storage } from './storage';
import { parseWearableMessage, TOKEN_RE, WearableMessage } from './wearableMessage';

// Must match the wearable firmware. See docs/firmware-protocol.md.
export const SERVICE_UUID = 'abcd1234-1234-1234-1234-abcdef123456';
export const MATCH_UUID = 'abcd1234-1234-1234-1234-abcdef123457'; // notify: NEAR:<peer-token>:<rssi> | IDLE | MATCH (legacy)
export const TOKEN_UUID = 'abcd1234-1234-1234-1234-abcdef123458'; // read: this wearable's own token (future firmware)
export const STATE_UUID = 'abcd1234-1234-1234-1234-abcdef123459'; // write: what the phone is showing, for the wearable's display

/** Mirrored to the wearable so its screen can prompt, and its buttons can answer. */
export type WearableState = 'NONE' | 'CANDIDATE' | 'WAITING' | 'MATCHED';
const NAME = 'PassingStranger';

export { parseWearableMessage, TOKEN_RE } from './wearableMessage';
export type { WearableMessage } from './wearableMessage';

const manager = new BleManager();

const poweredOn = () =>
  new Promise<void>(resolve => {
    const sub = manager.onStateChange(s => {
      if (s === State.PoweredOn) { sub.remove(); resolve(); }
    }, true);
  });

async function askPermissions() {
  if (Platform.OS !== 'android') return;
  const P = PermissionsAndroid.PERMISSIONS;
  const perms = Number(Platform.Version) >= 31
    ? [P.BLUETOOTH_SCAN, P.BLUETOOTH_CONNECT, P.ACCESS_FINE_LOCATION]
    : [P.ACCESS_FINE_LOCATION];
  const r = await PermissionsAndroid.requestMultiple(perms);
  if (Object.values(r).some(v => v !== 'granted')) throw new Error('Bluetooth permission denied');
}

const isWearable = (d: Device) =>
  d.localName === NAME || d.name === NAME || !!d.serviceUUIDs?.some(u => u.toLowerCase() === SERVICE_UUID);

// ponytail: first pairing picks the strongest-signal wearable (the one on your wrist). Add a picker if booths get crowded.
function findStrongest(ms = 4000) {
  return new Promise<string>((resolve, reject) => {
    let best: Device | null = null;
    manager.startDeviceScan(null, null, (err, d) => {
      if (err) { manager.stopDeviceScan(); return reject(err); }
      if (d && isWearable(d) && (!best || (d.rssi ?? -999) > (best.rssi ?? -999))) best = d;
    });
    setTimeout(() => {
      manager.stopDeviceScan();
      best ? resolve(best.id) : reject(new Error('No SideQuests wearable found. Is it powered on?'));
    }, ms);
  });
}

// ---- event fan-out: the discovery provider subscribes only while it is listening ----
const messageHandlers = new Set<(m: WearableMessage) => void>();
const disconnectHandlers = new Set<() => void>();
export function onWearableMessage(fn: (m: WearableMessage) => void) {
  messageHandlers.add(fn);
  return () => { messageHandlers.delete(fn); };
}
export function onWearableDisconnect(fn: () => void) {
  disconnectHandlers.add(fn);
  return () => { disconnectHandlers.delete(fn); };
}

// The live connection and its listeners, so a sign-out / re-pair can tear them down.
let link: { device: Device; subs: Subscription[] } | null = null;

function dropLink() {
  const l = link;
  link = null;
  l?.subs.forEach(s => s.remove());
  return l;
}

// Connects (pairing to the strongest wearable the first time) and returns the wearable's own token,
// or null for firmware that doesn't expose one yet (legacy MATCH-only firmware).
export async function connectWearable(): Promise<{ token: string | null }> {
  await askPermissions();
  await poweredOn();
  const id = (await storage.get('wearableId')) ?? (await findStrongest());
  const device = await manager
    .connectToDevice(id, { timeout: 10000 })
    .catch((e: unknown) => { void forgetWearable(); throw e; }); // stale saved id -> rescan next try
  await device.discoverAllServicesAndCharacteristics();
  await storage.set('wearableId', id);

  const token = await device.readCharacteristicForService(SERVICE_UUID, TOKEN_UUID)
    .then(c => (c.value ? atob(c.value).trim() : null), () => null);

  dropLink();
  link = {
    device,
    subs: [
      device.monitorCharacteristicForService(SERVICE_UUID, MATCH_UUID, (err, c) => {
        if (err || !c?.value) return;
        const msg = parseWearableMessage(atob(c.value));
        if (msg) messageHandlers.forEach(h => h(msg));
      }),
      device.onDisconnected(() => { link = null; disconnectHandlers.forEach(h => h()); }),
    ],
  };
  return { token: token && TOKEN_RE.test(token) ? token : null };
}

// Sign-out / re-pair: drop the link and forget the pairing. Listeners go first so the disconnect
// doesn't report "Wearable disconnected" to whoever uses the app next.
export async function disconnectWearable() {
  const l = dropLink();
  await l?.device.cancelConnection().catch(() => {});
  await forgetWearable();
}

// Best effort: older firmware has no state characteristic, and a missing display must never break the app.
export async function writeWearableState(state: WearableState) {
  const device = link?.device;
  if (!device) return;
  await device
    .writeCharacteristicWithResponseForService(SERVICE_UUID, STATE_UUID, btoa(state))
    .catch(() => {});
}

export const forgetWearable = () => storage.remove('wearableId');
