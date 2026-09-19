import { BleManager, Device, State, Subscription } from 'react-native-ble-plx';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { PermissionsAndroid, Platform } from 'react-native';

// Must match the ESP32 firmware (PHONE_SERVICE_UUID / MATCH_CHAR_UUID / BLEDevice::init name).
export const SERVICE_UUID = 'abcd1234-1234-1234-1234-abcdef123456';
export const MATCH_UUID = 'abcd1234-1234-1234-1234-abcdef123457'; // read/notify: "MATCH" | "IDLE"
const NAME = 'PassingStranger';

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

// The live connection and its listeners, so a sign-out can tear them down.
let link: { device: Device; subs: Subscription[] } | null = null;

export async function connectWearable(
  onSignal: (s: 'MATCH' | 'IDLE') => void,
  onDisconnect: () => void,
): Promise<Device> {
  await askPermissions();
  await poweredOn();
  const id = (await AsyncStorage.getItem('wearableId')) ?? (await findStrongest());
  const device = await manager
    .connectToDevice(id, { timeout: 10000 })
    .catch(e => { forgetWearable(); throw e; }); // stale saved id -> rescan next try
  await device.discoverAllServicesAndCharacteristics();
  await AsyncStorage.setItem('wearableId', id);

  link?.subs.forEach(s => s.remove());
  link = {
    device,
    subs: [
      device.monitorCharacteristicForService(SERVICE_UUID, MATCH_UUID, (err, c) => {
        if (err || !c?.value) return;
        const v = atob(c.value).trim();
        if (v === 'MATCH' || v === 'IDLE') onSignal(v);
      }),
      device.onDisconnected(() => onDisconnect()),
    ],
  };
  return device;
}

// Sign-out: a wearable belongs to one person, so drop the link and forget the pairing.
// Listeners go first so the disconnect doesn't report "Wearable disconnected" to the next player.
export async function disconnectWearable() {
  const l = link;
  link = null;
  l?.subs.forEach(s => s.remove());
  await l?.device.cancelConnection().catch(() => {});
  await forgetWearable();
}

export const forgetWearable = () => AsyncStorage.removeItem('wearableId');
