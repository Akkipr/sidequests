# SideQuests: what it is, how it looks, how it works

## The idea

SideQuests helps strangers who are physically near each other meet, and then gives them something to do together. Each person wears a small **ESP32 Bluetooth wearable** called "PassingStranger". When two wearables are close, each person's phone learns which wearable it saw. A server then decides whether the two people are compatible. If they are, both are offered a wave, and after a mutual wave they can pick a small local activity (a "sidequest"), like sharing dumplings or hunting murals, then start it and mark it complete together.

The wearable **never broadcasts who you are**. Identity only gets revealed after both people wave.

The core journey:

```
Discoverable → nearby player → mutual wave → choose quest → active quest → complete quest
```

## How it looks

It's a **retro 8-bit arcade UI**:

- **Font:** everything is set in *Press Start 2P*, a pixel font.
- **Colors** (from `mobile/src/components/pixel-ui/index.tsx`): dark navy background `#1b1b2f`, purple-grey panels `#2e2e4f`, cream text, and neon accents in gold, green, pink and cyan.
- **Panels:** hard-edged boxes with a 3px cream border and a solid black offset drop shadow, like an old game dialog.
- **Buttons:** coloured blocks with the same shadow. When pressed, they **sink into the shadow** by shifting 4px down and right. The main call to action (`START DISCOVERING` / `GO PRIVATE`) is a large button.
- **Chips:** toggle buttons that fill gold and get a `▶` marker when selected, so selection is never shown by colour alone.
- **Health bar:** a segmented 10-block bar, used for the compatibility score.
- **Blinking text:** the `useBlink` and `useTicker` hooks drive `SCANNING FOR PARTY_`, `! PLAYER NEARBY !` and `QUEST ACTIVE ■`. They stop blinking when the phone's **Reduce Motion** setting is on.
- **Game vocabulary:** "NEW PLAYER", "CHOOSE CLASS", "QUICK QUIZ", "PARTY PREFS", "START GAME", "GAME OVER" (the error screen), "CONTINUE?" (retry), "PARTY MEMBER JOINED", "★ points".
- **Accessibility:** buttons are at least 44pt tall, important controls have accessibility labels, status changes are announced, and the header respects the device's safe area.

The app is portrait-only, dark-mode-only and iPhone-only. `app.json` sets the bundle ID `com.sidequests.app1` (a developer signing with a free Apple ID may need to change it to something unique in Xcode).

## Navigation

There's a real navigator now (React Navigation). Every screen draws its own pixel-style header, so nothing looks like a stock tab bar.

```
Root stack
├─ (signed out)  Auth ─ Onboarding · SignIn
└─ (signed in)   Main tabs ─ Discover · Quests · Profile
                 Match        full-screen, presented above the tabs
                 QuestDetail  pushed from Discover or Quests
```

Which stack you see depends on the session: no valid token means `Auth`, a signed-in user gets `Main`.

## The user's journey, screen by screen

### 1. Boot (`mobile/App.tsx`, `features/auth/SessionProvider.tsx`)

- On launch the app loads the font. If there's no saved token it goes straight to onboarding with no network call. Otherwise it calls `GET /profile`.
- While waiting it shows **LOADING… / PRESS START**.
- If the server is unreachable it shows **GAME OVER / CAN'T REACH SERVER** with a hint to check `EXPO_PUBLIC_API_URL`, and a `CONTINUE?` retry button.
- If the server ever answers `401` (session revoked), the token is cleared and you land back on onboarding.
- **Discovery always starts private.** The app starts in the `private` state and tells the server `off`, so you're never accidentally visible, whatever the server last remembered.

### 2. Onboarding and sign in (`features/onboarding`, `features/auth`)

A four-stage wizard:

1. **NEW PLAYER:** type a nickname (max 24 characters), set a **password** (at least 8 characters, entered twice) and pick one of 8 emoji avatars (🧙 🥷 🧑‍🚀 🦊 🐸 🤖 👾 🐱).
2. **CHOOSE CLASS:** pick one or more archetypes: 🧭 Explorer, 🍜 Foodie, ⚡ Active, 🎨 Creator.
3. **QUICK QUIZ:** two short questions per class you picked, such as "Plan it or wing it?", "Spicy food?" or "Draw, photo or build?". Answers for a class you un-pick later are dropped, so they don't skew scoring.
4. **PARTY PREFS:** which archetypes you want to meet (none means anyone), and a budget of Free only, Cheap or Whatever.

**START GAME** creates the account and profile in one call (`POST /signup`), so an abandoned wizard leaves nothing behind. If the nickname is taken, you're sent back to stage 1.

Your **nickname is your login name**: unique (case-insensitive), visible to people you match with, and not editable afterwards. A **HAVE A PLAYER? SIGN IN** button on stage 1 opens the **SignIn** screen (nickname and password).

### 3. Discover (`features/discovery/DiscoverScreen.tsx`)

The first tab, focused on one job: being discoverable.

- **Primary button:** a large green **START DISCOVERING** while private, and a large pink **GO PRIVATE** while connecting or scanning. During a match it becomes **OPEN MATCH**, and during a quest it becomes **VIEW QUEST**.
- **Intent chips:** *Open to meeting*, *Looking for food*, *Free for the hour*.
- **Wearable row:** `■ NO SIGNAL`, `■ CONNECTING...`, `■ LINKED` or `▲ FAILED`, with **CONNECT WEARABLE** or **RETRY** when it isn't linked.
- **Status panel:** `YOU ARE INVISIBLE`, `LINKING WEARABLE...`, or a blinking `SCANNING FOR PARTY_` with a small radar animation.
- **Nearby SideQuest:** one suggested quest, if any.
- **Demo mode only:** a discreet **SIMULATE NEARBY PLAYER** button (see [Demo mode](#demo-mode)).

### 4. Match (`features/matches/MatchScreen.tsx`)

This screen opens above the tabs on its own when a match is detected, and closes itself when the match ends. Each stage matches a discovery state (see [The discovery state machine](#the-discovery-state-machine)).

1. **Candidate** (`! PLAYER NEARBY !`): a big compatibility percentage, the segmented bar, a generated sentence like *"You're both Foodies and Explorers, and you're both looking for food right now."*, and the shared archetype icons. You get **👋 WAVE** or **NOT NOW**. Nothing identifying is shown yet.
2. **Waiting** (`WAVE SENT`): polls the server every 3 seconds. **CANCEL WAVE** withdraws it. It gives up after 2 minutes, and leaving the screen also withdraws the wave.
3. **Party formed** (both waved): a "PARTY MEMBER JOINED" card with their avatar, nickname and classes, then **up to 3 sidequests** to choose from.
4. **Quest ready:** the chosen quest's details, **START QUEST**, and **SUGGEST ANOTHER** to swap it for the next one offered.

If they wave first and you decline, or the wave times out, you go back to scanning with a short message (*NOT THIS TIME. MORE QUESTS AWAIT.*). **BLOCK / REPORT** is available at every stage. It confirms first, and the other person is then never matched with you again.

### 5. Quests (`features/quests`)

The second tab. Everything here comes from the server (`GET /quests`), so **an active quest survives an app restart**.

- **Active quest:** in progress or picked-but-not-started, with **START QUEST** or **COMPLETE QUEST**.
- **Suggested nearby:** up to three quests you haven't done, ordered by your archetypes and respecting a "free only" budget.
- **Completed:** your history, with the date and who you did it with.
- Each section has an empty state.

**QuestDetail** shows the title, description, where, when, cost and how long it takes, plus **START QUEST**, **COMPLETE QUEST** (with a confirmation), or **SUGGEST ANOTHER**. Quests you haven't matched into can be read but not started. Points are awarded on completion; there is **no photo verification**.

### 6. Profile (`features/profile`)

The third tab.

- **Player card:** avatar, nickname, class icons and `★ points`.
- **Editable:** avatar, classes, quiz answers, who you want to meet and budget. `SAVE CHANGES` uses `PUT /profile`. The nickname is read-only.
- **Wearable:** its status, **CONNECT WEARABLE**, and **RE-PAIR WEARABLE**.
- **Privacy:** a short plain-language explanation.
- **Blocked players:** shown anonymously (you can block someone before they reveal themselves), with **UNBLOCK**.
- **SIGN OUT:** confirms, disconnects and forgets the wearable, ends the session on the server, and returns to onboarding.

## The discovery state machine

Discovery is one typed state machine in `mobile/src/state/discoveryMachine.ts`. It's pure TypeScript, so it's unit-tested directly.

```
 private ─▶ connecting ─▶ scanning ─▶ candidate_detected ─▶ waiting_for_wave ─▶ matched
                                                                                   │
                                            private ◀── quest_active ◀── quest_selected
```

- The reducer **refuses contradictory states**. For example, it never scans without a linked wearable (demo mode is the one exception), never has a quest active without a selected quest, and never keeps a resolved match polling.
- Everything with a side effect is **derived from the state**, so it can't outlive it: only `waiting_for_wave` polls, only `scanning` listens to the wearable, and the server's discoverability flag is on only while scanning or mid-wave.
- `features/discovery/DiscoveryProvider.tsx` turns state into effects (BLE connection and signals, polling with a timeout, the server flag, and opening or closing the Match screen) and cleans all of them up.

## How it works end to end

```
 Wearable A ──BLE──► Phone A ──POST /signal { peer token }──┐
                                                            ├─► Server ──► Postgres (Tiger Data)
 Wearable B ──BLE──► Phone B ──POST /signal { peer token }──┘        │
                                                                     ▼
                       phones get matchId → GET /matches/:id → wave → reveal → quest
```

1. **Pairing the wearable.** When you start discovering (or press **CONNECT WEARABLE**), the app scans over BLE for a device named `PassingStranger` (or one advertising the service UUID `abcd1234-…3456`). It picks the strongest signal, on the theory that it's the one on your wrist, and saves the device ID in AsyncStorage so later launches reconnect directly.
2. **Linking it to your account.** The app reads the wearable's own **token** from a characteristic and sends it to `POST /wearables/link`. The token, not the phone's BLE ID, is the wearable's identity. (Firmware that doesn't expose a token yet works only in demo mode.)
3. **Proximity signal.** The wearable notifies `NEAR:<peer-token>:<rssi>` when it sees another wearable and `IDLE` when it's out of range. The old `MATCH` message is still parsed but is legacy (see below).
4. **Asking the server.** On `NEAR`, the phone calls `POST /signal` with `{ detectedWearableToken, rssi, timestamp }`. It only does this while it's in the `scanning` state.
5. **Exact-peer matching** (`server/services/matching.js`). The server resolves the token to a user and then, for **that pair only**, checks in order: not blocked, both people discoverable, then any match for the same pair in the last hour (which is reused). Only if none exists does it score the pair. It never looks at anyone else's signals.
6. **Scoring** (`server/services/scoring.js`), out of 100:
   - 40% shared interests (half archetype overlap, half quiz-answer agreement)
   - 30% preference alignment (who you each want to meet)
   - 20% availability (same status scores 1.0, one side "open" scores 0.7, otherwise 0.3)
   - 10% budget fit
   - **Hard rules:** if either person is "off", or either person's "want to meet" list excludes the other's archetypes, there is no match. A score below **70** also isn't a match.
7. **Creating the match.** If they pass, the server picks 3 quests. It prefers ones tagged with the shared archetypes, and only free ones if either person's budget is "free". It stores the match with `user_a < user_b` so both phones converge on the same row.
8. **Wave and reveal.** Each side records `a_response` or `b_response` (true means wave, false means not now). A wave can be withdrawn until the match resolves. `GET /matches/:id` returns the other person's nickname, avatar, archetypes **and the quests** only when **both** have waved.
9. **Quest progress.** Either player can pick a quest (`selected`), start it (`active`) and complete it (`completed`), stored on the match. Every step is idempotent. Completing pays both players **50 points, exactly once**, in a single SQL statement, so repeated or simultaneous requests can't pay twice. Only one quest can be active per person at a time.

**Legacy time-window pairing.** The original firmware sends a bare `MATCH` with no identity. For that, the server pairs you with anyone who reported a signal in the last 20 seconds, and the phone retries every 3 seconds for about 20 seconds. Two separate pairs meeting at once can be crossed, so this path is **demo-only**: the server accepts it only when `DEMO_MODE=true` and otherwise answers `403`.

## Demo mode

Hardware and venue Bluetooth can fail, so there's a demo mode. It's off by default and needs **both** flags:

- `DEMO_MODE=true` in `server/.env` (or the environment)
- `EXPO_PUBLIC_DEMO_MODE=true` in `mobile/.env` (restart Metro with `--clear` after changing it)

With it on:

- Discovery can run **without a wearable**.
- A **SIMULATE NEARBY PLAYER** button appears while scanning. It calls `POST /demo/nearby`, and the server creates a match with a throwaway simulated player (never a login, deleted with you). That player waves back about 6 seconds after it appears, so the waiting stage is visible.
- The whole match, quest and completion flow works with no hardware.
- The legacy `MATCH` signal is accepted, so the current firmware keeps working.

With it off, the demo route isn't mounted (`404`) and the demo control isn't rendered.

## Code structure

```
sidequests/
├── mobile/                  Expo SDK 57 / React Native 0.86 / React 19, TypeScript
│   ├── App.tsx              Loads the font, mounts providers and the root navigator
│   ├── index.ts             Entry point
│   ├── app.json             Config (BLE plugin, dark UI, bundle IDs)
│   ├── .env                 EXPO_PUBLIC_API_URL (the tunnel URL), EXPO_PUBLIC_DEMO_MODE
│   ├── scripts/patch-xcode26.sh   postinstall patch for older Xcode (safe to re-run)
│   ├── ios/                 Generated native project (dev-client build)
│   └── src/
│       ├── app/             navigation/ (root stack, tabs, theme), providers/
│       ├── components/pixel-ui/   Design system: colours, Txt, Panel, Btn, Chip, Bar, Field…
│       ├── constants/       Archetypes, quiz questions, avatars, intents
│       ├── features/        auth · onboarding · discovery · matches · quests · profile
│       ├── services/        api.ts (typed client), ble.ts, wearableMessage.ts, storage.ts
│       ├── state/           discoveryMachine.ts (the lifecycle) and its tests
│       ├── types/           Shared API types
│       └── config.ts        API URL and demo-mode flag
├── server/                  Node + Express 5 + pg
│   ├── index.js             App setup only
│   ├── routes/              HTTP routes (thin)
│   ├── services/            matching, quests, accounts, demo, scoring, validation
│   ├── repositories/        All SQL
│   ├── middleware/          Auth (sessions) and error handling
│   ├── container.js         Wires repositories into services
│   ├── test/                Unit tests (in-memory fakes, no database)
│   ├── timescale-ca.pem     CA cert for the DB connection
│   └── .env                 DATABASE_URL, PORT, DEMO_MODE (optional)
├── db/schema.sql            Tables, hypertable, seed quests (re-runnable upgrades)
└── docs/firmware-protocol.md   What the wearable firmware must send
```

**API routes** (all need a session token except `POST /signup` and `POST /login`):

| Area | Routes |
|---|---|
| Accounts | `POST /signup`, `POST /login`, `POST /logout` |
| Profile | `GET`/`PUT /profile`, `POST /status` |
| Proximity | `POST /signal`, `POST /wearables/link`, `GET`/`DELETE /wearables` |
| Matches | `GET /matches/:id`, `POST /matches/:id/respond`, `POST /matches/:id/block` |
| Quests | `GET /quests`, `POST /matches/:id/quest`, `POST /matches/:id/quest/start`, `POST /matches/:id/quest/complete` |
| Blocks | `GET /blocks`, `DELETE /blocks/:id` |
| Demo only | `POST /demo/nearby` (mounted only when `DEMO_MODE=true`) |

**Auth:** accounts use a nickname and password. The password is hashed with `scrypt` and a per-user salt. `/signup` and `/login` return a random 32-byte session token, which the phone keeps in AsyncStorage and sends as a `Bearer` token. The server stores only the **SHA-256 hash** of it, in `sessions`, so signing out really revokes it. There is no password recovery or change-password.

**Database** (Postgres on Tiger Data with TimescaleDB):

- `users`: id, password hash and the lowercase login name. Rows from before accounts existed (a legacy device key) can't be signed into. `demo_owner` marks simulated demo players.
- `sessions`: one row per signed-in device.
- `profiles`: nickname, avatar, archetypes, quiz answers, wants, budget, status, points.
- `quests`: 8 seeded ones (Dumpling Dash, Snack Swap, Sunset Loop, Hidden Mural Hunt, Pickup Frisbee, Climbing Taster, Sketch & Sip, Hack Night Demo).
- `matches`: the pair, score, reason, shared archetypes, offered quest IDs, both responses, and the chosen quest with its status and started/completed times.
- `wearables`: one wearable token per account.
- `blocks`: who blocked whom.
- `proximity_events`: a Timescale **hypertable**, an RSSI/time log of every signal (with the detected peer for exact-peer signals).

## Running it locally

1. `npm install` in `mobile/` and `server/`, then `cd server && npm run db:init` (safe to re-run; it also upgrades older databases).
2. `cd server && npm start` runs the API on `:3000`. Add `DEMO_MODE=true` in front for a hardware-free demo or the current firmware.
3. `cd server && npx cloudflared tunnel --url http://localhost:3000` exposes it. Put the printed `https://….trycloudflare.com` URL in `mobile/.env` as `EXPO_PUBLIC_API_URL`. The URL changes every time `cloudflared` restarts.
4. `cd mobile && npx expo start --clear --dev-client` runs Metro. The app itself is a native dev build (`npx expo run:ios --device`, which needs Xcode 27 or a recent enough Xcode for Swift 6.2 or later, and CocoaPods). Expo Go won't work because of `react-native-ble-plx` and the native navigation modules.

**Tests:** `cd server && npm test` (matching, pairing, quests, demo), `cd mobile && npm test` (discovery state machine and the wearable message parser) and `cd mobile && npx tsc --noEmit`.

The iOS simulator has no Bluetooth, so the real wearable features need a physical iPhone. Demo mode works without one.

## Known gaps and shortcuts

- **The wearable firmware isn't in this repo.** `docs/firmware-protocol.md` specifies the messages and the token it must provide, but nothing there has been verified against real hardware. Until the firmware sends `NEAR` and exposes a token, real matching only works through legacy `MATCH` in demo mode.
- **Wearable tokens are effectively public to nearby phones,** and linking is "last link wins", so someone who reads your token could link it to their own account. The doc describes the fix (a separate secret link token).
- **Legacy time-window pairing** can cross two pairs that meet at the same time, so it's gated behind `DEMO_MODE`. Don't run a real deployment with demo mode on.
- **The simulated player's wave is an in-process timer.** Restarting the server within about 6 seconds of a simulation drops it.
- **Quests aren't location-aware.** They're a small seeded list, "suggested nearby" is ordered by your archetypes, and there's no photo verification.
- **No password recovery, and no rate limiting on login.**
- **`timestamp` on a signal is accepted but not enforced.**
- **No linter is configured,** and the mobile UI has no automated tests beyond the state machine and message parser.
