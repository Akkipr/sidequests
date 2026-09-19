-- SideQuests schema for Tiger Data (Postgres + TimescaleDB).
-- Run once:  psql "$DATABASE_URL" -f db/schema.sql

create table if not exists users (
  id         uuid primary key default gen_random_uuid(),
  key_hash   text not null unique,          -- sha256 of the device key the phone holds
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

-- Time-series: every MATCH signal the wearables report (RSSI log).
create table if not exists proximity_events (
  time         timestamptz not null default now(),
  user_id      uuid not null,
  peer_user_id uuid,
  rssi         int
);
select create_hypertable('proximity_events', by_range('time'), if_not_exists => true);

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
