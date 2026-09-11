import http from "node:http";
import { createReadStream, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, createHash, scryptSync, createCipheriv, createDecipheriv, timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");
const port = Number(process.env.PORT || 5177);
const requestTimeoutMs = 3500;
const dashboardMode = String(process.env.DASHBOARD_MODE || "local").toLowerCase();
const uploadToken = process.env.DEVICE_UPLOAD_TOKEN || "";
const customerId = process.env.CUSTOMER_ID || "CANLOGGER-001";

const supabaseUrl = process.env.SUPABASE_URL || "";
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || "";
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const sessionCookieSecret = process.env.SESSION_COOKIE_SECRET || "";

const authConfigured = Boolean(supabaseUrl && supabaseAnonKey);
const authRequired = process.env.DASHBOARD_AUTH !== "off" && (dashboardMode === "cloud" || authConfigured);

const sessionCookieName = "canlogger_session";
const hostSessionCookieName = "__Host-canlogger_session"; // used when the cookie is Secure (S8)
const cookieMaxAgeMs = 7 * 24 * 60 * 60 * 1000;

// Cloud mode's data layer (device ingestion, per-user reads) is Supabase itself,
// not just the login gate - so this is unconditional, unlike the DASHBOARD_AUTH=off
// escape hatch below. Booting green here previously meant the operator only found
// out signup/login were dead from a user's bug report instead of a boot failure.
if (dashboardMode === "cloud" && !authConfigured) {
  const message = "FATAL: DASHBOARD_MODE=cloud requires SUPABASE_URL and SUPABASE_ANON_KEY to be set (see .env.example).";
  console.error(message);
  throw new Error(message);
}

// Fail closed at import time, not just in start(). Under a serverless wrapper
// server.js is imported and start() never runs, so the start()-only guard below
// would be skipped and cookieKey() would silently derive from scrypt("") — a
// world-known key that lets anyone forge a session cookie. Enforced only when
// auth is actually required (DASHBOARD_AUTH=off on a trusted LAN still boots).
if (authRequired && sessionCookieSecret.length < 32) {
  const message = "FATAL: SESSION_COOKIE_SECRET must be 32+ characters (see .env.example), or run with DASHBOARD_AUTH=off on a trusted network.";
  console.error(message);
  throw new Error(message);
}

// Login throttling (S5): best-effort only. The Map is per-process, so on
// serverless (many lambda instances) or multi-instance hosting it does not
// enforce a global limit — authoritative rate limiting is Supabase Auth's own
// on signInWithPassword. A shared store (Redis/DB) is a later phase.
const loginAttempts = new Map(); // ip -> { count, firstAt, lockedUntil }
const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_LOCK_MS = 15 * 60 * 1000;

// Fixed-window counters shared by the signup and device-claim throttles. Same
// best-effort caveat as loginAttempts: per-process, so not a global limit on
// serverless. Keyed by a caller-scoped string ("signup:ip:1.2.3.4",
// "claim:user:<uuid>"). rateLimited() bumps the count and reports whether this
// hit is over the limit.
const rateBuckets = new Map(); // key -> { count, firstAt }
const RATE_MAX_WINDOW_MS = 60 * 60 * 1000; // longest window any caller uses; drives the sweep
function rateLimited(key, max, windowMs) {
  const now = Date.now();
  const rec = rateBuckets.get(key) || { count: 0, firstAt: now };
  if (now - rec.firstAt > windowMs) {
    rec.count = 0;
    rec.firstAt = now;
  }
  rec.count += 1;
  rateBuckets.set(key, rec);
  return rec.count > max;
}

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8"
};

let profile = {
  address: process.env.CAN_LOGGER_ADDRESS || "canlogger.local",
  deviceName: process.env.DEVICE_NAME || "Family Vehicle",
  token: "",
  serviceMode: false,
  mode: dashboardMode
};

// ---------------------------------------------------------------------------
// Supabase clients. defaultFactory wraps createClient; __setSupabaseFactory lets
// the test suite inject a fake client (no live Supabase in CI).
// ---------------------------------------------------------------------------
const defaultFactory = (url, key, options) => createClient(url, key, options);
let supabaseFactory = defaultFactory;
let serviceClientInstance = null;

export function __setSupabaseFactory(factory) {
  supabaseFactory = factory || defaultFactory;
  serviceClientInstance = null; // rebuild lazily with the new factory
}

// anon-key client, no persisted session — used only for password login + token refresh.
function authClient() {
  return supabaseFactory(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

// Per-request client carrying the user's access token so RLS applies to every read.
function userClient(accessToken) {
  return supabaseFactory(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

// service-role client: BYPASSES RLS. Created once. ONLY for ESP32 ingestion
// (POST /api/cloud/status) and the device->user attribution lookup. NEVER for
// user-facing reads.
function serviceClient() {
  if (!serviceClientInstance) {
    serviceClientInstance = supabaseFactory(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
  }
  return serviceClientInstance;
}

function json(res, status, payload) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(JSON.stringify(payload));
}

function text(res, status, body, contentType = "text/plain; charset=utf-8") {
  res.writeHead(status, {
    "content-type": contentType,
    "cache-control": "no-store"
  });
  res.end(body);
}

async function readBody(req) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 1024 * 1024) {
      throw new Error("Request body is too large.");
    }
  }
  return body;
}

// Periodic sweep (S5): drop stale login-attempt records instead of only pruning
// on a hit to that exact key. (Sessions are now stateless — nothing else to sweep.)
function sweepExpired() {
  const now = Date.now();
  for (const [ip, rec] of loginAttempts) {
    const keepUntil = Math.max(rec.lockedUntil || 0, (rec.firstAt || 0) + LOGIN_WINDOW_MS);
    if (keepUntil <= now) {
      loginAttempts.delete(ip);
    }
  }
  for (const [key, rec] of rateBuckets) {
    if ((rec.firstAt || 0) + RATE_MAX_WINDOW_MS <= now) {
      rateBuckets.delete(key);
    }
  }
}

// Trust a forwarded client IP only from the hosting platform's own header, never
// the caller-supplied X-Forwarded-For (spoofable: lets an attacker dodge the
// login throttle or lock out someone else's IP). CLIENT_IP_HEADER overrides the
// default for other platforms; verify the correct header at deploy time.
const trustedIpHeader = String(process.env.CLIENT_IP_HEADER || "x-vercel-forwarded-for").toLowerCase();
function clientIp(req) {
  const platform = String(req.headers[trustedIpHeader] || "").split(",")[0].trim();
  return platform || req.socket?.remoteAddress || "unknown";
}

function loginLocked(ip) {
  const rec = loginAttempts.get(ip);
  return Boolean(rec && rec.lockedUntil && rec.lockedUntil > Date.now());
}

function recordLoginFailure(ip) {
  const now = Date.now();
  const rec = loginAttempts.get(ip) || { count: 0, firstAt: now, lockedUntil: 0 };
  if (now - rec.firstAt > LOGIN_WINDOW_MS) {
    rec.count = 0;
    rec.firstAt = now;
  }
  rec.count += 1;
  if (rec.count >= LOGIN_MAX_ATTEMPTS) {
    rec.lockedUntil = now + LOGIN_LOCK_MS;
  }
  loginAttempts.set(ip, rec);
}

// Constant-time compare via fixed-length SHA-256 digests (avoids the length leak
// and the throw-on-unequal-length footgun of comparing the raw buffers).
function tokenEquals(a, b) {
  return timingSafeEqual(
    createHash("sha256").update(String(a)).digest(),
    createHash("sha256").update(String(b)).digest()
  );
}

function verifyUploadToken(req) {
  if (!uploadToken) {
    // Only reached in pure local mode with auth off; when auth is required the
    // POST handler rejects an unset token with 503 before calling this (S4).
    return true;
  }
  return tokenEquals(req.headers.authorization || "", `Bearer ${uploadToken}`) ||
    tokenEquals(req.headers["x-device-token"] || "", uploadToken);
}

function parseCookies(req) {
  const header = req.headers.cookie || "";
  return Object.fromEntries(header.split(";").map((part) => {
    const [key, ...value] = part.trim().split("=");
    return [key, decodeURIComponent(value.join("="))];
  }).filter(([key]) => key));
}

function readSessionCookie(req) {
  const cookies = parseCookies(req);
  return cookies[hostSessionCookieName] || cookies[sessionCookieName] || null;
}

// Secure is set unless the connection is plainly local dev (host localhost /
// 127.0.0.1 / ::1 over plain HTTP). Cloud mode is always Secure (S7).
function isSecureRequest(req) {
  if (dashboardMode === "cloud") {
    return true;
  }
  if (req.headers["x-forwarded-proto"] === "https") {
    return true;
  }
  // Otherwise require real TLS evidence. "host is not localhost" is NOT evidence:
  // it set `__Host-...; Secure` on plain-HTTP LAN responses (canlogger.local),
  // which browsers silently drop -> permanent login loop.
  return Boolean(req.socket?.encrypted);
}

function setSessionCookie(req, res, value) {
  const secure = isSecureRequest(req);
  // __Host- prefix requires Secure + Path=/ + no Domain; fall back to the plain
  // name for local dev so an http:// session still works (S8).
  const name = secure ? hostSessionCookieName : sessionCookieName;
  const maxAge = Math.floor(cookieMaxAgeMs / 1000);
  res.setHeader("set-cookie", `${name}=${encodeURIComponent(value)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure ? "; Secure" : ""}`);
}

function clearSessionCookie(res) {
  res.setHeader("set-cookie", [
    `${hostSessionCookieName}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0; Secure`,
    `${sessionCookieName}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`
  ]);
}

// ---------------------------------------------------------------------------
// Stateless session: the Supabase session lives inside the __Host- cookie,
// AES-256-GCM encrypted with a key derived from SESSION_COOKIE_SECRET. No
// server-side store. Layout: base64url( iv[12] | authTag[16] | ciphertext ).
// ---------------------------------------------------------------------------
let cookieKeyCache = null;
function cookieKey() {
  if (!cookieKeyCache) {
    cookieKeyCache = scryptSync(sessionCookieSecret, "canlogger-session-v1", 32);
  }
  return cookieKeyCache;
}

function encryptSession(payload) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", cookieKey(), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
}

function decryptSession(value) {
  try {
    const buf = Buffer.from(String(value), "base64url");
    if (buf.length < 29) {
      return null;
    }
    const decipher = createDecipheriv("aes-256-gcm", cookieKey(), buf.subarray(0, 12));
    decipher.setAuthTag(buf.subarray(12, 28));
    const body = Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]);
    return JSON.parse(body.toString("utf8"));
  } catch {
    return null;
  }
}

function sessionFromSupabase(s) {
  return {
    access_token: s.access_token,
    refresh_token: s.refresh_token,
    expires_at: s.expires_at || Math.floor(Date.now() / 1000) + 3600,
    userId: s.user?.id || null,
    email: s.user?.email || ""
  };
}

// Single-flight token refresh. A page load fires several authenticated API calls
// at once; without this each would call refreshSession() with the same rotating
// refresh token and every caller but the first would lose the race and 401.
// Keyed by refresh token; the entry is cleared once settled so a later request
// can retry. In-memory only — cross-instance races remain and are inherent.
const refreshInFlight = new Map();
function refreshSessionSingleFlight(refreshToken) {
  let pending = refreshInFlight.get(refreshToken);
  if (!pending) {
    pending = (async () => {
      try {
        const { data, error } = await authClient().auth.refreshSession({ refresh_token: refreshToken });
        return !error && data?.session ? data.session : null;
      } catch {
        return null;
      }
    })().finally(() => refreshInFlight.delete(refreshToken));
    refreshInFlight.set(refreshToken, pending);
  }
  return pending;
}

// Read + decrypt the cookie; refresh the Supabase token when it is within 60s of
// expiry and re-set the cookie on rotation. Returns null (and clears the cookie)
// when there is no valid session.
async function getSession(req, res) {
  const raw = readSessionCookie(req);
  if (!raw) {
    return null;
  }
  let sess = decryptSession(raw);
  if (!sess || !sess.access_token || !sess.refresh_token) {
    return null;
  }
  const now = Math.floor(Date.now() / 1000);
  if (!sess.expires_at || sess.expires_at - now <= 60) {
    const refreshed = await refreshSessionSingleFlight(sess.refresh_token);
    if (!refreshed) {
      clearSessionCookie(res);
      return null;
    }
    sess = sessionFromSupabase(refreshed);
    setSessionCookie(req, res, encryptSession(sess));
  }
  return sess;
}

// ---------------------------------------------------------------------------
// CSRF (S6): a state-changing POST that carries an Origin/Referer must match our
// host. A same-origin <form> POST that sends neither header is still allowed.
// ---------------------------------------------------------------------------
function sameOriginRequest(req) {
  const source = req.headers.origin || req.headers.referer || "";
  if (!source) {
    return true;
  }
  try {
    return new URL(source).host === req.headers.host;
  } catch {
    return false;
  }
}

function authStatusFor(session) {
  return {
    authRequired,
    authConfigured,
    authenticated: Boolean(session) || !authRequired,
    email: session?.email || "",
    customerId,
    mode: dashboardMode
  };
}

function requireBrowserAuth(req, res, session) {
  if (!authRequired) {
    return true;
  }
  if (!authConfigured) {
    json(res, 503, {
      error: "Dashboard login is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY in hosting environment variables."
    });
    return false;
  }
  if (session) {
    return true;
  }
  json(res, 401, { error: "Login required." });
  return false;
}

function normalizeAddress(input) {
  const trimmed = String(input || "").trim();
  if (!trimmed) {
    return "";
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed.replace(/\/+$/, "");
  }
  return `http://${trimmed.replace(/\/+$/, "")}`;
}

async function fetchLogger(route, options = {}) {
  const base = normalizeAddress(profile.address);
  if (!base) {
    throw new Error("Logger address is empty.");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
  try {
    const headers = { ...(options.headers || {}) };
    if (profile.token) {
      headers.authorization = `Bearer ${profile.token}`;
    }
    return await fetch(`${base}${route}`, {
      ...options,
      headers,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
}

function vehicleStateFromStatus(status) {
  if (status.engine) {
    return status.moving ? "Moving" : status.idle ? "Idling" : "Engine on";
  }
  if (status.ignition) {
    return "Ignition on";
  }
  return status.moving ? "Moving" : "Parked";
}

function alertMessage(eventType, faultCode) {
  const messages = {
    MESSAGE_TIMEOUT: "A required vehicle message stopped arriving.",
    MESSAGE_RECOVERED: "A previously missing vehicle message recovered.",
    ROLLING_COUNTER_ERROR: "A message sequence looked irregular.",
    PERIOD_TOO_FAST: "A vehicle message arrived faster than expected.",
    PERIOD_TOO_SLOW: "A vehicle message arrived slower than expected.",
    CRC_ERROR: "A message integrity check failed.",
    CAN_RX_OVERFLOW: "The logger received more traffic than it could process briefly.",
    CAN_ERROR_PASSIVE: "The CAN controller reported a bus error state.",
    CAN_TX_BUS_OFF: "The CAN controller reported bus-off.",
    CAN_BUS_WARNING: "The CAN controller reported a warning state.",
    HARD_BRAKING: "Hard braking was detected.",
    HARD_ACCELERATION: "Hard acceleration was detected."
  };
  return messages[eventType] || (faultCode ? "Vehicle network warning detected." : "Vehicle status changed.");
}

function severityFromStatus(status) {
  if (status.faultCode && String(status.faultCode).includes("F")) {
    return "critical";
  }
  if (status.faultCode) {
    return "warning";
  }
  return "ok";
}

function baseLocation(location) {
  return location || {
    gpsStatus: "not_connected",
    lastKnownLocation: null,
    latitude: null,
    longitude: null,
    route: []
  };
}

function normalizeCloudPayload(payload) {
  const metrics = payload.metrics || {};
  const raw = payload.raw || payload;
  const faultCode = payload.faultCode || raw.faultCode || "";
  const eventType = payload.eventType || raw.eventType || "";
  return {
    connected: true,
    source: "cloud",
    updatedAt: payload.updatedAt || new Date().toISOString(),
    deviceName: payload.deviceName || profile.deviceName,
    loggerAddress: payload.deviceId || payload.loggerAddress || "cloud upload",
    health: payload.health || (faultCode ? (severityFromStatus({ faultCode }) === "critical" ? "Critical alert" : "Warning") : "Healthy"),
    monitoring: payload.monitoring || "Cloud monitoring",
    vehicleState: payload.vehicleState || vehicleStateFromStatus(raw),
    latestEvent: payload.latestEvent || eventType || (raw.logging ? "Monitoring session active" : "Cloud status received"),
    activeAlert: payload.activeAlert || (faultCode ? alertMessage(eventType, faultCode) : "No active alerts"),
    location: baseLocation(payload.location),
    raw,
    metrics: {
      received: Number(metrics.received ?? raw.received ?? 0),
      logged: Number(metrics.logged ?? raw.logged ?? 0),
      decoded: Number(metrics.decoded ?? raw.decoded ?? 0),
      events: Number(metrics.events ?? raw.events ?? 0),
      conditionEvents: Number(metrics.conditionEvents ?? raw.conditionEvents ?? 0),
      dropped: Number(metrics.dropped ?? raw.dropped ?? 0),
      rejected: Number(metrics.rejected ?? raw.rejected ?? 0),
      speedKph: Number(metrics.speedKph ?? raw.speed ?? 0),
      brakeBar: Number(metrics.brakeBar ?? raw.brake ?? 0),
      accelerationMps2: Number(metrics.accelerationMps2 ?? raw.accel ?? 0)
    }
  };
}

// Normalized status object -> device_status_latest row columns.
function statusToRow(status) {
  return {
    source: status.source || "cloud",
    health: status.health,
    vehicle_state: status.vehicleState,
    monitoring: status.monitoring,
    latest_event: status.latestEvent,
    active_alert: status.activeAlert,
    speed_kph: status.metrics.speedKph,
    brake_bar: status.metrics.brakeBar,
    acceleration_mps2: status.metrics.accelerationMps2,
    received_frames: status.metrics.received,
    logged_frames: status.metrics.logged,
    decoded_signals: status.metrics.decoded,
    event_count: status.metrics.events,
    fault_count: status.metrics.conditionEvents,
    dropped_frames: status.metrics.dropped,
    rejected_frames: status.metrics.rejected,
    gps_status: status.location?.gpsStatus || "not_connected",
    latitude: status.location?.latitude ?? null,
    longitude: status.location?.longitude ?? null,
    raw_payload: status.raw || {},
    received_at: status.updatedAt
  };
}

// device_status_latest row -> the normalized status object the client renders.
function rowToStatus(row) {
  return {
    connected: true,
    source: row.source || "cloud",
    updatedAt: row.received_at || new Date().toISOString(),
    deviceName: profile.deviceName,
    loggerAddress: "cloud upload",
    health: row.health || "Unknown",
    monitoring: row.monitoring || "Cloud monitoring",
    vehicleState: row.vehicle_state || "Unknown",
    latestEvent: row.latest_event || "Cloud status received",
    activeAlert: row.active_alert || "No active alerts",
    location: {
      gpsStatus: row.gps_status || "not_connected",
      lastKnownLocation: null,
      latitude: row.latitude ?? null,
      longitude: row.longitude ?? null,
      route: []
    },
    raw: row.raw_payload || {},
    metrics: {
      received: Number(row.received_frames || 0),
      logged: Number(row.logged_frames || 0),
      decoded: Number(row.decoded_signals || 0),
      events: Number(row.event_count || 0),
      conditionEvents: Number(row.fault_count || 0),
      dropped: Number(row.dropped_frames || 0),
      rejected: Number(row.rejected_frames || 0),
      speedKph: Number(row.speed_kph || 0),
      brakeBar: Number(row.brake_bar || 0),
      accelerationMps2: Number(row.acceleration_mps2 || 0)
    }
  };
}

function rowToEvent(row) {
  return {
    id: row.id,
    time: row.received_at,
    title: row.title,
    severity: row.severity || "info",
    status: row.status || "info",
    service: {
      faultCode: row.fault_code || "",
      canId: row.can_id || "",
      rawReason: row.raw_reason || ""
    }
  };
}

function rowToFile(row) {
  return {
    name: row.file_name,
    size: Number(row.byte_size || 0),
    active: false,
    fileType: row.file_type,
    serviceOnly: Boolean(row.service_only)
  };
}

function waitingForCloudStatus() {
  return {
    connected: false,
    source: "cloud",
    updatedAt: new Date().toISOString(),
    deviceName: profile.deviceName,
    loggerAddress: "cloud upload endpoint",
    health: "Waiting for logger upload",
    monitoring: "Cloud mode",
    vehicleState: "Unknown",
    latestEvent: "No cloud data received yet",
    activeAlert: "Deploy this dashboard, then configure the ESP32 to POST status updates.",
    location: baseLocation(),
    raw: {},
    metrics: {
      received: 0,
      logged: 0,
      decoded: 0,
      events: 0,
      conditionEvents: 0,
      dropped: 0,
      rejected: 0,
      speedKph: 0,
      brakeBar: 0,
      accelerationMps2: 0
    }
  };
}

function mapStatus(status) {
  const faultCode = status.faultCode || "";
  return {
    connected: true,
    source: "local",
    updatedAt: new Date().toISOString(),
    deviceName: profile.deviceName,
    loggerAddress: profile.address,
    health: faultCode ? (severityFromStatus(status) === "critical" ? "Critical alert" : "Warning") : "Healthy",
    monitoring: status.autoEnabled ? "Automatic monitoring" : "Manual monitoring",
    vehicleState: vehicleStateFromStatus(status),
    latestEvent: status.logging ? "Monitoring session active" : "Live monitoring active",
    activeAlert: faultCode ? alertMessage("", faultCode) : "No active alerts",
    location: baseLocation(),
    raw: status,
    metrics: {
      received: Number(status.received || 0),
      logged: Number(status.logged || 0),
      decoded: Number(status.decoded || 0),
      events: Number(status.events || 0),
      conditionEvents: Number(status.conditionEvents || 0),
      dropped: Number(status.dropped || 0),
      rejected: Number(status.rejected || 0),
      speedKph: Number(status.speed || 0),
      brakeBar: Number(status.brake || 0),
      accelerationMps2: Number(status.accel || 0)
    }
  };
}

function demoStatus() {
  return mapStatus({
    logging: true,
    autoEnabled: true,
    autoSession: true,
    received: 12842,
    logged: 614,
    decoded: 8840,
    events: 7,
    conditionEvents: 1,
    faultCode: "",
    queued: 0,
    dropped: 0,
    rejected: 4,
    engine: true,
    ignition: true,
    moving: true,
    braking: false,
    accelerating: false,
    idle: false,
    speed: 42.5,
    brake: 0,
    accel: 0.4,
    time: new Date().toLocaleString(),
    file: "/Logging_20260709_073000.csv"
  });
}

function demoFiles() {
  return [
    { name: "/Logging_20260709_073000_events.csv", size: 1460, active: true },
    { name: "/Logging_20260709_073000.csv", size: 21880, active: true },
    { name: "/Logging_20260708_061500_events.csv", size: 2890, active: false }
  ];
}

function friendlyEventsFromStatus(dashboardStatus) {
  const raw = dashboardStatus.raw || {};
  const events = [];
  if (raw.faultCode) {
    events.push({
      id: `fault-${raw.faultCode}`,
      time: dashboardStatus.updatedAt,
      title: dashboardStatus.activeAlert,
      severity: severityFromStatus(raw),
      status: "active",
      service: {
        faultCode: raw.faultCode,
        canId: raw.canId || "See ESP32 event log",
        rawReason: raw.rawReason || raw.faultCode
      }
    });
  }
  events.push({
    id: "latest-state",
    time: dashboardStatus.updatedAt,
    title: `${dashboardStatus.vehicleState} - ${dashboardStatus.latestEvent}`,
    severity: "info",
    status: raw.logging ? "active" : "recovered",
    service: {
      faultCode: raw.faultCode || "",
      canId: raw.canId || "",
      rawReason: JSON.stringify(raw)
    }
  });
  return events;
}

function cloudEventFromStatus(status, payload) {
  return {
    id: String(Date.now()),
    time: status.updatedAt,
    title: status.activeAlert !== "No active alerts" ? status.activeAlert : status.latestEvent,
    severity: severityFromStatus(status.raw),
    status: payload.recovered ? "recovered" : (payload.faultCode ? "active" : "info"),
    service: {
      faultCode: payload.faultCode || status.raw.faultCode || "",
      canId: payload.canId || status.raw.canId || "",
      rawReason: payload.rawReason || JSON.stringify(status.raw)
    }
  };
}

// ---------------------------------------------------------------------------
// Per-user Postgres reads. Every read goes through the user's own client (so
// RLS applies) AND adds an explicit user_id / device_id filter (defense in
// depth: testable with a mocked client, independent of un-runnable RLS).
// ---------------------------------------------------------------------------
async function ownedDeviceUuids(client, userId) {
  const { data, error } = await client
    .from("user_devices")
    .select("device_id")
    .eq("user_id", userId); // explicit owner filter in addition to RLS
  if (error) {
    throw new Error(error.message || "user_devices lookup failed");
  }
  return (data || []).map((r) => r.device_id).filter(Boolean);
}

async function latestStatusForUser(session) {
  const client = userClient(session.access_token);
  const ids = await ownedDeviceUuids(client, session.userId);
  if (!ids.length) {
    return null;
  }
  const { data, error } = await client
    .from("device_status_latest")
    .select("*")
    .in("device_id", ids)
    .order("received_at", { ascending: false })
    .limit(1);
  if (error) {
    throw new Error(error.message || "device_status_latest read failed");
  }
  return data && data[0] ? rowToStatus(data[0]) : null;
}

async function eventsForUser(session, limit = 100) {
  const client = userClient(session.access_token);
  const ids = await ownedDeviceUuids(client, session.userId);
  if (!ids.length) {
    return [];
  }
  const { data, error } = await client
    .from("device_events")
    .select("*")
    .in("device_id", ids)
    .order("received_at", { ascending: false })
    .limit(limit);
  if (error) {
    throw new Error(error.message || "device_events read failed");
  }
  return (data || []).map(rowToEvent);
}

async function filesForUser(session, limit = 200) {
  const client = userClient(session.access_token);
  const ids = await ownedDeviceUuids(client, session.userId);
  if (!ids.length) {
    return [];
  }
  const { data, error } = await client
    .from("report_files")
    .select("*")
    .in("device_id", ids)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    throw new Error(error.message || "report_files read failed");
  }
  return (data || []).map(rowToFile);
}

// The devices this user has already claimed. Same pattern as the other per-user
// reads: user's own client (RLS) + explicit user_id filter. Only the fields the
// SPA needs to decide "show the claim screen or the dashboard".
async function devicesForUser(session) {
  const client = userClient(session.access_token);
  const { data, error } = await client
    .from("user_devices")
    .select("device_id, access_level")
    .eq("user_id", session.userId);
  if (error) {
    throw new Error(error.message || "user_devices read failed");
  }
  return (data || []).map((r) => ({ id: r.device_id, accessLevel: r.access_level || "viewer" }));
}

// Server-mediated device claim. Runs entirely on the service-role client:
// user_devices has no INSERT policy, so the user's own client could not write
// the link. Match devices by device_id + claim_code, require the device to have
// actually reported (a device_status_latest row), then upsert the viewer link
// (idempotent - re-claiming is a no-op, not an error).
async function claimDevice(session, deviceId, claimCode) {
  if (!authConfigured || !supabaseServiceKey) {
    return { status: 503, body: { ok: false, error: "Device claiming is not configured on the server." } };
  }
  const svc = serviceClient();

  const devLookup = await svc
    .from("devices")
    .select("id, claim_code")
    .eq("device_id", deviceId)
    .limit(1);
  if (devLookup.error) {
    return { status: 502, body: { ok: false, error: devLookup.error.message } };
  }
  const device = devLookup.data && devLookup.data[0];
  // Compare the code even when the device is missing so a wrong id and a wrong
  // code look the same to the caller (no device-id enumeration oracle).
  const codeOk = Boolean(device && device.claim_code && tokenEquals(device.claim_code, claimCode));
  if (!device || !codeOk) {
    return { status: 404, body: { ok: false, error: "No device matches that ID and claim code." } };
  }

  const seen = await svc
    .from("device_status_latest")
    .select("device_id")
    .eq("device_id", device.id)
    .limit(1);
  if (seen.error) {
    return { status: 502, body: { ok: false, error: seen.error.message } };
  }
  if (!seen.data || !seen.data[0]) {
    return { status: 409, body: { ok: false, error: "This device has not reported to the cloud yet. Power it on, wait for its first upload, then try again." } };
  }

  const link = await svc
    .from("user_devices")
    .upsert({ user_id: session.userId, device_id: device.id, access_level: "viewer" }, { onConflict: "user_id,device_id" });
  if (link.error) {
    return { status: 502, body: { ok: false, error: link.error.message } };
  }
  return { status: 200, body: { ok: true, deviceId } };
}

// ESP32 upload -> resolve the device row by sha256(DEVICE_UPLOAD_TOKEN), then
// write device_status_latest + device_events with the service-role client.
async function ingestDeviceStatus(payload) {
  if (!authConfigured || !supabaseServiceKey) {
    return { status: 503, body: { ok: false, error: "Supabase is not configured for cloud ingestion." } };
  }
  const status = normalizeCloudPayload(payload);
  const svc = serviceClient();
  const tokenHash = createHash("sha256").update(uploadToken).digest("hex");
  const devLookup = await svc
    .from("devices")
    .select("id")
    .eq("upload_token_hash", tokenHash)
    .limit(1);
  if (devLookup.error) {
    return { status: 502, body: { ok: false, error: devLookup.error.message } };
  }
  const deviceUuid = devLookup.data && devLookup.data[0] && devLookup.data[0].id;
  if (!deviceUuid) {
    return {
      status: 503,
      body: { ok: false, error: "Device not provisioned. Add a devices row whose upload_token_hash is sha256(DEVICE_UPLOAD_TOKEN)." }
    };
  }
  const upsert = await svc
    .from("device_status_latest")
    .upsert({ device_id: deviceUuid, ...statusToRow(status) }, { onConflict: "device_id" });
  if (upsert.error) {
    return { status: 502, body: { ok: false, error: upsert.error.message } };
  }
  // Only log genuine event signals, not status fields. latestEvent/activeAlert
  // ride along on every heartbeat and are already mirrored in
  // device_status_latest, so inserting on them fills device_events unbounded.
  if (payload.eventType || payload.faultCode || payload.recovered) {
    const evt = cloudEventFromStatus(status, payload);
    const insert = await svc.from("device_events").insert({
      device_id: deviceUuid,
      received_at: status.updatedAt,
      event_time: status.updatedAt,
      title: evt.title,
      severity: evt.severity,
      status: evt.status,
      fault_code: evt.service.faultCode || null,
      can_id: evt.service.canId || null,
      raw_reason: evt.service.rawReason || null,
      raw_payload: status.raw || {}
    });
    if (insert.error) {
      return { status: 502, body: { ok: false, error: insert.error.message } };
    }
  }
  return { status: 200, body: { ok: true, updatedAt: status.updatedAt } };
}

async function handleApi(req, res, url) {
  // S6: block cross-origin state-changing POSTs before any handler runs.
  const stateChangingPaths = ["/api/auth/login", "/api/auth/signup", "/api/auth/logout", "/api/profile", "/api/devices/claim"];
  if (req.method === "POST" && stateChangingPaths.includes(url.pathname) && !sameOriginRequest(req)) {
    return json(res, 403, { error: "Cross-origin request blocked." });
  }

  if (url.pathname === "/api/auth/login" && req.method === "POST") {
    if (!authRequired) {
      return json(res, 200, authStatusFor(null));
    }
    if (!authConfigured) {
      return json(res, 503, {
        ok: false,
        error: "Dashboard login is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY."
      });
    }
    const ip = clientIp(req);
    if (loginLocked(ip)) {
      return json(res, 429, { ok: false, error: "Too many failed login attempts. Try again later." });
    }
    let body;
    try {
      body = JSON.parse(await readBody(req) || "{}");
    } catch {
      return json(res, 400, { ok: false, error: "Invalid login data." });
    }
    const email = String(body.email || "").trim();
    const password = String(body.password || "");
    const { data, error } = await authClient().auth.signInWithPassword({ email, password });
    if (error || !data?.session) {
      recordLoginFailure(ip);
      return json(res, 401, { ok: false, error: "Invalid email or password." });
    }
    loginAttempts.delete(ip);
    const sess = sessionFromSupabase(data.session);
    setSessionCookie(req, res, encryptSession(sess));
    return json(res, 200, { ok: true, ...authStatusFor(sess) });
  }

  if (url.pathname === "/api/auth/signup" && req.method === "POST") {
    // Every branch below echoes authConfigured/authRequired so the client never
    // has to special-case which response shape carries them: a response that
    // omits these two fields on some paths and includes them on others is the
    // trap that once made the client's local-mode check misfire on every
    // outcome (success included). Keep this contract consistent.
    if (!authRequired) {
      return json(res, 200, authStatusFor(null));
    }
    if (!authConfigured) {
      return json(res, 503, {
        ok: false,
        authRequired,
        authConfigured,
        error: "Dashboard login is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY."
      });
    }
    if (rateLimited(`signup:ip:${clientIp(req)}`, 5, 60 * 60 * 1000)) {
      return json(res, 429, { ok: false, authRequired, authConfigured, error: "Too many sign-up attempts. Try again later." });
    }
    let body;
    try {
      body = JSON.parse(await readBody(req) || "{}");
    } catch {
      return json(res, 400, { ok: false, authRequired, authConfigured, error: "Invalid sign-up data." });
    }
    const email = String(body.email || "").trim();
    const password = String(body.password || "");
    if (!email || password.length < 8) {
      return json(res, 400, { ok: false, authRequired, authConfigured, error: "Enter an email and a password of at least 8 characters." });
    }
    // Supabase sends the confirmation email (custom SMTP) and returns no session
    // when email confirmation is on. The link lands back on the dashboard root;
    // the user then signs in through /api/auth/login.
    const emailRedirectTo = `http${isSecureRequest(req) ? "s" : ""}://${req.headers.host}/`;
    const { data, error } = await authClient().auth.signUp({ email, password, options: { emailRedirectTo } });
    if (error) {
      // Generic message: don't confirm or deny that the email already exists.
      return json(res, 400, { ok: false, authRequired, authConfigured, error: "Could not create the account. Check the email, or sign in if you already have one." });
    }
    return json(res, 200, { ok: true, authRequired, authConfigured, emailConfirmationRequired: !data?.session });
  }

  // Cron warmup endpoint - keeps Vercel serverless functions warm
  if (url.pathname === "/api/cron/warmup" && req.method === "GET") {
    return json(res, 200, { ok: true, timestamp: new Date().toISOString() });
  }

  if (url.pathname === "/api/auth/logout" && req.method === "POST") {
    // Best-effort server-side revocation: a copied/logged cookie's refresh token
    // stays valid for weeks otherwise. Never let logout 500 — the cookie clear
    // below is the part that must always happen.
    const sess = decryptSession(readSessionCookie(req));
    if (sess?.access_token) {
      try {
        await userClient(sess.access_token).auth.signOut();
      } catch {
        // token already invalid / Supabase unreachable - fall through to clear
      }
    }
    clearSessionCookie(res);
    return json(res, 200, { ok: true });
  }

  if (url.pathname === "/api/cloud/status" && req.method === "POST") {
    // S4: fail closed — an unset upload token must not accept device POSTs
    // whenever auth is required (cloud mode or DASHBOARD_AUTH on).
    if (!uploadToken && authRequired) {
      return json(res, 503, { ok: false, error: "DEVICE_UPLOAD_TOKEN not configured" });
    }
    if (!verifyUploadToken(req)) {
      return json(res, 401, { ok: false, error: "Invalid device token." });
    }
    let payload;
    try {
      payload = JSON.parse(await readBody(req) || "{}");
    } catch (error) {
      return json(res, 400, { ok: false, error: error.message });
    }
    const result = await ingestDeviceStatus(payload);
    return json(res, result.status, result.body);
  }

  // ---- everything below is an authenticated browser read ----
  const session = await getSession(req, res);

  if (url.pathname === "/api/auth/session" && req.method === "GET") {
    return json(res, 200, authStatusFor(session));
  }

  if (!requireBrowserAuth(req, res, session)) {
    return;
  }

  if (url.pathname === "/api/devices" && req.method === "GET") {
    try {
      const devices = await devicesForUser(session);
      return json(res, 200, { devices, count: devices.length });
    } catch {
      return json(res, 200, { devices: [], count: 0 });
    }
  }

  if (url.pathname === "/api/devices/claim" && req.method === "POST") {
    if (!authRequired) {
      return json(res, 403, { ok: false, error: "Device claiming is unavailable when dashboard auth is off." });
    }
    if (!session) {
      return json(res, 401, { ok: false, error: "Login required." });
    }
    const ip = clientIp(req);
    const hourMs = 60 * 60 * 1000;
    if (rateLimited(`claim:ip:${ip}`, 10, hourMs) || rateLimited(`claim:user:${session.userId}`, 10, hourMs)) {
      return json(res, 429, { ok: false, error: "Too many claim attempts. Try again later." });
    }
    let body;
    try {
      body = JSON.parse(await readBody(req) || "{}");
    } catch {
      return json(res, 400, { ok: false, error: "Invalid claim data." });
    }
    const deviceId = String(body.deviceId || "").trim();
    const claimCode = String(body.claimCode || "").trim();
    if (!deviceId || !claimCode) {
      return json(res, 400, { ok: false, error: "Enter the device ID and the claim code." });
    }
    const result = await claimDevice(session, deviceId, claimCode);
    return json(res, result.status, result.body);
  }

  if (url.pathname === "/api/cloud/status" && req.method === "GET") {
    try {
      return json(res, 200, (await latestStatusForUser(session)) || waitingForCloudStatus());
    } catch {
      return json(res, 200, waitingForCloudStatus());
    }
  }

  if (url.pathname === "/api/cloud/events" && req.method === "GET") {
    try {
      return json(res, 200, await eventsForUser(session));
    } catch {
      return json(res, 200, []);
    }
  }

  if (url.pathname === "/api/profile" && req.method === "GET") {
    if (dashboardMode === "cloud") {
      // Cloud profile is environment-managed and shared across all users; never
      // expose the mutable module object. Return a read-only view.
      return json(res, 200, {
        address: "cloud upload",
        deviceName: process.env.DEVICE_NAME || "Family Vehicle",
        token: "",
        serviceMode: false,
        mode: "cloud"
      });
    }
    return json(res, 200, profile);
  }

  if (url.pathname === "/api/profile" && req.method === "POST") {
    if (dashboardMode === "cloud") {
      return json(res, 403, { error: "Profile is managed via environment configuration in cloud mode." });
    }
    try {
      const data = JSON.parse(await readBody(req) || "{}");
      profile = {
        address: String(data.address || profile.address || "").trim(),
        deviceName: String(data.deviceName || profile.deviceName || "Vehicle").trim(),
        token: String(data.token || ""),
        serviceMode: Boolean(data.serviceMode),
        mode: dashboardMode
      };
      return json(res, 200, profile);
    } catch {
      return json(res, 400, { error: "Invalid profile data." });
    }
  }

  if (url.pathname === "/api/test-connection") {
    if (dashboardMode === "cloud") {
      try {
        const status = await latestStatusForUser(session);
        return json(res, 200, {
          ok: Boolean(status),
          status: status || waitingForCloudStatus(),
          error: status ? "" : "No ESP32 cloud upload received yet."
        });
      } catch (error) {
        return json(res, 200, { ok: false, status: waitingForCloudStatus(), error: error.message });
      }
    }
    try {
      const response = await fetchLogger("/api/status");
      if (!response.ok) {
        return json(res, 502, { ok: false, error: `Logger returned HTTP ${response.status}.` });
      }
      const status = await response.json();
      return json(res, 200, { ok: true, status: mapStatus(status) });
    } catch (error) {
      return json(res, 200, {
        ok: false,
        error: error.name === "AbortError" ? "Connection timed out." : error.message
      });
    }
  }

  if (url.pathname === "/api/dashboard-status") {
    if (dashboardMode === "cloud") {
      try {
        return json(res, 200, (await latestStatusForUser(session)) || waitingForCloudStatus());
      } catch (error) {
        return json(res, 200, { ...waitingForCloudStatus(), connectionError: error.message });
      }
    }
    if (url.searchParams.get("demo") === "1") {
      return json(res, 200, demoStatus());
    }
    try {
      const response = await fetchLogger("/api/status");
      const status = await response.json();
      return json(res, 200, mapStatus(status));
    } catch (error) {
      return json(res, 200, {
        ...demoStatus(),
        connected: false,
        health: "Logger offline",
        monitoring: "Demo data shown",
        activeAlert: "Connect to the logger to view live vehicle health.",
        connectionError: error.name === "AbortError" ? "Connection timed out." : error.message
      });
    }
  }

  if (url.pathname === "/api/alerts") {
    if (dashboardMode === "cloud") {
      try {
        const [events, status] = await Promise.all([eventsForUser(session), latestStatusForUser(session)]);
        const synth = status ? friendlyEventsFromStatus(status) : [];
        return json(res, 200, [...events, ...synth].slice(0, 100));
      } catch {
        return json(res, 200, []);
      }
    }
    const statusResponse = await fetch(`${serverBase(req)}/api/dashboard-status`);
    const dashboardStatus = await statusResponse.json();
    return json(res, 200, friendlyEventsFromStatus(dashboardStatus));
  }

  if (url.pathname === "/api/files") {
    if (dashboardMode === "cloud") {
      try {
        return json(res, 200, await filesForUser(session));
      } catch {
        return json(res, 200, []);
      }
    }
    try {
      const response = await fetchLogger("/api/files");
      return json(res, 200, await response.json());
    } catch {
      return json(res, 200, demoFiles());
    }
  }

  if (url.pathname === "/api/view") {
    if (dashboardMode === "cloud") {
      return text(res, 200, "Cloud mode stores summary reports. Raw SD file preview is available from local/service mode.\n");
    }
    const name = url.searchParams.get("name") || "";
    try {
      const response = await fetchLogger(`/view?name=${encodeURIComponent(name)}`);
      return text(res, response.ok ? 200 : response.status, await response.text());
    } catch {
      return text(res, 200, "timestamp_text,timestamp_ms,event_type,severity,details\nDEMO,1000,ENGINE_STARTED,INFO,state=on\nDEMO,1800,VEHICLE_STARTED_MOVING,INFO,state=on\n");
    }
  }

  if (url.pathname === "/api/download") {
    if (dashboardMode === "cloud") {
      return text(res, 200, "Cloud mode report download is available from Download report. Raw SD logs stay on the logger unless explicitly uploaded.\n", "text/plain; charset=utf-8");
    }
    const name = url.searchParams.get("name") || "";
    try {
      const response = await fetchLogger(`/download?name=${encodeURIComponent(name)}`);
      const body = Buffer.from(await response.arrayBuffer());
      res.writeHead(response.ok ? 200 : response.status, {
        "content-type": response.headers.get("content-type") || "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${path.basename(name) || "can-logger-report.csv"}"`
      });
      return res.end(body);
    } catch {
      return text(res, 200, "timestamp_text,timestamp_ms,event_type,severity,details\nDEMO,1000,ENGINE_STARTED,INFO,state=on\n", "text/csv; charset=utf-8");
    }
  }

  if (url.pathname === "/api/report") {
    let dashboardStatus;
    if (dashboardMode === "cloud") {
      try {
        dashboardStatus = (await latestStatusForUser(session)) || waitingForCloudStatus();
      } catch {
        dashboardStatus = waitingForCloudStatus();
      }
    } else {
      dashboardStatus = await (await fetch(`${serverBase(req)}/api/dashboard-status`)).json();
    }
    const rows = [
      ["CAN Logger Vehicle Health Report"],
      ["Generated", new Date().toLocaleString()],
      ["Device", dashboardStatus.deviceName],
      ["Source", dashboardStatus.source || dashboardMode],
      ["Logger", dashboardStatus.loggerAddress],
      ["Connection", dashboardStatus.connected ? "Connected" : "Offline"],
      ["Health", dashboardStatus.health],
      ["Vehicle state", dashboardStatus.vehicleState],
      ["Monitoring", dashboardStatus.monitoring],
      ["Latest event", dashboardStatus.latestEvent],
      ["Active alert", dashboardStatus.activeAlert],
      [],
      ["Session summary"],
      ["Events", dashboardStatus.metrics.events],
      ["Fault events", dashboardStatus.metrics.conditionEvents],
      ["Received frames", dashboardStatus.metrics.received],
      ["Logged frames", dashboardStatus.metrics.logged],
      ["Dropped frames", dashboardStatus.metrics.dropped]
    ];
    const csv = rows.map((row) => row.map((cell) => `"${String(cell ?? "").replaceAll("\"", "\"\"")}"`).join(",")).join("\n");
    res.writeHead(200, {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": "attachment; filename=\"vehicle-health-report.csv\""
    });
    return res.end(csv);
  }

  return json(res, 404, { error: "API route not found." });
}

function serverBase(req) {
  return `http://${req.headers.host}`;
}

async function serveStatic(req, res, url) {
  const requested = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const filePath = path.normalize(path.join(publicDir, requested));
  if (!filePath.startsWith(publicDir) || !existsSync(filePath)) {
    return text(res, 404, "Not found");
  }
  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, {
    "content-type": mimeTypes[ext] || "application/octet-stream"
  });
  createReadStream(filePath).pipe(res);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }
    await serveStatic(req, res, url);
  } catch (error) {
    json(res, 500, { error: error.message });
  }
});

function logStartupWarnings() {
  if (authRequired && !authConfigured) {
    console.warn("Auth is required but SUPABASE_URL / SUPABASE_ANON_KEY are not set - login will return 503.");
  }
  if (dashboardMode === "cloud" && !supabaseServiceKey) {
    console.warn("SUPABASE_SERVICE_ROLE_KEY is not set - ESP32 cloud ingestion (POST /api/cloud/status) will fail.");
  }
}

async function start() {
  // Fatal: without a real secret the cookie key is scrypt("") - a world-known
  // value an attacker can use to forge an authenticated session cookie. Only
  // enforced when auth is actually required (LAN / DASHBOARD_AUTH=off still boots).
  if (authRequired && !sessionCookieSecret) {
    console.error("FATAL: SESSION_COOKIE_SECRET is not set. Set 32+ random bytes (see .env.example) or run with DASHBOARD_AUTH=off on a trusted network.");
    process.exit(1);
  }
  logStartupWarnings();
  setInterval(sweepExpired, 60 * 1000).unref();
  server.listen(port, () => {
    console.log(`CAN Logger dashboard running at http://localhost:${port}`);
    console.log(`Dashboard mode: ${dashboardMode}`);
    console.log(`Logger address: ${profile.address}`);
  });
}

const isMainModule = Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
  start();
}

export { server, handleApi, start };
