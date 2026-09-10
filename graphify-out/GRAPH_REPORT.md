# Graph Report - dashboard  (2026-09-10)

## Corpus Check
- Corpus is ~16,458 words - fits in a single context window. You may not need a graph.

## Summary
- 202 nodes · 364 edges · 14 communities
- Extraction: 91% EXTRACTED · 9% INFERRED · 0% AMBIGUOUS · INFERRED: 32 edges (avg confidence: 0.86)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Device & Auth Schema
- SPA Handler Functions
- Session & Auth Utilities
- Dependencies & Config
- Server Runtime Setup
- Dashboard Testing
- UI Helper Functions
- Database Query Functions
- Test Infrastructure
- Cloud API Routes
- Vercel & Build Config
- Device Security

## God Nodes (most connected - your core abstractions)
1. `handleApi()` - 36 edges
2. `api()` - 11 edges
3. `initializeDashboard()` - 9 edges
4. `getSession()` - 9 edges
5. `Self Sign-up and Device Claiming` - 9 edges
6. `Dashboard SPA Shell (index.html)` - 9 edges
7. `devices Table` - 8 edges
8. `scripts` - 7 edges
9. `mapStatus()` - 7 edges
10. `handleLogin()` - 6 edges

## Surprising Connections (you probably didn't know these)
- `Self-contained Artifact Dashboard (artifact/dashboard.html)` --semantically_similar_to--> `Dashboard SPA Shell (index.html)`  [INFERRED] [semantically similar]
  MIGRATION_TODO.md → public/index.html
- `App Wiring Flow (signup, login, claim, request, upload)` --semantically_similar_to--> `Self Sign-up and Device Claiming`  [INFERRED] [semantically similar]
  database/README.md → README.md
- `DASHBOARD_AUTH=off Trusted-LAN Bypass` --semantically_similar_to--> `Row Level Security Model`  [INFERRED] [semantically similar]
  README.md → database/README.md
- `Render Web Service can-logger-dashboard` --conceptually_related_to--> `DASHBOARD_AUTH=off Trusted-LAN Bypass`  [AMBIGUOUS]
  render.yaml → README.md
- `Connect Your Logger Setup Banner (#setupBanner)` --conceptually_related_to--> `Local Logger API Proxy (GET /api/status, /api/files, /view, /download)`  [INFERRED]
  public/index.html → README.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Self-service Device Claiming Flow** — public_index_claim_screen, readme_self_signup_and_device_claiming, database_readme_device_claiming_migration, database_readme_devices_table, database_readme_user_devices_table, database_readme_device_status_latest_table, database_readme_service_role_write_path [EXTRACTED 1.00]
- **ESP32 Cloud Telemetry Ingestion Flow** — readme_cloud_mode, readme_cloud_status_endpoint, render_device_upload_token_env, database_readme_devices_table, database_readme_device_status_latest_table, database_readme_device_events_table, database_readme_device_events_retention [EXTRACTED 1.00]
- **Five-page Dashboard SPA Sections** — public_index_home_page, public_index_alerts_page, public_index_reports_page, public_index_settings_page, public_index_location_page, public_index_vehicle_health_dashboard_shell [EXTRACTED 1.00]

## Communities (14 total, 0 thin omitted)

### Community 0 - "Device & Auth Schema"
Cohesion: 0.09
Nodes (42): App Wiring Flow (signup, login, claim, request, upload), Device Claiming Migration (0004 devices.claim_code), device_events Retention Trigger (0003), device_events Table, device_status_latest Table, devices Table, handle_new_user() RPC Lockdown (0002), Per-Request Access-Token Client (+34 more)

### Community 1 - "SPA Handler Functions"
Cohesion: 0.15
Nodes (30): api(), applyServiceMode(), checkAuth(), escapeHtml(), formatNumber(), handleAuthSubmit(), handleClaim(), handleLogin() (+22 more)

### Community 2 - "Session & Auth Utilities"
Cohesion: 0.13
Nodes (22): authClient(), authStatusFor(), clearSessionCookie(), clientIp(), cookieKey(), decryptSession(), demoFiles(), encryptSession() (+14 more)

### Community 3 - "Dependencies & Config"
Cohesion: 0.10
Nodes (20): dependencies, @supabase/supabase-js, description, devDependencies, @playwright/test, engines, node, name (+12 more)

### Community 4 - "Server Runtime Setup"
Cohesion: 0.12
Nodes (16): authConfigured, dashboardMode, __dirname, fetchLogger(), loginAttempts, logStartupWarnings(), mimeTypes, normalizeAddress() (+8 more)

### Community 5 - "Dashboard Testing"
Cohesion: 0.18
Nodes (11): GOOD, GOOD_CLAIM, GOOD_SIGNUP, baseEnv(), boot(), bootAndWaitExit(), bootPath, buildEnv() (+3 more)

### Community 6 - "UI Helper Functions"
Cohesion: 0.23
Nodes (12): alertMessage(), baseLocation(), cloudEventFromStatus(), demoStatus(), friendlyEventsFromStatus(), ingestDeviceStatus(), mapStatus(), normalizeCloudPayload() (+4 more)

### Community 7 - "Database Query Functions"
Cohesion: 0.28
Nodes (9): devicesForUser(), eventsForUser(), filesForUser(), latestStatusForUser(), ownedDeviceUuids(), rowToEvent(), rowToFile(), rowToStatus() (+1 more)

### Community 8 - "Test Infrastructure"
Cohesion: 0.28
Nodes (4): makeChain(), chain, record(), tableRead()

### Community 9 - "Cloud API Routes"
Cohesion: 0.29
Nodes (5): json(), requireBrowserAuth(), server, serveStatic(), text()

### Community 10 - "Vercel & Build Config"
Cohesion: 0.33
Nodes (5): includeFiles, functions, api/index.js, rewrites, $schema

### Community 11 - "Device Security"
Cohesion: 0.50
Nodes (4): claimDevice(), serviceClient(), tokenEquals(), verifyUploadToken()

## Ambiguous Edges - Review These
- `DASHBOARD_AUTH=off Trusted-LAN Bypass` → `Render Web Service can-logger-dashboard`  [AMBIGUOUS]
  render.yaml · relation: conceptually_related_to

## Knowledge Gaps
- **40 isolated node(s):** `name`, `version`, `private`, `description`, `type` (+35 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 52 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `DASHBOARD_AUTH=off Trusted-LAN Bypass` and `Render Web Service can-logger-dashboard`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **Why does `handleApi()` connect `Session & Auth Utilities` to `Server Runtime Setup`, `UI Helper Functions`, `Database Query Functions`, `Cloud API Routes`, `Device Security`?**
  _High betweenness centrality (0.014) - this node is a cross-community bridge._
- **Are the 3 inferred relationships involving `Self Sign-up and Device Claiming` (e.g. with `App Wiring Flow (signup, login, claim, request, upload)` and `Connect Your Device Screen (#claimScreen)`) actually correct?**
  _`Self Sign-up and Device Claiming` has 3 INFERRED edges - model-reasoned connections that need verification._
- **What connects `name`, `version`, `private` to the rest of the system?**
  _40 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Device & Auth Schema` be split into smaller, more focused modules?**
  _Cohesion score 0.0859465737514518 - nodes in this community are weakly interconnected._
- **Should `SPA Handler Functions` be split into smaller, more focused modules?**
  _Cohesion score 0.14919354838709678 - nodes in this community are weakly interconnected._
- **Should `Session & Auth Utilities` be split into smaller, more focused modules?**
  _Cohesion score 0.12987012987012986 - nodes in this community are weakly interconnected._