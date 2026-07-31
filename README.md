# PC Vehicle Health Dashboard

This is the customer-friendly PC dashboard for the ESP32 CAN logger. The ESP32 keeps doing CAN monitoring and SD logging; this app runs on the PC and provides the polished Home, Alerts, Reports, Settings, and future Location pages.

## Quick Start

1. Install Node.js 18 or newer from `https://nodejs.org/`.
2. Open a terminal in this folder:

   ```text
   C:\Users\abhis\OneDrive\Documents\major\CAN_Logger\dashboard
   ```

3. Run the setup check:

   ```sh
   npm run setup
   ```

4. Start the dashboard by double-clicking:

   ```text
   Start_Dashboard.bat
   ```

   Or start it from a terminal:

   ```sh
   npm start
   ```

   If PowerShell blocks `npm`, use:

   ```sh
   npm.cmd run setup
   npm.cmd start
   ```

5. Open:

   ```text
   http://localhost:5177
   ```

6. Go to Settings, enter `canlogger.local` or the ESP32 IP address, and click Test connection.

To stop the dashboard, close the dashboard terminal window or double-click:

```text
Stop_Dashboard.bat
```



## Customer Login

The dashboard now supports a customer login for online use.

Render environment variables:

```text
DASHBOARD_AUTH_EMAIL=customer@example.com
DASHBOARD_AUTH_PASSWORD=choose-a-strong-customer-password
CUSTOMER_ID=CANLOGGER-001
```

`Start_Cloud_Dashboard.bat` asks you to enter a temporary local password at startup. Then sign in with:

```text
Email: customer@example.com
Password: the temporary password you entered
Customer ID: CANLOGGER-001
```

For a real hosted dashboard, change the password in Render. Do not use the local test password online.
## Online / Cloud Hosting

The dashboard can now run in cloud mode. In cloud mode, the hosted server does not call `canlogger.local`; instead, the ESP32 uploads vehicle-health summaries to the public server.

Cloud mode environment variables:

```text
DASHBOARD_MODE=cloud
DEVICE_NAME=Family Vehicle
DEVICE_UPLOAD_TOKEN=choose-a-long-secret-token
```

Cloud upload endpoint:

```text
POST /api/cloud/status
```

A Render-ready config is included at:

```text
render.yaml
```

Full hosting guide:

```text
../docs/cloud-dashboard-hosting.md
```

For local testing of cloud mode, double-click:

```text
Start_Cloud_Dashboard.bat
```

## Database

A PostgreSQL/Supabase-ready database foundation is included in:

```text
database/
```

It contains:

```text
database/schema.sql
database/seed.demo.sql
database/README.md
```

The schema supports multiple customers, multiple users, roles, devices, user-device access, latest vehicle status, event history, reports, and audit logs. Add `DATABASE_URL` in Render when you connect a hosted database.
## What Customers See

- Home: vehicle health, monitoring status, vehicle state, latest event, active alert, logger connection.
- Alerts: warning and critical cards with customer-friendly language.
- Reports: event summaries and downloadable health reports.
- Settings: logger address, connection test, device name, optional token, service mode.
- Location: GPS placeholder that is ready for future map fields.

Raw CAN logs are hidden unless Service mode is enabled. Event reports remain visible for normal users.

## Logger API Used

The dashboard connects to the ESP32 over WiFi through the PC server. It currently uses:

- `GET /api/status`
- `GET /api/files`
- `GET /view?name=...`
- `GET /download?name=...`

The PC server avoids browser CORS issues and gives the UI a single local address.

## Troubleshooting

- Make sure the PC and ESP32 are on the same WiFi network.
- Try `canlogger.local` first. If it does not resolve, use the numeric IP printed by the ESP32 Serial Monitor.
- The ESP32 uses 2.4 GHz WiFi.
- If the logger is powered off, the dashboard still opens and shows fallback demo-style data with an offline message.
- If port `5177` is busy, start with another port:

  ```sh
  $env:PORT=5180; npm start
  ```

## Future GPS Fields

The dashboard already carries optional fields for:

- GPS status
- Last known location
- Latitude and longitude
- Event location
- Trip route

The Location page intentionally shows `GPS not connected` until hardware is added.
