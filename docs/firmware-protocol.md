# Wearable firmware protocol

> **Status: implemented.** The firmware lives in `firmware/esp32_wearable/` (wearable) and
> `firmware/uno_display/` (LCD display). It implements everything below, but has **not yet been verified on
> real hardware** — the RSSI thresholds in particular need tuning on the actual boards.

## Why this changed

The original firmware sends a bare `MATCH` when two wearables are close. It carries no identity, so the server
could only pair you with *whoever else reported a signal in the last 20 seconds*. Two separate pairs meeting at
once could be cross-matched. Exact pairing needs each wearable to identify itself, and the phone to report
**which** wearable it saw.

## BLE service

The wearable is a BLE peripheral that a phone connects to (GATT). It advertises the name `PassingStranger` and
the service UUID below.

| Item | UUID | Properties | Value |
|---|---|---|---|
| Service | `abcd1234-1234-1234-1234-abcdef123456` | | |
| **Match characteristic** | `abcd1234-1234-1234-1234-abcdef123457` | read, **notify** | UTF-8 message (see below) |
| **Token characteristic** *(new)* | `abcd1234-1234-1234-1234-abcdef123458` | read | UTF-8 string: this wearable's own token |
| **State characteristic** *(new)* | `abcd1234-1234-1234-1234-abcdef123459` | write | `NONE` \| `CANDIDATE` \| `WAITING` \| `MATCHED`: what the phone is showing, so the wearable's display can prompt |

Values are written as raw UTF-8 bytes; the phone base64-decodes them and trims whitespace.

## The wearable token

* A string matching `^[A-Za-z0-9_.-]{4,128}$`. It **must not contain `:`**, because `:` separates fields in `NEAR`.
* **Unique per wearable and stable** (e.g. derived from the chip's factory ID). Use at least 8 random-looking
  characters; short tokens are guessable.
* The wearable serves it on the Token characteristic (read). It is also what the wearable announces to nearby
  wearables so that they can report it (see below).
* **It is not the phone's BLE device identifier.** iOS randomises those and they change between phones and
  reinstalls; the server never stores them.

### How it gets linked to an account

1. The phone connects to its own wearable and reads the Token characteristic.
2. The phone calls `POST /wearables/link` with `{ "wearableToken": "<token>" }` (authenticated).
3. The server stores one wearable per account (`wearables` table). Linking a token that another account holds
   moves it to the latest account ("last link wins").

## Messages (Match characteristic, notify)

| Message | Meaning |
|---|---|
| `NEAR:<peer-token>:<rssi>` | *New.* This wearable detected another wearable. `<peer-token>` is the **other** wearable's token; `<rssi>` is a signed integer in dBm (e.g. `NEAR:x7Kp2mQ9:-57`). |
| `IDLE` | Nothing is nearby any more. |
| `WAVE` / `PASS` | The wearable's own buttons answered a pending match. The app treats these exactly like tapping Wave / Not now, and ignores them unless a candidate is open. |
| `MATCH` | **LEGACY.** "Someone is near", no identity. Still parsed by the app, but see below. |

Guidance for firmware:

* Send `NEAR` once when a peer first comes into range, and again only if the peer leaves and returns (or at most
  every ~10 s). The app rate-limits per token, but don't rely on that.
* Send `IDLE` when the last peer is lost.
* How the wearable learns a peer's token is up to the firmware. The ESP32 firmware here puts it in the
  **advertisement**, so no connection between wearables is needed:

  | Part | Bytes | Value |
  |---|---|---|
  | Advert: flags | 3 | `0x06` (LE general discoverable) |
  | Advert: manufacturer data | 21 | `FF FF` (unregistered company id) + `SQ1` (magic) + the token |
  | Scan response: complete local name | 17 | `PassingStranger`, which is how the phone finds its wearable |

  The token is `PS` + the chip's 6-byte MAC in hex (e.g. `PSA4CF12B39D01`): unique per board, stable across
  reboots, and never contains `:`. Advertising is restarted when a phone connects, because the ESP32 stops it
  by default — otherwise a wearable would go invisible to its peers exactly while its owner's phone is linked.

## What the phone sends the server

On `NEAR:<peer-token>:<rssi>`:

```http
POST /signal
Authorization: Bearer <session token>
{ "detectedWearableToken": "<peer-token>", "rssi": -57, "timestamp": 1790000000 }
```

The server then, for that exact pair only: resolves the token to a user → checks blocks → checks both people are
discoverable → scores them → creates (or returns) the match. It never looks at anyone else's signals. While a pair's
match is still **open** (nobody has said no, it isn't revealed yet, and it is under 10 minutes old) a signal returns that
same match, so two phones that detect each other at the same moment end up in one match. Once it is declined or revealed
the pair can be matched again immediately: there is no cooldown between meetings.

Response: `{ "matchId": 12 }`, `{ "matchId": null }`, or `{ "matchId": null, "reason": "unknown_wearable" }` if the
token isn't linked to any account.

## Legacy `MATCH` signals

`MATCH` sends `POST /signal` with an empty body, which the server pairs by **time window** (anyone who reported in
the last 20 s). This is **legacy / demo-only**: the server accepts it **only when `DEMO_MODE=true`** and otherwise
replies `403 legacy signals are disabled`. It exists so the current firmware keeps working for demos until the
firmware is updated. Do not rely on it in a real deployment.

## Known limits and recommended hardening

* **Tokens are effectively public to anyone nearby**, because peers must learn them. Since linking is "last link
  wins", someone who reads your token could link it to their own account and receive your matches. Recommended:
  give each wearable a *public broadcast ID* (what `NEAR` carries) and a separate *secret link token* (what the
  Token characteristic returns, only readable while connected), and link with the secret. The current server takes
  a single token, as specified; splitting them is a small change on both sides.
* `timestamp` is accepted but not enforced. Add a freshness window if replayed signals become a concern.
* Nothing here is encrypted beyond standard BLE link security.

## Display link (ESP32 <-> Arduino UNO R4)

Local to one person's kit, over the wearable's own Wi-Fi AP by UDP. The server and app never see it.

* Wearable -> display, once a second: `S:<phone linked>:<peers near>:<best rssi>:<match state 0-3>:<range>:<brightness>:<buzzer>:<encounters>`, and `I:<token>` in reply to `HELLO`.
* Display -> wearable: `HELLO` (boot and keepalive), `WAVE`, `PASS`, `SET:ENTER:<dBm>`, `SET:BRIGHT:<pct>`, `SET:BUZZ:<0|1>`.

Settings live on the wearable (saved to flash, clamped there as well as on the display), so a display reflashed
with something else cannot push the wearable into a state where matching never fires.
