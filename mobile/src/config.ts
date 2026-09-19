// EXPO_PUBLIC_* values are inlined at bundle time, so restart Metro with --clear after changing .env.
export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://192.168.1.10:3000';

// Demo mode (must match DEMO_MODE on the server): shows "SIMULATE NEARBY PLAYER" and lets discovery run
// without a wearable. Off by default; when off, none of the demo UI is rendered.
export const DEMO_MODE = process.env.EXPO_PUBLIC_DEMO_MODE === 'true';
