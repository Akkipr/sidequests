// Pure parsing of what the wearable notifies (see docs/firmware-protocol.md). Kept free of native imports so it
// can be unit-tested. ble.ts re-exports these.

// ':' separates fields in NEAR messages, so it can never appear inside a token (the server enforces the same).
export const TOKEN_RE = /^[A-Za-z0-9_.-]{4,128}$/;

export type WearableMessage =
  | { kind: 'near'; token: string; rssi: number } // exact peer (new firmware)
  | { kind: 'legacy_match' }                      // LEGACY: "someone is near", no identity (demo only on the server)
  | { kind: 'idle' }
  | { kind: 'wave' }                             // the wearable's own buttons answered a pending match
  | { kind: 'pass' };

export function parseWearableMessage(raw: string): WearableMessage | null {
  const v = raw.trim();
  if (v === 'IDLE') return { kind: 'idle' };
  if (v === 'MATCH') return { kind: 'legacy_match' };
  if (v === 'WAVE') return { kind: 'wave' };
  if (v === 'PASS') return { kind: 'pass' };
  const m = /^NEAR:([A-Za-z0-9_.-]{4,128}):(-?\d{1,3})$/.exec(v);
  return m ? { kind: 'near', token: m[1], rssi: Number(m[2]) } : null;
}
