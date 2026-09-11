# Graph Report - dashboard  (2026-09-11)

## Corpus Check
- 30 files · ~22,275 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 270 nodes · 433 edges · 26 communities (16 shown, 1 thin omitted)
- Extraction: 95% EXTRACTED · 5% INFERRED · 0% AMBIGUOUS · INFERRED: 22 edges (avg confidence: 0.85)
- Token cost: 0 input · 169,490 output

## Community Hubs (Navigation)
- Dashboard Client UI
- Signup, Devices & Schema
- Session & Auth Utilities
- Package Dependencies
- Deployment & Review Tracking
- Server Runtime Config
- Dashboard Test Suite
- Status & Alert Helpers
- Auth Schema & RLS
- Keep-Alive / Uptime Options
- Database Query Functions
- Test Fixtures & Fakes
- Vercel API Wrapper
- Event Retention Migration
- Vercel Config
- Device Claim Security
- Devices Table

## God Nodes (most connected - your core abstractions)
1. `handleApi()` - 36 edges
2. `Dashboard Database README (Supabase Postgres schema)` - 15 edges
3. `api()` - 13 edges
4. `initializeDashboard()` - 10 edges
5. `getSession()` - 9 edges
6. `PC Vehicle Health Dashboard README` - 9 edges
7. `Dashboard Keep-Alive Setup Guide` - 8 edges
8. `Verification Report: CAN Logger Dashboard Signup Feature` - 8 edges
9. `scripts` - 7 edges
10. `mapStatus()` - 7 edges

## Surprising Connections (you probably didn't know these)
- `Uptime Monitor static info page (public/uptime-monitor.html)` --semantically_similar_to--> `Dashboard Keep-Alive Setup Guide`  [INFERRED] [semantically similar]
  public/uptime-monitor.html → KEEP_ALIVE_SETUP.html
- `Option 3: DIY /health check endpoint pinged by cron` --conceptually_related_to--> `render.yaml - can-logger-dashboard Render web service config`  [AMBIGUOUS]
  KEEP_ALIVE_SETUP.html → render.yaml
- `Verification Report: CAN Logger Dashboard Signup Feature` --semantically_similar_to--> `Signup Form Enhancements summary`  [INFERRED] [semantically similar]
  signup-verification.md → SIGNUP_ENHANCEMENTS.md
- `Real-time email validation (valid/invalid feedback on blur)` --references--> `loginForm (#loginForm) with email/password fields`  [INFERRED]
  SIGNUP_ENHANCEMENTS.md → public/index.html
- `claimForm (#claimForm, #claimDeviceId, #claimCode)` --references--> `POST /api/devices/claim endpoint (service-role client; match device_id+claim_code; upsert user_devices)`  [INFERRED]
  public/index.html → README.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Customer Signup Flow (UI toggle -> client JS -> server endpoint -> tests)** — can_logger_dashboard_public_index_authtoggle, can_logger_dashboard_public_app_setauthmode, can_logger_dashboard_public_app_handlesignup, can_logger_dashboard_server_post_api_auth_signup, can_logger_dashboard_test_dashboard_test [INFERRED 0.85]
- **Device Claiming Data Flow (claim endpoint + the three tables it reads/writes)** — can_logger_dashboard_server_post_api_devices_claim, can_logger_dashboard_database_devices_table, can_logger_dashboard_database_user_devices_table, can_logger_dashboard_database_device_status_latest_table [INFERRED 0.85]
- **Vercel Cold-Start Mitigation Guidance (duplicated advice across two static pages)** — can_logger_dashboard_keep_alive_setup_guide, can_logger_dashboard_public_uptime_monitor_doc, can_logger_dashboard_keep_alive_setup_cron_ping_option, can_logger_dashboard_keep_alive_setup_vercel_pro_option [INFERRED 0.80]

## Communities (26 total, 1 thin omitted)

### Community 0 - "Dashboard Client UI"
Cohesion: 0.08
Nodes (45): addAiMessage(), aiHistory, api(), applyServiceMode(), checkAuth(), clearValidationHints(), escapeHtml(), formatNumber() (+37 more)

### Community 1 - "Signup, Devices & Schema"
Cohesion: 0.08
Nodes (38): App wiring flow (signup -> confirm -> login -> claim device -> ESP32 upload), device_events table (alert/event history), device_status_latest table (latest vehicle-health snapshot per device), devices table (ESP32 loggers; upload_token_hash, claim_code), migrations/0001_init.sql - base schema + RLS, migrations/0002_lock_down_handle_new_user_rpc.sql - revoke EXECUTE on handle_new_user(), migrations/0003_device_events_retention.sql - caps device_events at 500 rows/device (renumbered from 0002), migrations/0004_device_claiming.sql - adds devices.claim_code for self-service claiming (+30 more)

### Community 2 - "Session & Auth Utilities"
Cohesion: 0.13
Nodes (22): authClient(), authStatusFor(), clearSessionCookie(), clientIp(), cookieKey(), decryptSession(), demoFiles(), encryptSession() (+14 more)

### Community 3 - "Package Dependencies"
Cohesion: 0.10
Nodes (20): dependencies, @supabase/supabase-js, description, devDependencies, @playwright/test, engines, node, name (+12 more)

### Community 4 - "Deployment & Review Tracking"
Cohesion: 0.12
Nodes (20): artifact/dashboard.html self-contained static dashboard draft, Independent code review requirement before push (rationale: project CLAUDE.md rule blocks the routine until reviewed), Dashboard Migration Render to Vercel + Artifact - Tracking Checklist, publish-clean branch (must be pushed to origin before routine runs), Scheduled cloud agent routine (trig_015V5Hc7BXCBFWbWzrehdVsa, fires 2026-09-06 19:30 IST), Vercel deploy step (vercel link, env vars, vercel deploy --prod), aiPage section (#aiPage) - AI chat about vehicle, alertsPage section (#alertsPage) (+12 more)

### Community 5 - "Server Runtime Config"
Cohesion: 0.12
Nodes (16): authConfigured, dashboardMode, __dirname, fetchLogger(), loginAttempts, logStartupWarnings(), mimeTypes, normalizeAddress() (+8 more)

### Community 6 - "Dashboard Test Suite"
Cohesion: 0.18
Nodes (11): GOOD, GOOD_CLAIM, GOOD_SIGNUP, baseEnv(), boot(), bootAndWaitExit(), bootPath, buildEnv() (+3 more)

### Community 7 - "Status & Alert Helpers"
Cohesion: 0.23
Nodes (12): alertMessage(), baseLocation(), cloudEventFromStatus(), demoStatus(), friendlyEventsFromStatus(), ingestDeviceStatus(), mapStatus(), normalizeCloudPayload() (+4 more)

### Community 8 - "Auth Schema & RLS"
Cohesion: 0.27
Nodes (9): auth.users, on_auth_user_created, public.device_events, public.device_status_latest, public.devices, public.profiles, public.report_files, public.user_devices (+1 more)

### Community 9 - "Keep-Alive / Uptime Options"
Cohesion: 0.24
Nodes (10): cron-job.org (free cron ping service), Option 1: Free Cron Ping (recommended - free, 2min setup, no code changes), Dashboard Keep-Alive Setup Guide, Option 3: DIY /health check endpoint pinged by cron, Pingdom (alternative limited-free uptime service), Statuscake (alternative free uptime service), UptimeRobot (alternative free cron/uptime service), Vercel free-tier cold start (rationale: functions spin down after ~15min idle, causing 2-5s cold start on next visit) (+2 more)

### Community 10 - "Database Query Functions"
Cohesion: 0.28
Nodes (9): devicesForUser(), eventsForUser(), filesForUser(), latestStatusForUser(), ownedDeviceUuids(), rowToEvent(), rowToFile(), rowToStatus() (+1 more)

### Community 11 - "Test Fixtures & Fakes"
Cohesion: 0.28
Nodes (4): makeChain(), chain, record(), tableRead()

### Community 12 - "Vercel API Wrapper"
Cohesion: 0.29
Nodes (5): json(), requireBrowserAuth(), server, serveStatic(), text()

### Community 13 - "Event Retention Migration"
Cohesion: 0.40
Nodes (4): device_events_retention, public.trim_device_events(), public.device_events, public.trim_device_events

### Community 14 - "Vercel Config"
Cohesion: 0.40
Nodes (4): builds, crons, routes, version

### Community 15 - "Device Claim Security"
Cohesion: 0.50
Nodes (4): claimDevice(), serviceClient(), tokenEquals(), verifyUploadToken()

## Ambiguous Edges - Review These
- `Option 3: DIY /health check endpoint pinged by cron` → `render.yaml - can-logger-dashboard Render web service config`  [AMBIGUOUS]
  KEEP_ALIVE_SETUP.html · relation: conceptually_related_to

## Knowledge Gaps
- **59 isolated node(s):** `name`, `version`, `private`, `description`, `type` (+54 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 90 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **1 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `Option 3: DIY /health check endpoint pinged by cron` and `render.yaml - can-logger-dashboard Render web service config`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **Why does `PC Vehicle Health Dashboard README` connect `Deployment & Review Tracking` to `Signup, Devices & Schema`?**
  _High betweenness centrality (0.035) - this node is a cross-community bridge._
- **Why does `Dashboard Database README (Supabase Postgres schema)` connect `Signup, Devices & Schema` to `Deployment & Review Tracking`?**
  _High betweenness centrality (0.020) - this node is a cross-community bridge._
- **Why does `Self sign-up + device claiming flow (rationale: lets customers create their own account and attach their device without an admin)` connect `Signup, Devices & Schema` to `Deployment & Review Tracking`?**
  _High betweenness centrality (0.020) - this node is a cross-community bridge._
- **What connects `name`, `version`, `private` to the rest of the system?**
  _59 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Dashboard Client UI` be split into smaller, more focused modules?**
  _Cohesion score 0.0815686274509804 - nodes in this community are weakly interconnected._
- **Should `Signup, Devices & Schema` be split into smaller, more focused modules?**
  _Cohesion score 0.08108108108108109 - nodes in this community are weakly interconnected._