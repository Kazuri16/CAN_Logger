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

Login uses Supabase Auth. The Node server calls `supabase.auth.signInWithPassword`
with an anon-key client, then stores the returned session (encrypted with a key
derived from `SESSION_COOKIE_SECRET`) inside an httpOnly `__Host-` cookie. There
is no server-side session store and no signup flow in the app.

Environment variables (see `.env.example` for the full list):

```text
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...        # cloud ingestion + device attribution only
SESSION_COOKIE_SECRET=...            # 32+ random bytes
CUSTOMER_ID=CANLOGGER-001
```

Create the login user in the Supabase dashboard (Authentication -> Users -> Add
user), then wire it to a device with `database/seed.example.sql`. Set
`DASHBOARD_AUTH=off` only on a trusted LAN to skip login entirely.
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

A Vercel-ready config is included at:

```text
vercel.json
```

See "Deploying to Vercel" below for the deploy steps.

Full hosting guide:

```text
../docs/cloud-dashboard-hosting.md
```

For local testing of cloud mode, double-click:

```text
Start_Cloud_Dashboard.bat
```

## Deploying to Vercel

The dashboard is a plain `node:http` server (`server.js`) with a Vercel serverless
entry point at `api/index.js`. `vercel.json` routes every request to that
function and bundles `public/**` alongside it. A human with Vercel account
access needs to run these steps -- they are not run automatically:

1. Install the Vercel CLI once (`npm i -g vercel`), then from this folder run:

   ```sh
   vercel link
   ```

   and follow the prompts to connect this folder to a Vercel project.

2. Set the following as Vercel **project environment variables** (Project ->
   Settings -> Environment Variables), not in a committed file:

   ```text
   DASHBOARD_MODE=cloud
   DASHBOARD_AUTH=              # leave unset/on in cloud mode
   DEVICE_UPLOAD_TOKEN=
   SUPABASE_URL=
   SUPABASE_ANON_KEY=
   SUPABASE_SERVICE_ROLE_KEY=
   SESSION_COOKIE_SECRET=
   CUSTOMER_ID=
   DEVICE_NAME=
   ```

   See `.env.example` for what each variable does. Never commit real values --
   `.env` stays untracked.

3. Deploy:

   ```sh
   vercel deploy --prod
   ```

4. Verify the deployment: `GET /api/dashboard-status` responds (once signed
   in), login works end to end, and the ESP32's `POST /api/cloud/status`
   upload path is reachable. (`/api/status` is the ESP32 logger's own
   endpoint on the local network -- it is not served by this deployment.)

## Database

In cloud mode the dashboard stores telemetry in Supabase Postgres with Row Level
Security. See `database/`:

```text
database/migrations/0001_init.sql   current schema + RLS
database/seed.example.sql           wire one auth user -> device
database/README.md                  details
```

Tables: `profiles`, `devices`, `user_devices`, `device_status_latest`,
`device_events`, `report_files`. `database/schema.sql` and `seed.demo.sql` are
the retired pre-Supabase model, kept only for history.
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
