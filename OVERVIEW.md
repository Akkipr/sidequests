# SideQuests: what it is, how it looks, how it works

## The idea

SideQuests helps strangers who are physically near each other meet, and then gives them something to do together. Each person wears a small **ESP32 Bluetooth wearable** called "PassingStranger". When two wearables are close, each person's phone learns "someone is near". A server then decides whether the two people are compatible. If they are, both are offered a wave, and after a mutual wave they can pick a small local activity (a "sidequest"), like sharing dumplings or hunting murals.

The wearable **never broadcasts who you are**. Identity only gets revealed after both people wave.

## How it looks

It's a **retro 8-bit arcade UI**:

- **Font:** everything is set in *Press Start 2P*, a pixel font.
- **Colors** (from `mobile/src/ui.tsx`): dark navy background `#1b1b2f`, purple-grey panels `#2e2e4f`, cream text, and neon accents in gold, green, pink and cyan.
- **Panels:** hard-edged boxes with a 3px cream border and a solid black offset drop shadow, like an old game dialog.
- **Buttons:** coloured blocks with the same shadow. When pressed, they **sink into the shadow** by shifting 4px down and right.
- **Chips:** toggle buttons that fill gold and get a `▶` marker when selected.
- **Health bar:** a segmented 10-block bar, used for the compatibility score.
- **Blinking text:** a shared `useBlink` hook drives `SCANNING FOR PARTY_`, `! PLAYER NEARBY !` and `QUEST ACTIVE ■`.
- **Game vocabulary:** "NEW PLAYER", "CHOOSE CLASS", "QUICK QUIZ", "PARTY PREFS", "START GAME", "GAME OVER" (the error screen), "CONTINUE?" (retry), "PARTY MEMBER JOINED", "★ points".

The app is portrait-only, dark-mode-only and iPhone-only, with bundle ID `com.sidequests.app1`.

## The user's journey, screen by screen

### 1. Boot (`mobile/App.tsx`)

- On launch the app loads the font, then calls `GET /profile`.
- While waiting it shows **LOADING… / PRESS START**.
- If the server is unreachable it shows **GAME OVER / CAN'T REACH SERVER** with a hint to check `EXPO_PUBLIC_API_URL`, and a `CONTINUE?` retry button.
- Discovery is reset to **off** on every launch, so you're never accidentally visible.

### 2. Onboarding (`mobile/src/screens/Onboarding.tsx`)

A four-stage wizard:

1. **NEW PLAYER:** type a nickname (max 24 characters) and pick one of 8 emoji avatars (🧙 🥷 🧑‍🚀 🦊 🐸 🤖 👾 🐱).
2. **CHOOSE CLASS:** pick one or more archetypes: 🧭 Explorer, 🍜 Foodie, ⚡ Active, 🎨 Creator.
3. **QUICK QUIZ:** two short questions per class you picked, such as "Plan it or wing it?", "Spicy food?" or "Draw, photo or build?". Answers for a class you un-pick later are dropped, so they don't skew scoring.
4. **PARTY PREFS:** which archetypes you want to meet (none means anyone), and a budget of Free only, Cheap or Whatever.

Then **START GAME** saves the profile with `POST /profile`.

### 3. Home (`mobile/src/screens/Home.tsx`)

Four panels:

- **Player card:** avatar, nickname, archetype icons, and a `★ points` counter.
- **Wearable status:** `NO SIGNAL`, `SEARCHING...`, `LINKED` or `LINK FAILED`, with a `CONNECT` button when it's not linked.
- **Discovery:** chips for *Open to meeting*, *Looking for food* and *Free for the hour*, plus a pink **GO PRIVATE** button.
- **Scanner banner:** it reads `SCANNING FOR PARTY_` (blinking) only when the wearable is linked and your status is not off. Otherwise it says `YOU ARE INVISIBLE` or `LINK WEARABLE TO SCAN`.

### 4. Match (`mobile/src/screens/Match.tsx`)

This screen opens on its own when a match is detected while you're on Home.

- The title blinks `! PLAYER NEARBY !`.
- **Compatibility panel:** a big percentage, the segmented bar, and a generated sentence like *"You're both Foodies and Explorers, and you're both looking for food right now."* It also shows the shared archetype icons.
- **Pending state:** you get **👋 WAVE** or **NOT NOW**. After you wave it shows `WAITING FOR THEM TO WAVE BACK...` and polls the server every 3 seconds.
- **Declined:** *NOT THIS TIME. MORE QUESTS AWAIT.*
- **Revealed** (both waved): a "PARTY MEMBER JOINED" card with their avatar, nickname and classes, then **up to 3 sidequests** to choose from.
- **BLOCK / REPORT** is always available. It confirms first, and the other person is then never matched with you again.

### 5. Quest (`mobile/src/screens/Quest.tsx`)

- Shows the title, description, and where, when, cost and how long it takes.
- **START QUEST** flips it to a blinking `QUEST ACTIVE`, with the text "Meet at <location>. Photo check-in unlocks points."
- **◀ SUGGEST ANOTHER** goes back to the match's quest list.

There's no router library. `App.tsx` holds a small state object (`home | match | quest`) and renders the matching screen.

## How it works end to end

```
 Wearable A ──BLE──► Phone A ──POST /signal──┐
                                             ├─► Server ──► Postgres (Tiger Data)
 Wearable B ──BLE──► Phone B ──POST /signal──┘        │
                                                      ▼
                         both phones get matchId → GET /matches/:id → wave → reveal
```

1. **Pairing the wearable.** After a profile exists, the app scans over BLE for a device named `PassingStranger` (or one advertising the service UUID `abcd1234-…3456`). It picks the strongest signal, on the theory that it's the one on your wrist. It saves the device ID in AsyncStorage, so later launches reconnect directly. If the saved ID is stale it rescans.
2. **Proximity signal.** The wearable notifies a BLE characteristic with `"MATCH"` when it sees another wearable and `"IDLE"` when it's out of range.
3. **Asking the server.** On `MATCH`, the phone calls `POST /signal`. It retries every 3 seconds for about 20 seconds, because the other person's phone may report a few seconds later. It only does this while your discovery status isn't off.
4. **Pairing the phones.** The server logs the signal in `proximity_events`, then looks for **any other user who signalled in the last 20 seconds**. For each candidate it runs the matching logic below.
5. **Scoring** (`server/score.js`), out of 100:
   - 40% shared interests (half archetype overlap, half quiz-answer agreement)
   - 30% preference alignment (who you each want to meet)
   - 20% availability (same status scores 1.0, one side "open" scores 0.7, otherwise 0.3)
   - 10% budget fit
   - **Hard rules:** if either person is "off", or either person's "want to meet" list excludes the other's archetypes, there is no match. A score below **70** also isn't a match.
6. **Creating the match.** If they pass, the server picks 3 quests. It prefers ones tagged with the shared archetypes, and only free ones if either person's budget is "free". It stores the match with `user_a < user_b` so both phones converge on the same row. An existing match for the same pair within the last hour is reused.
7. **Wave and reveal.** Each side records `a_response` or `b_response` (true means wave, false means not now). `GET /matches/:id` only returns the other person's nickname, avatar and archetypes when **both** have waved.

## Code structure

```
sidequests/
├── mobile/                  Expo SDK 57 / React Native 0.86 / React 19, TypeScript
│   ├── App.tsx              Root: boot, routing state, BLE signal loop
│   ├── index.ts             Entry point
│   ├── app.json             Config (BLE plugin, dark UI, bundle IDs)
│   ├── .env                 EXPO_PUBLIC_API_URL (the tunnel URL)
│   ├── scripts/patch-xcode26.sh   postinstall patch for older Xcode
│   ├── ios/                 Generated native project (dev-client build)
│   └── src/
│       ├── api.ts           fetch wrapper: 10s timeout, Bearer device key, types
│       ├── ble.ts           react-native-ble-plx: scan, connect, monitor
│       ├── archetypes.ts    Archetypes, quiz questions, avatars, statuses
│       ├── ui.tsx           Design system: colours, Txt, Panel, Btn, Chip, Bar…
│       └── screens/         Onboarding, Home, Match, Quest
├── server/                  Node + Express 5 + pg
│   ├── index.js             All routes, auth middleware, match logic (131 lines)
│   ├── score.js             Scoring function + self-test (`npm test`)
│   ├── timescale-ca.pem     CA cert for the DB connection
│   └── .env                 DATABASE_URL, PORT
└── db/schema.sql            Tables, hypertable, seed quests
```

**API routes:** `POST /register`, `GET`/`POST /profile`, `POST /status`, `POST /signal`, `GET /matches/:id`, `POST /matches/:id/respond`, `POST /matches/:id/block`.

**Auth:** there are no accounts or passwords. On first launch the phone calls `/register`, gets a random 32-byte key and stores it in AsyncStorage. The server stores only the **SHA-256 hash** of that key. Every later request sends it as a `Bearer` token.

**Database** (Postgres on Tiger Data with TimescaleDB):

- `users`: id and key hash.
- `profiles`: nickname, avatar, archetypes, quiz answers, wants, budget, status, points.
- `quests`: 8 seeded ones (Dumpling Dash, Snack Swap, Sunset Loop, Hidden Mural Hunt, Pickup Frisbee, Climbing Taster, Sketch & Sip, Hack Night Demo).
- `matches`: the pair, score, reason, shared archetypes, quest IDs, both responses.
- `blocks`: who blocked whom.
- `proximity_events`: a Timescale **hypertable**, an RSSI/time log of every signal.

## Running it locally

Three terminals:

1. `cd server && npm start` runs the API on `:3000`.
2. `cd server && npx cloudflared tunnel --url http://localhost:3000` exposes it. Put the printed `https://….trycloudflare.com` URL in `mobile/.env` as `EXPO_PUBLIC_API_URL`. The URL changes every time `cloudflared` restarts.
3. `cd mobile && npx expo start --clear --dev-client` runs Metro. The app itself is a native dev build (`npm run ios`, which needs Xcode 27 or a recent enough Xcode for Swift 6.2 or later). Expo Go won't work because of `react-native-ble-plx`.

The iOS simulator has no Bluetooth, so the wearable features need a physical iPhone.

## Known gaps and shortcuts

- **The wearable firmware isn't in this repo.** `mobile/src/ble.ts` says the UUIDs must match the ESP32 firmware, which lives elsewhere. Without a real wearable, you can't get past "NO SIGNAL" and the Match screen can't trigger.
- **Time-window pairing is a known shortcut.** The code marks it with a `ponytail:` comment. If two separate pairs meet within the same 20 seconds, matches can get crossed. The stated fix is rotating per-user tokens advertised by the wearable.
- **Points don't do anything yet.** `★ points` always shows what's in the DB (0 at the start). "Photo check-in unlocks points" is only text, and no route awards points.
- **`START QUEST` is local only.** It just changes on-screen state and isn't sent to the server.
- **No profile editing or logout.** Once onboarding is done, the only way to change your profile is to call the API directly.
- **Fixed top padding.** `Screen` uses 64px of top padding instead of safe-area handling, with a `ponytail:` comment saying to change it if notches clip the title.
