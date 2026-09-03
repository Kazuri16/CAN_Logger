import http from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createReadStream, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, timingSafeEqual, scryptSync, createHash } from "node:crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");
const port = Number(process.env.PORT || 5177);
const requestTimeoutMs = 3500;
const dashboardMode = String(process.env.DASHBOARD_MODE || "local").toLowerCase();
const uploadToken = process.env.DEVICE_UPLOAD_TOKEN || "";
const authEmail = process.env.DASHBOARD_AUTH_EMAIL || "customer@example.com";
const authPasswordHash = process.env.DASHBOARD_AUTH_PASSWORD_HASH || "";
const authPasswordPlain = process.env.DASHBOARD_AUTH_PASSWORD || ""; // deprecated plaintext fallback (S1)
const authConfigured = Boolean(authPasswordHash || authPasswordPlain);
const customerId = process.env.CUSTOMER_ID || "CANLOGGER-001";
const authRequired = process.env.DASHBOARD_AUTH !== "off" && (dashboardMode === "cloud" || authConfigured);
const sessionCookieName = "canlogger_session";
const hostSessionCookieName = "__Host-canlogger_session"; // used when the cookie is Secure (S8)
const sessionTtlMs = 24 * 60 * 60 * 1000;
const sessionAbsoluteMaxMs = 7 * 24 * 60 * 60 * 1000; // absolute session lifetime cap (S8)
const sessions = new Map();
const dataDir = path.join(__dirname, "data");
const cloudStorePath = path.join(dataDir, "cloud-store.json");
const sessionsPath = path.join(dataDir, "sessions.json");

// Login throttling (S5). ponytail: per-IP in-memory Map + timestamps; a shared
// store is needed for multiple instances (same later phase as session persistence).
const loginAttempts = new Map(); // ip -> { count, firstAt, lockedUntil }
const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_LOCK_MS = 15 * 60 * 1000;

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

let cloudStore = {
  latest: null,
  events: [],
  files: []
};

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

async function loadCloudStore() {
  try {
    cloudStore = JSON.parse(await readFile(cloudStorePath, "utf8"));
  } catch {
    cloudStore = { latest: null, events: [], files: [] };
  }
}

async function saveCloudStore() {
  await mkdir(dataDir, { recursive: true });
  await writeFile(cloudStorePath, JSON.stringify(cloudStore, null, 2));
}

// Session store (S2). ponytail: in-memory Map mirrored to data/sessions.json so a
// restart doesn't log everyone out. Multi-instance / horizontal scaling needs a
// shared store (Redis/DB) instead — later phase.
async function loadSessions() {
  try {
    const raw = JSON.parse(await readFile(sessionsPath, "utf8"));
    const now = Date.now();
    for (const [token, session] of Object.entries(raw)) {
      if (session && session.expiresAt > now && (!session.absoluteExpiresAt || session.absoluteExpiresAt > now)) {
        sessions.set(token, session);
      }
    }
  } catch {
    // no persisted sessions yet
  }
}

async function saveSessions() {
  try {
    await mkdir(dataDir, { recursive: true });
    await writeFile(sessionsPath, JSON.stringify(Object.fromEntries(sessions), null, 2));
  } catch (error) {
    console.warn(`Could not persist sessions: ${error.message}`);
  }
}

// Periodic sweep (S2/S5): drop expired sessions and stale login-attempt records
// instead of only pruning on a hit to that exact key.
function sweepExpired() {
  const now = Date.now();
  for (const [token, session] of sessions) {
    if (!session || session.expiresAt <= now || (session.absoluteExpiresAt && session.absoluteExpiresAt <= now)) {
      sessions.delete(token);
    }
  }
  for (const [ip, rec] of loginAttempts) {
    const keepUntil = Math.max(rec.lockedUntil || 0, (rec.firstAt || 0) + LOGIN_WINDOW_MS);
    if (keepUntil <= now) {
      loginAttempts.delete(ip);
    }
  }
}

function clientIp(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return forwarded || req.socket?.remoteAddress || "unknown";
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

function verifyUploadToken(req) {
  if (!uploadToken) {
    // Only reached in pure local mode with auth off; when auth is required the
    // POST handler rejects an unset token with 503 before calling this (S4).
    return true;
  }
  const header = req.headers.authorization || "";
  return header === `Bearer ${uploadToken}` || req.headers["x-device-token"] === uploadToken;
}

function parseCookies(req) {
  const header = req.headers.cookie || "";
  return Object.fromEntries(header.split(";").map((part) => {
    const [key, ...value] = part.trim().split("=");
    return [key, decodeURIComponent(value.join("="))];
  }).filter(([key]) => key));
}

function readSessionToken(req) {
  const cookies = parseCookies(req);
  return cookies[hostSessionCookieName] || cookies[sessionCookieName] || null;
}

function currentSession(req) {
  const token = readSessionToken(req);
  if (!token) {
    return null;
  }
  const session = sessions.get(token);
  const now = Date.now();
  if (!session || session.expiresAt < now || (session.absoluteExpiresAt && session.absoluteExpiresAt < now)) {
    sessions.delete(token);
    return null;
  }
  return session;
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
  const host = String(req.headers.host || "").split(":")[0].toLowerCase();
  const localDev = host === "" || host === "localhost" || host === "127.0.0.1" || host === "::1";
  return !localDev;
}

function setSessionCookie(req, res, token) {
  const secure = isSecureRequest(req);
  // __Host- prefix requires Secure + Path=/ + no Domain; fall back to the plain
  // name for local dev so an http:// session still works (S8).
  const name = secure ? hostSessionCookieName : sessionCookieName;
  const maxAge = Math.floor(sessionTtlMs / 1000);
  res.setHeader("set-cookie", `${name}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure ? "; Secure" : ""}`);
}

function clearSessionCookie(res) {
  res.setHeader("set-cookie", [
    `${hostSessionCookieName}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0; Secure`,
    `${sessionCookieName}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`
  ]);
}

// Constant-time comparison that hashes both sides first, so a mismatch never
// leaks the length of the secret (S5).
function constantEquals(a, b) {
  const ha = createHash("sha256").update(String(a)).digest();
  const hb = createHash("sha256").update(String(b)).digest();
  return timingSafeEqual(ha, hb);
}

function hashPassword(password, salt = randomBytes(16).toString("hex")) {
  return `${salt}:${scryptSync(String(password), salt, 64).toString("hex")}`;
}

// Verify a candidate password against DASHBOARD_AUTH_PASSWORD_HASH ("salt:hexhash",
// scrypt) or, as a deprecated fallback, the plaintext DASHBOARD_AUTH_PASSWORD (S1).
function verifyPassword(candidate) {
  if (authPasswordHash) {
    const [salt, expectedHex] = authPasswordHash.split(":");
    if (!salt || !expectedHex) {
      return false;
    }
    const expected = Buffer.from(expectedHex, "hex");
    let derived;
    try {
      derived = scryptSync(String(candidate), salt, expected.length);
    } catch {
      return false;
    }
    return derived.length === expected.length && timingSafeEqual(derived, expected);
  }
  if (authPasswordPlain) {
    return constantEquals(candidate, authPasswordPlain);
  }
  return false;
}

// CSRF defense for state-changing POSTs (S6): when the request carries an Origin
// (or Referer) it must match our own host. A same-origin <form> POST that sends
// neither header is still allowed.
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

function authStatus(req, session = currentSession(req)) {
  return {
    authRequired,
    authConfigured,
    authenticated: Boolean(session) || !authRequired,
    email: session?.email || (authRequired ? "" : authEmail),
    customerId,
    mode: dashboardMode
  };
}

function requireBrowserAuth(req, res) {
  if (!authRequired) {
    return true;
  }
  if (!authConfigured) {
    json(res, 503, {
      error: "Dashboard login is not configured. Set DASHBOARD_AUTH_EMAIL and DASHBOARD_AUTH_PASSWORD_HASH in hosting environment variables."
    });
    return false;
  }
  if (currentSession(req)) {
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
      events: cloudStore.events.length,
      conditionEvents: 0,
      dropped: 0,
      rejected: 0,
      speedKph: 0,
      brakeBar: 0,
      accelerationMps2: 0
    }
  };
}

function cloudStatus() {
  return cloudStore.latest || waitingForCloudStatus();
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
    id: `${Date.now()}-${cloudStore.events.length}`,
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

async function handleApi(req, res, url) {
  // S6: block cross-origin state-changing POSTs before any handler runs.
  const stateChangingPaths = ["/api/auth/login", "/api/auth/logout", "/api/profile"];
  if (req.method === "POST" && stateChangingPaths.includes(url.pathname) && !sameOriginRequest(req)) {
    return json(res, 403, { error: "Cross-origin request blocked." });
  }

  if (url.pathname === "/api/auth/session" && req.method === "GET") {
    return json(res, 200, authStatus(req));
  }

  if (url.pathname === "/api/auth/login" && req.method === "POST") {
    if (!authRequired) {
      return json(res, 200, authStatus(req));
    }
    if (!authConfigured) {
      return json(res, 503, {
        ok: false,
        error: "Dashboard login is not configured. Set DASHBOARD_AUTH_EMAIL and DASHBOARD_AUTH_PASSWORD_HASH."
      });
    }
    const ip = clientIp(req);
    if (loginLocked(ip)) {
      return json(res, 429, { ok: false, error: "Too many failed login attempts. Try again later." });
    }
    try {
      const body = JSON.parse(await readBody(req) || "{}");
      const emailOk = constantEquals(String(body.email || "").trim().toLowerCase(), authEmail.trim().toLowerCase());
      const passwordOk = verifyPassword(body.password || "");
      if (!emailOk || !passwordOk) {
        recordLoginFailure(ip);
        return json(res, 401, { ok: false, error: "Invalid email or password." });
      }
      loginAttempts.delete(ip);
      const token = randomBytes(32).toString("hex");
      const now = Date.now();
      const session = {
        email: authEmail,
        customerId,
        expiresAt: now + sessionTtlMs,
        absoluteExpiresAt: now + sessionAbsoluteMaxMs
      };
      sessions.set(token, session);
      await saveSessions();
      setSessionCookie(req, res, token);
      return json(res, 200, { ok: true, ...authStatus(req, session) });
    } catch {
      return json(res, 400, { ok: false, error: "Invalid login data." });
    }
  }

  if (url.pathname === "/api/auth/logout" && req.method === "POST") {
    const token = readSessionToken(req);
    if (token && sessions.delete(token)) {
      await saveSessions();
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
    try {
      const payload = JSON.parse(await readBody(req) || "{}");
      const status = normalizeCloudPayload(payload);
      cloudStore.latest = status;
      if (payload.eventType || payload.latestEvent || payload.faultCode || payload.activeAlert) {
        cloudStore.events.unshift(cloudEventFromStatus(status, payload));
        cloudStore.events = cloudStore.events.slice(0, 100);
      }
      await saveCloudStore();
      return json(res, 200, { ok: true, updatedAt: status.updatedAt });
    } catch (error) {
      return json(res, 400, { ok: false, error: error.message });
    }
  }

  if (!requireBrowserAuth(req, res)) {
    return;
  }

  if (url.pathname === "/api/cloud/status" && req.method === "GET") {
    return json(res, 200, cloudStatus());
  }

  if (url.pathname === "/api/cloud/events" && req.method === "GET") {
    return json(res, 200, cloudStore.events);
  }

  if (url.pathname === "/api/profile" && req.method === "GET") {
    return json(res, 200, profile);
  }

  if (url.pathname === "/api/profile" && req.method === "POST") {
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
      return json(res, 200, {
        ok: Boolean(cloudStore.latest),
        status: cloudStatus(),
        error: cloudStore.latest ? "" : "No ESP32 cloud upload received yet."
      });
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
      return json(res, 200, cloudStatus());
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
      const statusEvents = friendlyEventsFromStatus(cloudStatus());
      return json(res, 200, [...cloudStore.events, ...statusEvents].slice(0, 100));
    }
    const statusResponse = await fetch(`${serverBase(req)}/api/dashboard-status`);
    const dashboardStatus = await statusResponse.json();
    return json(res, 200, friendlyEventsFromStatus(dashboardStatus));
  }

  if (url.pathname === "/api/files") {
    if (dashboardMode === "cloud") {
      return json(res, 200, cloudStore.files);
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
    const dashboardStatus = dashboardMode === "cloud"
      ? cloudStatus()
      : await (await fetch(`${serverBase(req)}/api/dashboard-status`)).json();
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
  if (authPasswordPlain && !authPasswordHash) {
    console.warn("DASHBOARD_AUTH_PASSWORD is deprecated; generate a hash with `node server.js --hash-password` and set DASHBOARD_AUTH_PASSWORD_HASH instead.");
  }
  if (authConfigured && authEmail === "customer@example.com") {
    console.warn("DASHBOARD_AUTH_EMAIL is still the default customer@example.com; set a real login email.");
  }
}

async function start() {
  await loadCloudStore();
  await loadSessions();
  logStartupWarnings();
  setInterval(sweepExpired, 60 * 1000).unref();
  server.listen(port, () => {
    console.log(`CAN Logger dashboard running at http://localhost:${port}`);
    console.log(`Dashboard mode: ${dashboardMode}`);
    console.log(`Logger address: ${profile.address}`);
  });
}

// `node server.js --hash-password ["<password>"]` prints a scrypt hash (salt:hexhash)
// for DASHBOARD_AUTH_PASSWORD_HASH, reading the password from the arg or stdin (S1).
function runHashPasswordCli() {
  const inline = process.argv[process.argv.indexOf("--hash-password") + 1];
  const emit = (password) => {
    const value = String(password || "").replace(/\r?\n$/, "");
    if (!value) {
      console.error('Usage: node server.js --hash-password "<password>"  (or pipe the password on stdin)');
      process.exit(1);
    }
    console.log(hashPassword(value));
    process.exit(0);
  };
  if (inline) {
    emit(inline);
    return;
  }
  let input = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => { input += chunk; });
  process.stdin.on("end", () => emit(input.trim()));
}

const isMainModule = Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
  if (process.argv.includes("--hash-password")) {
    runHashPasswordCli();
  } else {
    start();
  }
}

export { server, handleApi, start, loadCloudStore, loadSessions, hashPassword };
