-- CAN Logger Dashboard - device claiming.
-- Apply in the Supabase SQL editor or via `supabase db push` after
-- 0003_device_events_retention.sql.
--
-- Lets a signed-in user attach an existing, already-reporting device to their
-- account by typing the device's id plus a claim code. The server does the
-- user_devices insert with the service role (user_devices deliberately has no
-- INSERT policy for `authenticated`), so this migration only adds the column
-- the server matches on - no RLS change.
--
-- claim_code is a shared secret set by whoever provisions the device (same row
-- that carries upload_token_hash). It is not cleared on a successful claim, so
-- more than one household member can claim the same device as a viewer.
-- ponytail: shared code, no single-use / expiry. Add a claim_code_expires_at
-- column and null the code after first claim if devices are ever sold on.

alter table public.devices add column if not exists claim_code text;

-- Claim lookups filter devices by device_id (already covered by the unique
-- index from 0001) and then compare claim_code. Partial index keeps it small -
-- only rows that actually have a code set.
create index if not exists devices_claim_code_idx
  on public.devices(claim_code)
  where claim_code is not null;

comment on column public.devices.claim_code is
  'Shared secret a signed-in user types to claim this device. Matched server-side with the service role; user_devices has no INSERT policy.';
