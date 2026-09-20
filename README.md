# SideQuests

SideQuests helps strangers who are physically near each other meet, and gives them something to do together. See
[OVERVIEW.md](OVERVIEW.md) for how the app looks and works end to end, and
[docs/firmware-protocol.md](docs/firmware-protocol.md) for the wearable.

```
mobile/   Expo / React Native app (talks only to our server)
server/   Node + Express API, importers, tests
db/       schema.sql (safe to re-run)
docs/     wearable firmware protocol
```

## WAT2DO event import

SideQuests can suggest real University of Waterloo events from [wat2do.ca](https://wat2do.ca) as side-quests.

```
WAT2DO ──(headless Chromium, on a schedule or on demand)──► our server ──► Postgres `quests` ──► our API ──► the app
```

- The **server** imports the events, normalises them, classifies them into the app's four archetypes and stores them in
  the existing `quests` table next to the seeded quests.
- The **mobile app never contacts WAT2DO** for data. It only calls our API. (It does open an event's page in the phone's
  browser when someone taps "View event details", and the event picture is loaded from WAT2DO's image host.)
- Imports run **manually** (a protected endpoint) or **on a schedule** (off by default). Nothing scrapes WAT2DO when a
  user asks for quests.
- Only **upcoming or in-progress** events are ever offered. Old events stay in the database for history and are never
  deleted automatically.

### Why a headless browser

I checked for a feed before writing a scraper:

| Source | Result |
|---|---|
| `https://wat2do.ca/rss.xml` | Exists, but **not usable**: a frozen snapshot from Oct–Nov 2025, no event dates, locations or descriptions, and 136 of 162 links go to Instagram. |
| `https://wat2do.ca/api/...` | Disallowed for crawlers in `robots.txt` (`Disallow: /api/`). **Not used.** |
| `sitemap.xml`, JSON feeds | Only static page URLs / no feed. |
| The event listing page | Rendered client-side (the HTML is an empty shell), so events only exist after JavaScript runs. |

So the importer loads the public page in headless Chromium the way a visitor would and scrolls it. It does **not** call
the `/api/`, and it does **not** fetch individual event pages (the listing carries everything we use), so it makes one page
load plus a few scrolls per import. It also blocks images, fonts and media to keep the load on WAT2DO small.

### Install

```bash
cd server
npm install                      # adds playwright, node-cron and cheerio
npx playwright install chromium  # one-time browser download (~100 MB)
```

On a Linux server, the browser needs system libraries too: `npx playwright install --with-deps chromium`.

### Database migration

There is no migration tool; `db/schema.sql` is written to be re-run safely and only adds things:

```bash
cd server
npm run db:init
```

This adds columns to `quests` (`source`, `source_id`, `source_url`, `organizer`, `starts_at`, `ends_at`, `price_text`,
`registration_required`, `image_url`, `external_category`, `archetype`, `last_seen_at`, `created_at`, `updated_at`) and a
unique index on `(source, source_id)`. The existing seeded quests are untouched.

### Environment variables (`server/.env`)

| Variable | Default | Meaning |
|---|---|---|
| `ADMIN_IMPORT_SECRET` | *(none)* | Secret for the manual import endpoint. Generate one with `openssl rand -hex 32`. **If it is unset, shorter than 16 characters, or the placeholder from `.env.example`, the endpoint is locked for everyone.** |
| `ENABLE_WAT2DO_IMPORT` | `false` | Scheduled imports run only when this is exactly `true`. |
| `WAT2DO_IMPORT_CRON` | `0 * * * *` | Schedule (hourly by default). An invalid expression is logged and nothing is scheduled. |
| `WAT2DO_BASE_URL` | `https://wat2do.ca` | Where to read the listing. See "If the markup changes" before changing it. |

### Run a manual import

Start the server, then:

```bash
curl -X POST http://localhost:3000/admin/import-wat2do \
  -H "Authorization: Bearer YOUR_ADMIN_IMPORT_SECRET"
```

```json
{ "discovered": 120, "inserted": 120, "updated": 0, "skipped": 0, "failed": 0 }
```

- `discovered`: event cards found on the page.
- `inserted` / `updated`: new events / events already stored (their details and `last_seen_at` are refreshed).
- `skipped`: cards that couldn't be used (no id or title) or duplicates.
- `failed`: events that could not be saved (each is logged; the others still import).

Responses: `401` for a missing or wrong secret, `409` if an import is already running, `502` (`{"error":"import failed"}`)
if WAT2DO or the database couldn't be read. Failure details are logged on the server and never returned to the caller.

### Scheduled imports

Set `ENABLE_WAT2DO_IMPORT=true` (and optionally `WAT2DO_IMPORT_CRON`) and restart the server. It runs the **same importer**
as the endpoint, never runs two imports at once (an overlapping tick is skipped), and a failed run is logged without
affecting the server. The schedule is off by default and starts nothing when disabled.

### Turn it off

- Scheduling: set `ENABLE_WAT2DO_IMPORT=false` (or remove it) and restart.
- The endpoint: leave `ADMIN_IMPORT_SECRET` unset.
- Imported events already in the database keep being offered until they end. To remove them entirely:
  `delete from quests where source = 'wat2do';`

### If the markup changes

WAT2DO's site is a third party's and can change without notice. Everything specific to it lives in
`server/services/wat2do.js`; the selectors are in one block at the top. What the parser relies on:

- an event card is an `<a href="/events/<number>">` that contains `[data-slot="card"]`;
- the title is `[data-slot="card-title"]`, the fields are rows in `[data-slot="card-content"]`;
- each row is identified by its **Lucide icon class** (`lucide-calendar`, `lucide-clock`, `lucide-map-pin`,
  `lucide-dollar-sign`), not by position or generated CSS classes;
- dates read like `Today`, `Tomorrow` or `Sunday Sep 20`; times like `2:00 p.m. - 8:30 p.m.`.

If the card markup changes, an import **fails loudly** (`markup not recognised`) instead of quietly importing nothing.
WAT2DO also appears to be moving to `wat2do.io`, whose server-rendered cards use different markup (`data-slot="event-card-*"`
and a different time format); pointing `WAT2DO_BASE_URL` there will need a matching parser change.

### Please be a good citizen

The importer identifies itself (`SideQuests-hackathon-importer/0.1`), reads only pages that `robots.txt` allows, and keeps
its volume low. When I checked, WAT2DO **published no terms of use or content policy**: its footer links only to Events,
Clubs, About, Contact and RSS, and `/terms` and `/privacy` don't exist. Its About page describes a small student-run
project (funded by WUSA's Student Life Endowment Fund) and its Contact page invites questions and feedback. So I can't
tell you what reuse they permit. Before relying on this beyond a demo:

- re-read whatever terms they publish, and follow their `robots.txt` and rate limits;
- ask the WAT2DO team (see their Contact page) for permission or an official feed. They are a small project and asking
  is both courteous and the surest way to stay welcome;
- keep the attribution ("Event from WAT2DO" and the link to the original page) that the app shows, and don't republish
  their content or images more widely than the app does. Images are loaded directly from WAT2DO's servers, not copied.

### Tests

```bash
cd server && npm test        # unit tests: no network, no browser, no database
cd server && npm run test:db # SQL tests against DATABASE_URL (writes and deletes 'wat2do-test' rows)
cd mobile && npm test && npx tsc --noEmit
```

The importer tests mock the scraper, and the parser tests use HTML built to mirror WAT2DO's card markup with made-up events.
