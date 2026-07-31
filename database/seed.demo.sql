-- Demo seed data for local/Supabase testing.
-- Password hashes below are placeholders. Replace with bcrypt/Argon2 hashes from your auth provider.

insert into customers (customer_code, display_name, contact_email)
values ('CANLOGGER-001', 'Family Vehicle Customer', 'customer@example.com')
on conflict (customer_code) do update set
  display_name = excluded.display_name,
  contact_email = excluded.contact_email,
  updated_at = now();

insert into app_users (customer_id, email, password_hash, full_name, role)
select id, 'customer@example.com', 'REPLACE_WITH_PASSWORD_HASH', 'Demo Customer', 'customer'
from customers
where customer_code = 'CANLOGGER-001'
on conflict (email) do update set
  customer_id = excluded.customer_id,
  full_name = excluded.full_name,
  role = excluded.role,
  updated_at = now();

insert into app_users (customer_id, email, password_hash, full_name, role)
select id, 'service@example.com', 'REPLACE_WITH_PASSWORD_HASH', 'Service Technician', 'service'
from customers
where customer_code = 'CANLOGGER-001'
on conflict (email) do update set
  customer_id = excluded.customer_id,
  full_name = excluded.full_name,
  role = excluded.role,
  updated_at = now();

insert into devices (customer_id, device_id, device_name, vehicle_label, firmware_version)
select id, 'canlogger-001', 'CAN Logger 001', 'Family Vehicle', 'step_06_condition_engine_logger'
from customers
where customer_code = 'CANLOGGER-001'
on conflict (device_id) do update set
  customer_id = excluded.customer_id,
  device_name = excluded.device_name,
  vehicle_label = excluded.vehicle_label,
  firmware_version = excluded.firmware_version,
  updated_at = now();

insert into user_devices (user_id, device_id, access_level)
select u.id, d.id, case when u.role = 'service' then 'service' else 'owner' end
from app_users u
join devices d on d.device_id = 'canlogger-001'
where u.email in ('customer@example.com', 'service@example.com')
on conflict (user_id, device_id) do update set access_level = excluded.access_level;

insert into device_status_latest (
  device_id,
  health,
  vehicle_state,
  monitoring,
  latest_event,
  active_alert,
  speed_kph,
  brake_bar,
  acceleration_mps2,
  received_frames,
  logged_frames,
  decoded_signals,
  event_count,
  fault_count,
  gps_status,
  raw_payload
)
select
  d.id,
  'Healthy',
  'Parked',
  'Cloud monitoring',
  'Demo status seeded',
  'No active alerts',
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  'not_connected',
  '{"demo": true}'::jsonb
from devices d
where d.device_id = 'canlogger-001'
on conflict (device_id) do update set
  received_at = now(),
  health = excluded.health,
  vehicle_state = excluded.vehicle_state,
  monitoring = excluded.monitoring,
  latest_event = excluded.latest_event,
  active_alert = excluded.active_alert,
  raw_payload = excluded.raw_payload;
