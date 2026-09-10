# Database

Supabase Postgres schema for the CAN Logger dashboard: Supabase Auth for login,
Row Level Security for per-user isolation.

## Files

- `migrations/0001_init.sql` - base schema (profiles, devices, user_devices, device_status_latest, device_events, report_files) with RLS.
- `migrations/0002_lock_down_handle_new_user_rpc.sql` - revoke `EXECUTE` on `handle_new_user()` from the API roles (it is trigger-only). Already applied to the cloud project; backfilled here so the repo matches.
- `migrations/0003_device_events_retention.sql` - AFTER INSERT trigger caps `device_events` at 500 rows per device. (Was `0002_device_events_retention.sql`; renumbered to keep repo and cloud history in step.)
- `migrations/0004_device_claiming.sql` - adds `devices.claim_code` + partial index for self-service device claiming. No RLS change.
- `seed.example.sql` - placeholder inserts wiring one auth user -> profile + device + access. Fill in the `-- REPLACE <...>` markers.
- `schema.sql` - **superseded**, pre-Supabase model, kept for history.
- `seed.demo.sql` - **superseded**, seed for the old model.

Apply migrations in filename order.

## Tables

| Table | Purpose |
| --- | --- |
| `profiles` | One row per `auth.users` id (auto-created by trigger). Display name + customer code. |
| `devices` | ESP32 CAN logger devices. `upload_token_hash` = sha256 of `DEVICE_UPLOAD_TOKEN`. `claim_code` = shared secret a user types to claim the device. |
| `user_devices` | Which auth user can view/service which device (`viewer` / `service` / `owner`). Written only by the server's service-role path (no `INSERT` RLS policy). |
| `device_status_latest` | Latest uploaded vehicle-health snapshot per device. |
| `device_events` | Alert / event history. |
| `report_files` | Downloadable report / log metadata. |

## RLS

All six tables have RLS enabled + `force row level security`. `authenticated`
users get `SELECT` only:

- `profiles` / `user_devices`: only rows for `(select auth.uid())`.
- `devices` + telemetry: only rows for devices listed in the user's `user_devices`.

No insert/update/delete policies for `authenticated` on the telemetry tables -
only the service role writes them (`POST /api/cloud/status`), and the service
role bypasses RLS.

## Applying to Supabase

1. Open the Supabase project -> SQL Editor.
2. Run `migrations/0001_init.sql` .. `migrations/0004_device_claiming.sql` in
   filename order. (`0002` is already applied on the cloud project; re-running it
   is safe.)
3. Provision each device: insert a `devices` row with its `device_id`,
   `upload_token_hash` = sha256 of that device's `DEVICE_UPLOAD_TOKEN`, and a
   `claim_code` you give the customer.
4. Customers self-register (`/api/auth/signup`) and attach the device with its
   ID + claim code (`/api/devices/claim`). `seed.example.sql` still works for
   wiring a user to a device by hand.

## App wiring

```text
sign up       -> server calls supabase.auth.signUp (anon key) -> confirmation email
              -> no session; user confirms via email, then signs in
user logs in  -> server calls supabase.auth.signInWithPassword
              -> encrypted session stored in the __Host- cookie (no server store)
claim device  -> service-role client: match devices.device_id + devices.claim_code
              -> require a device_status_latest row (device has reported)
              -> upsert user_devices(user_id, device_id, 'viewer')   [idempotent]
each request  -> per-request client with the user's access token (RLS applies)
              -> reads also filter explicitly by user_id / device_id (defense in depth)
ESP32 upload  -> verify DEVICE_UPLOAD_TOKEN -> service-role client
              -> resolve devices row by upload_token_hash
              -> upsert device_status_latest + insert device_events
```
