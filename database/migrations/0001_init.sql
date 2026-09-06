-- CAN Logger Dashboard - initial schema for Supabase Auth + Postgres + RLS.
-- Supersedes database/schema.sql (the env-var-auth era). Apply in the Supabase
-- SQL editor or via `supabase db push`.
--
-- Users are created in the Supabase dashboard (Authentication -> Users -> Add
-- user). There is NO signup/email flow in the app. A profiles row is created
-- automatically by the on_auth_user_created trigger; an admin then inserts the
-- devices / user_devices rows (see database/seed.example.sql).

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- profiles: one row per auth user, auto-created by the trigger below.
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  customer_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- devices: one row per ESP32 CAN logger.
-- ---------------------------------------------------------------------------
create table public.devices (
  id uuid primary key default gen_random_uuid(),
  device_id text unique not null,           -- the ESP32's id
  device_name text,
  vehicle_label text,
  upload_token_hash text,                   -- sha256 hex of DEVICE_UPLOAD_TOKEN; never the raw token
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index devices_upload_token_hash_idx on public.devices(upload_token_hash);

-- ---------------------------------------------------------------------------
-- user_devices: which auth user can see which device.
-- ---------------------------------------------------------------------------
create table public.user_devices (
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id uuid not null references public.devices(id) on delete cascade,
  access_level text not null default 'viewer' check (access_level in ('viewer', 'service', 'owner')),
  created_at timestamptz not null default now(),
  primary key (user_id, device_id)
);
create index user_devices_user_id_idx on public.user_devices(user_id);
create index user_devices_device_id_idx on public.user_devices(device_id);

-- ---------------------------------------------------------------------------
-- device_status_latest: newest health snapshot per device. Service role upserts.
-- ---------------------------------------------------------------------------
create table public.device_status_latest (
  device_id uuid primary key references public.devices(id) on delete cascade,
  source text not null default 'cloud',
  health text,
  vehicle_state text,
  monitoring text,
  latest_event text,
  active_alert text,
  speed_kph numeric(8, 2),
  brake_bar numeric(8, 2),
  acceleration_mps2 numeric(8, 3),
  received_frames bigint not null default 0,
  logged_frames bigint not null default 0,
  decoded_signals bigint not null default 0,
  event_count bigint not null default 0,
  fault_count bigint not null default 0,
  dropped_frames bigint not null default 0,
  rejected_frames bigint not null default 0,
  gps_status text not null default 'not_connected',
  latitude numeric(10, 7),
  longitude numeric(10, 7),
  raw_payload jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- device_events: alert / event history. Service role inserts.
-- ---------------------------------------------------------------------------
create table public.device_events (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.devices(id) on delete cascade,
  received_at timestamptz not null default now(),
  event_time timestamptz,
  title text,
  severity text not null default 'info' check (severity in ('ok', 'info', 'warning', 'critical')),
  status text not null default 'info' check (status in ('active', 'recovered', 'info')),
  fault_code text,
  can_id text,
  raw_reason text,
  raw_payload jsonb not null default '{}'::jsonb
);
create index device_events_device_received_idx on public.device_events(device_id, received_at desc);

-- ---------------------------------------------------------------------------
-- report_files: downloadable report / log metadata.
-- ---------------------------------------------------------------------------
create table public.report_files (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.devices(id) on delete cascade,
  file_name text not null,
  file_type text not null default 'event_report' check (file_type in ('event_report', 'raw_log', 'health_report')),
  byte_size bigint,
  service_only boolean not null default false,
  created_at timestamptz not null default now()
);
create index report_files_device_created_idx on public.report_files(device_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Row Level Security.
--
-- Plain subquery policies, not a security-definer private.user_owns_device()
-- helper: the ownership check is a single index-backed lookup on
-- user_devices(user_id), so a subquery policy is the simpler correct option -
-- no extra schema, no revoke/grant juggling on a helper function. auth.uid() is
-- wrapped as (select auth.uid()) everywhere so the planner evaluates it once.
--
-- Telemetry tables get SELECT only for `authenticated`: the service role writes
-- them and bypasses RLS, so there are deliberately no insert/update/delete
-- policies here.
-- ---------------------------------------------------------------------------
alter table public.profiles              enable row level security;
alter table public.devices               enable row level security;
alter table public.user_devices          enable row level security;
alter table public.device_status_latest  enable row level security;
alter table public.device_events         enable row level security;
alter table public.report_files          enable row level security;

alter table public.profiles              force row level security;
alter table public.devices               force row level security;
alter table public.user_devices          force row level security;
alter table public.device_status_latest  force row level security;
alter table public.device_events         force row level security;
alter table public.report_files          force row level security;

-- profiles: a user sees only their own row. (SELECT only; the app never writes
-- profiles from the client - provisioning is done with the service role.)
create policy profiles_select_own on public.profiles
  for select to authenticated
  using (id = (select auth.uid()));

-- user_devices: a user sees only their own assignments.
create policy user_devices_select_own on public.user_devices
  for select to authenticated
  using (user_id = (select auth.uid()));

-- devices + telemetry: readable only for devices the user is assigned to.
create policy devices_select_assigned on public.devices
  for select to authenticated
  using (id in (select device_id from public.user_devices where user_id = (select auth.uid())));

create policy device_status_select_assigned on public.device_status_latest
  for select to authenticated
  using (device_id in (select device_id from public.user_devices where user_id = (select auth.uid())));

create policy device_events_select_assigned on public.device_events
  for select to authenticated
  using (device_id in (select device_id from public.user_devices where user_id = (select auth.uid())));

create policy report_files_select_assigned on public.report_files
  for select to authenticated
  using (device_id in (select device_id from public.user_devices where user_id = (select auth.uid())));
