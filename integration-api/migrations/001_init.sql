create table api_keys (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  key_hash text not null unique,
  account_ids integer[] not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create table tive_events (
  id uuid primary key default gen_random_uuid(),
  api_key_id uuid not null references api_keys (id),
  received_at timestamptz not null default now(),
  payload jsonb not null,
  status text not null default 'received'
    check (status in ('received', 'accepted', 'duplicate', 'conflict', 'rejected')),
  warnings jsonb not null default '[]',
  errors jsonb not null default '[]'
);

create index tive_events_unprocessed on tive_events (received_at) where status = 'received';

create table sensor_readings (
  id bigint generated always as identity primary key,
  event_id uuid not null references tive_events (id),
  provider text not null,
  type text not null,
  device_id text not null,
  device_imei text not null,
  recorded_at timestamptz not null,
  account_id integer,
  shipment_id text,
  temperature double precision,
  humidity double precision,
  light_level double precision,
  accelerometer jsonb,
  tilt jsonb,
  box_open boolean,
  created_at timestamptz not null default now(),
  unique (provider, device_imei, recorded_at)
);

create table location_readings (
  id bigint generated always as identity primary key,
  event_id uuid not null references tive_events (id),
  provider text not null,
  type text not null,
  device_id text not null,
  device_imei text not null,
  recorded_at timestamptz not null,
  account_id integer,
  shipment_id text,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  altitude double precision,
  location_accuracy integer,
  location_accuracy_category text check (location_accuracy_category in ('High', 'Medium', 'Low')),
  location_source text,
  address jsonb,
  battery_level smallint check (battery_level between 0 and 100),
  cellular_dbm double precision,
  cellular_network_type text,
  cellular_operator text,
  wifi_access_points integer,
  created_at timestamptz not null default now(),
  unique (provider, device_imei, recorded_at)
);
