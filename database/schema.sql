-- CAN Logger Dashboard Database Schema
-- Target: PostgreSQL / Supabase / Render Postgres
-- Purpose: multi-user customer dashboard with device assignment and service roles.

create extension if not exists pgcrypto;

create table if not exists customers (
  id uuid primary key default gen_random_uuid(),
  customer_code text not null unique,
  display_name text not null,
  contact_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists app_users (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references customers(id) on delete cascade,
  email text not null unique,
  password_hash text not null,
  full_name text,
  role text not null default 'customer' check (role in ('customer', 'service', 'admin')),
  active boolean not null default true,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists devices (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) on delete cascade,
  device_id text not null unique,
  device_name text not null,
  upload_token_hash text,
  vehicle_label text,
  firmware_version text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists user_devices (
  user_id uuid not null references app_users(id) on delete cascade,
  device_id uuid not null references devices(id) on delete cascade,
  access_level text not null default 'viewer' check (access_level in ('viewer', 'service', 'owner')),
  created_at timestamptz not null default now(),
  primary key (user_id, device_id)
);

create table if not exists device_status_latest (
  device_id uuid primary key references devices(id) on delete cascade,
  received_at timestamptz not null default now(),
  source text not null default 'cloud',
  health text not null default 'Unknown',
  vehicle_state text not null default 'Unknown',
  monitoring text not null default 'Cloud monitoring',
  latest_event text,
  active_alert text,
  speed_kph numeric(8,2),
  brake_bar numeric(8,2),
  acceleration_mps2 numeric(8,3),
  received_frames bigint not null default 0,
  logged_frames bigint not null default 0,
  decoded_signals bigint not null default 0,
  event_count bigint not null default 0,
  fault_count bigint not null default 0,
  dropped_frames bigint not null default 0,
  rejected_frames bigint not null default 0,
  gps_status text not null default 'not_connected',
  last_known_location text,
  latitude numeric(10,7),
  longitude numeric(10,7),
  raw_payload jsonb not null default '{}'::jsonb
);

create table if not exists device_events (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references devices(id) on delete cascade,
  received_at timestamptz not null default now(),
  event_time timestamptz,
  title text not null,
  severity text not null default 'info' check (severity in ('ok', 'info', 'warning', 'critical')),
  status text not null default 'info' check (status in ('active', 'recovered', 'info')),
  fault_code text,
  can_id text,
  raw_reason text,
  raw_payload jsonb not null default '{}'::jsonb
);

create table if not exists report_files (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references devices(id) on delete cascade,
  file_name text not null,
  file_type text not null default 'event_report' check (file_type in ('event_report', 'raw_log', 'health_report')),
  file_url text,
  byte_size bigint,
  service_only boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists audit_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references app_users(id) on delete set null,
  device_id uuid references devices(id) on delete set null,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_app_users_customer_id on app_users(customer_id);
create index if not exists idx_devices_customer_id on devices(customer_id);
create index if not exists idx_device_events_device_time on device_events(device_id, received_at desc);
create index if not exists idx_report_files_device_time on report_files(device_id, created_at desc);
create index if not exists idx_audit_log_created_at on audit_log(created_at desc);

-- Helper view for customer dashboard device list.
create or replace view dashboard_device_summary as
select
  d.id as internal_device_uuid,
  d.device_id,
  d.device_name,
  d.vehicle_label,
  c.customer_code,
  c.display_name as customer_name,
  s.received_at as last_upload_at,
  s.health,
  s.vehicle_state,
  s.active_alert,
  s.speed_kph,
  s.gps_status
from devices d
join customers c on c.id = d.customer_id
left join device_status_latest s on s.device_id = d.id
where d.active = true;
