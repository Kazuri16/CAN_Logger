-- Example seed: wire ONE existing auth user to one device.
--
-- Prereq: create the user first in the Supabase dashboard
--   Authentication -> Users -> Add user   (email + password)
-- then copy that user's UUID (the "UID" column) and paste it in place of the
-- -- REPLACE <auth-user-uuid> markers below. There is NO signup/email flow in
-- the app; provisioning is manual, here.
--
-- Compute the device upload-token hash on your machine:
--   node -e "console.log(require('crypto').createHash('sha256').update(process.argv[1]).digest('hex'))" "<DEVICE_UPLOAD_TOKEN>"
-- and paste it in place of -- REPLACE <sha256-hex-of-DEVICE_UPLOAD_TOKEN>.

-- 1. Device row. device_id matches the ESP32's id; upload_token_hash is the
--    sha256 hex of DEVICE_UPLOAD_TOKEN (never store the raw token).
insert into public.devices (device_id, device_name, vehicle_label, upload_token_hash)
values (
  'canlogger-001',
  'CAN Logger 001',
  'Family Vehicle',
  '-- REPLACE <sha256-hex-of-DEVICE_UPLOAD_TOKEN>'
)
on conflict (device_id) do update set
  device_name = excluded.device_name,
  vehicle_label = excluded.vehicle_label,
  upload_token_hash = excluded.upload_token_hash,
  updated_at = now();

-- 2. Profile fields for the user. The row itself already exists (created by the
--    on_auth_user_created trigger when the user was added).
update public.profiles set
  full_name = 'Demo Customer',
  customer_code = 'CANLOGGER-001',
  updated_at = now()
where id = '-- REPLACE <auth-user-uuid>'::uuid;

-- 3. Grant that user access to the device.
insert into public.user_devices (user_id, device_id, access_level)
select '-- REPLACE <auth-user-uuid>'::uuid, d.id, 'owner'
from public.devices d
where d.device_id = 'canlogger-001'
on conflict (user_id, device_id) do update set access_level = excluded.access_level;
