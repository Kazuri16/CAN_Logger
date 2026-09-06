# Database

Supabase Postgres schema for the CAN Logger dashboard: Supabase Auth for login,
Row Level Security for per-user isolation.

## Files

- `migrations/0001_init.sql` - current schema (profiles, devices, user_devices, device_status_latest, device_events, report_files) with RLS.
- `seed.example.sql` - placeholder inserts wiring one auth user -> profile + device + access. Fill in the `-- REPLACE <...>` markers.
- `schema.sql` - **superseded**, pre-Supabase model, kept for history.
- `seed.demo.sql` - **superseded**, seed for the old model.

## Tables

| Table | Purpose |
| --- | --- |
| `profiles` | One row per `auth.users` id (auto-created by trigger). Display name + customer code. |
| `devices` | ESP32 CAN logger devices. `upload_token_hash` = sha256 of `DEVICE_UPLOAD_TOKEN`. |
| `user_devices` | Which auth user can view/service which device (`viewer` / `service` / `owner`). |
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
2. Run `migrations/0001_init.sql`.
3. Create your login user: Authentication -> Users -> Add user.
4. Copy that user's UUID and the sha256 of your `DEVICE_UPLOAD_TOKEN` into
   `seed.example.sql`, then run it.

## App wiring

```text
user logs in  -> server calls supabase.auth.signInWithPassword
              -> encrypted session stored in the __Host- cookie (no server store)
each request  -> per-request client with the user's access token (RLS applies)
              -> reads also filter explicitly by user_id / device_id (defense in depth)
ESP32 upload  -> verify DEVICE_UPLOAD_TOKEN -> service-role client
              -> resolve devices row by upload_token_hash
              -> upsert device_status_latest + insert device_events
```
