import http from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createReadStream, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");
const port = Number(process.env.PORT || 5177);
const requestTimeoutMs = 3500;
const dashboardMode = String(process.env.DASHBOARD_MODE || "local").toLowerCase();
const uploadToken = process.env.DEVICE_UPLOAD_TOKEN || "";
const dataDir = path.join(__dirname, "data");
const cloudStorePath = path.join(dataDir, "cloud-store.json");

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

function verifyUploadToken(req) {
  if (!uploadToken) {
    return true;
  }
  const header = req.headers.authorization || "";
  return header === `Bearer ${uploadToken}` || req.headers["x-device-token"] === uploadToken;
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
  if (url.pathname === "/api/cloud/status" && req.method === "POST") {
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

await loadCloudStore();

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

server.listen(port, () => {
  console.log(`CAN Logger dashboard running at http://localhost:${port}`);
  console.log(`Dashboard mode: ${dashboardMode}`);
  console.log(`Logger address: ${profile.address}`);
});
