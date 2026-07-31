# Database

This folder contains the database foundation for a multi-user CAN Logger dashboard.

## Files

- `schema.sql` - PostgreSQL/Supabase schema for customers, users, devices, device access, latest status, events, reports, and audit logs.
- `seed.demo.sql` - demo customer, users, device, and latest status data.

## Recommended Hosted Database

Use Supabase Postgres or Render Postgres. The dashboard is currently still using environment-variable auth and a small JSON runtime store, but this schema is ready for the next step: database-backed users and device assignment.

## Main Tables

| Table | Purpose |
| --- | --- |
| `customers` | Customer/company/owner records. |
| `app_users` | Login identities with `customer`, `service`, or `admin` role. |
| `devices` | ESP32 CAN logger devices. |
| `user_devices` | Which users can view or service which logger. |
| `device_status_latest` | Latest uploaded vehicle health snapshot. |
| `device_events` | Alert and event history. |
| `report_files` | Downloadable reports/log metadata. |
| `audit_log` | Login, service-mode, and admin audit trail. |

## Roles

```text
customer = can view assigned vehicles and customer reports
service  = can view assigned vehicles plus service details/raw logs
admin    = can manage users/devices
```

## Applying To Supabase

1. Open Supabase project.
2. Go to SQL Editor.
3. Run `schema.sql`.
4. Run `seed.demo.sql` only for demo/testing.
5. Replace placeholder password hashes with real auth-provider hashes or use Supabase Auth.

## Future App Integration

The next code step is to replace these current environment variables:

```text
DASHBOARD_AUTH_EMAIL
DASHBOARD_AUTH_PASSWORD
CUSTOMER_ID
```

with database-backed login and device lookup:

```text
user logs in -> query app_users -> query user_devices -> show assigned devices only
ESP32 upload -> verify device token -> upsert device_status_latest -> insert device_events
```
