-- SideQuests schema for Tiger Data (Postgres + TimescaleDB).
-- Run once:  psql "$DATABASE_URL" -f db/schema.sql

create table if not exists users (
  id            uuid primary key default gen_random_uuid(),
  key_hash      text unique,                -- legacy anonymous device key (unused since accounts)
  password_hash text,                       -- scrypt "salt:hash" (hex)
  nickname_key  text unique,                -- lower(nickname), the login name; null for legacy users
  created_at    timestamptz not null default now()
);
-- Upgrade path for databases created before accounts existed.
alter table users alter column key_hash drop not null;
alter table users add column if not exists password_hash text;
alter table users add column if not exists nickname_key text unique;
-- Demo mode only: a simulated nearby player owned by (and deleted with) a real user. Never a login.
alter table users add column if not exists demo_owner uuid references users on delete cascade;

-- One row per signed-in device; signing out deletes the row.
create table if not exists sessions (
  token_hash text primary key,              -- sha256 of the bearer token the phone holds
  user_id    uuid not null references users on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists profiles (
  user_id    uuid primary key references users on delete cascade,
  nickname   text not null,
  avatar     text not null,
  archetypes text[] not null,
  answers    jsonb not null default '{}',   -- { "foodie_spicy": "yes", ... }
  wants      text[] not null default '{}',  -- archetypes they want to meet; empty = anyone
  budget     text not null default 'low' check (budget in ('free','low','any')),
  status     text not null default 'off' check (status in ('off','open','food','hour')),
  points     int  not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists quests (
  id          serial primary key,
  title       text not null,
  description text not null,
  location    text not null,
  starts      text not null,
  cost        text not null,
  free        boolean not null default false,
  minutes     int not null,
  tags        text[] not null
);

create table if not exists matches (
  id         bigint generated always as identity primary key,
  user_a     uuid not null references users on delete cascade,
  user_b     uuid not null references users on delete cascade,
  score      int  not null,
  reason     text not null,
  shared     text[] not null,
  quest_ids  int[] not null,
  a_response boolean,                        -- null = no answer yet, true = wave, false = not now
  b_response boolean,
  created_at timestamptz not null default now(),
  check (user_a < user_b)
);
create index if not exists matches_pair on matches (user_a, user_b, created_at desc);

create table if not exists blocks (
  blocker    uuid not null references users on delete cascade,
  blocked    uuid not null references users on delete cascade,
  reason     text,
  created_at timestamptz not null default now(),
  primary key (blocker, blocked)
);

-- A wearable is linked to one account by the token its firmware provides (never the phone's BLE id).
create table if not exists wearables (
  id             bigint generated always as identity primary key,
  user_id        uuid not null unique references users on delete cascade,
  wearable_token text not null unique,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- Quest progress lives on the match (the two people share one quest).
alter table matches add column if not exists quest_id int references quests;
alter table matches add column if not exists quest_status text check (quest_status in ('selected','active','completed'));
alter table matches add column if not exists quest_started_at timestamptz;
alter table matches add column if not exists quest_completed_at timestamptz;

-- Time-series: every MATCH signal the wearables report (RSSI log).
create table if not exists proximity_events (
  time         timestamptz not null default now(),
  user_id      uuid not null,
  peer_user_id uuid,
  rssi         int
);
select create_hypertable('proximity_events', by_range('time'), if_not_exists => true);

-- Imported events (WAT2DO). Seeded quests leave `source` null; imported ones fill these in. Re-runnable.
alter table quests add column if not exists source text;
alter table quests add column if not exists source_id text;
alter table quests add column if not exists source_url text;
alter table quests add column if not exists organizer text;
alter table quests add column if not exists starts_at timestamptz;              -- real start; `starts` stays the display text
alter table quests add column if not exists ends_at timestamptz;
alter table quests add column if not exists price_text text;
alter table quests add column if not exists registration_required boolean not null default false;
alter table quests add column if not exists image_url text;
alter table quests add column if not exists external_category text;
alter table quests add column if not exists archetype text;
alter table quests add column if not exists last_seen_at timestamptz;
alter table quests add column if not exists created_at timestamptz not null default now();
alter table quests add column if not exists updated_at timestamptz not null default now();
-- One row per external event. Nulls are distinct, so any number of seeded quests (source null) coexist.
create unique index if not exists quests_source_source_id on quests (source, source_id);
create index if not exists quests_upcoming on quests (starts_at) where source is not null;

-- Seed quests (replace with real partner deals/events).
insert into quests (title, description, location, starts, cost, free, minutes, tags)
select * from (values
  ('Dumpling Dash',    'Split a plate of dumplings and rate the sauces.', 'Food court, 2nd floor', 'Now',        '$8 each (10% off with SideQuests)', false, 45, array['foodie']),
  ('Snack Swap',       'Each grab a snack the other has never tried.',    'Campus convenience store', 'Now',   'Under $5', false, 20, array['foodie','explorer']),
  ('Sunset Loop',      'Walk the park loop and find the best photo spot.', 'Park main entrance',    'In 1 hour',  'Free', true, 40, array['explorer','active','creator']),
  ('Hidden Mural Hunt','Find 3 murals downtown and snap one each.',        'Uptown square',         'Anytime',    'Free', true, 60, array['explorer','creator']),
  ('Pickup Frisbee',   'Join the open frisbee game on the field.',         'North field',           'Every 30 min','Free', true, 45, array['active']),
  ('Climbing Taster',  'Two-for-one bouldering intro session.',            'Rock gym',              '6:00 PM',    '$15 each (2-for-1 deal)', false, 60, array['active','explorer']),
  ('Sketch & Sip',     'Grab a coffee and sketch each other badly.',       'Cafe by the library',   'Now',        '$4 coffee', false, 30, array['creator','foodie']),
  ('Hack Night Demo',  'Check out the demo tables and vote together.',     'Main hall',             'Now',        'Free', true, 30, array['creator','explorer'])
) v
where not exists (select 1 from quests);
