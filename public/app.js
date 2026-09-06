const pages = {
  home: document.querySelector("#homePage"),
  alerts: document.querySelector("#alertsPage"),
  reports: document.querySelector("#reportsPage"),
  settings: document.querySelector("#settingsPage"),
  location: document.querySelector("#locationPage")
};

const titles = {
  home: "Home",
  alerts: "Alerts",
  reports: "Reports",
  settings: "Settings",
  location: "Future Location"
};

let profile = {
  address: "canlogger.local",
  deviceName: "Family Vehicle",
  token: "",
  serviceMode: false
};
let dashboardStatus = null;
let authSession = null;

const $ = (selector) => document.querySelector(selector);

// Escape untrusted values before they go into innerHTML. Device-supplied fields
// (alert titles, CAN IDs, fault codes, raw reasons, file names) reach the DOM
// this way, so escape at every interpolation site (S3).
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  })[ch]);
}

function setPage(page) {
  Object.entries(pages).forEach(([name, element]) => element.classList.toggle("active", name === page));
  document.querySelectorAll(".nav-item").forEach((button) => button.classList.toggle("active", button.dataset.page === page));
  $("#pageTitle").textContent = titles[page] || "Home";
}

function formatNumber(value, digits = 0) {
  return Number(value || 0).toLocaleString(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits
  });
}

function healthClass(status) {
  const text = String(status.health || "").toLowerCase();
  if (text.includes("critical")) return "critical";
  if (text.includes("warning") || text.includes("offline")) return "warning";
  return "ok";
}

function applyServiceMode() {
  document.body.classList.toggle("service-mode", Boolean(profile.serviceMode));
}

async function api(path, options) {
  const response = await fetch(path, options);
  if (!response.ok) {
    if (response.status === 401) {
      showLogin("Please sign in to continue.");
    }
    throw new Error(`Request failed: HTTP ${response.status}`);
  }
  const type = response.headers.get("content-type") || "";
  return type.includes("application/json") ? response.json() : response.text();
}

function showLogin(message = "Enter your dashboard account details.") {
  document.body.classList.add("locked");
  $("#loginScreen").hidden = false;
  $("#loginMessage").textContent = message;
  $("#loginEmail").focus();
}

function hideLogin() {
  document.body.classList.remove("locked");
  $("#loginScreen").hidden = true;
}

function renderAccount() {
  const email = authSession?.email || "Customer";
  const id = authSession?.customerId || "";
  $("#accountPill").textContent = id ? `${email} / ${id}` : email;
}

async function checkAuth() {
  authSession = await api("/api/auth/session");
  if (authSession.authRequired && !authSession.authConfigured) {
    showLogin("Login is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY on the server.");
    return false;
  }
  if (!authSession.authenticated) {
    showLogin();
    return false;
  }
  hideLogin();
  renderAccount();
  return true;
}

async function handleLogin(event) {
  event.preventDefault();
  $("#loginMessage").textContent = "Signing in...";
  try {
    const result = await api("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: $("#loginEmail").value,
        password: $("#loginPassword").value
      })
    });
    authSession = result;
    hideLogin();
    renderAccount();
    await initializeDashboard();
  } catch (error) {
    $("#loginMessage").textContent = "Sign in failed. Check the email and password.";
    $("#loginPassword").value = ""; // don't leave the password sitting in the DOM (S10)
  }
}

async function handleLogout() {
  await api("/api/auth/logout", { method: "POST" });
  authSession = null;
  showLogin("Signed out.");
}

async function initializeDashboard() {
  await loadProfile();
  await refreshStatus();
  await refreshFiles();
}
async function loadProfile() {
  profile = await api("/api/profile");
  $("#loggerAddress").value = profile.address || "";
  $("#deviceName").value = profile.deviceName || "";
  $("#token").value = profile.token || "";
  $("#serviceMode").checked = Boolean(profile.serviceMode);
  applyServiceMode();
}

function renderHome(status) {
  const kind = healthClass(status);
  const gauge = $("#healthGauge");
  const band = document.querySelector(".health-band");
  band.classList.toggle("warning", kind === "warning");
  band.classList.toggle("critical", kind === "critical");
  gauge.className = `health-gauge ${kind === "ok" ? "" : kind}`;
  gauge.textContent = kind === "critical" ? "!" : kind === "warning" ? "!" : "OK";

  $("#healthText").textContent = status.health;
  $("#activeAlertText").textContent = status.activeAlert;
  $("#monitoringStatus").textContent = status.monitoring;
  $("#vehicleState").textContent = status.vehicleState;
  $("#latestEvent").textContent = status.latestEvent;
  $("#loggerConnection").textContent = status.connected ? "Connected" : "Offline";
  $("#speedSignal").textContent = `${formatNumber(status.metrics.speedKph, 1)} kph`;
  $("#brakeSignal").textContent = `${formatNumber(status.metrics.brakeBar, 1)} bar`;
  $("#accelSignal").textContent = `${formatNumber(status.metrics.accelerationMps2, 2)} m/s2`;
  $("#eventSignal").textContent = `${formatNumber(status.metrics.events)} events`;
  $("#updatedAt").textContent = new Date(status.updatedAt).toLocaleTimeString();
  $("#reportEvents").textContent = formatNumber(status.metrics.events);
  $("#reportFaults").textContent = formatNumber(status.metrics.conditionEvents);

  const connection = $("#connectionPill");
  const cloudMode = status.source === "cloud";
  connection.textContent = status.connected ? `Connected to ${status.loggerAddress}` : cloudMode ? "Waiting for cloud upload" : `Offline: ${status.connectionError || "logger unavailable"}`;
  connection.classList.toggle("online", status.connected);
  connection.classList.toggle("offline", !status.connected);
  $("#setupBanner strong").textContent = cloudMode ? "Waiting for ESP32 upload" : "Connect your logger";
  $("#setupBanner span").textContent = cloudMode ? "Deploy the dashboard online, then configure the ESP32 to POST summaries to /api/cloud/status." : "Enter `canlogger.local` or the ESP32 IP address in Settings, then click Test connection.";
  $("#setupBanner").classList.toggle("visible", !status.connected);
}

function renderAlerts(alerts) {
  const markup = alerts.map((alert) => `
    <article class="alert-card ${escapeHtml(alert.severity)}">
      <div class="alert-title">
        <span>${escapeHtml(alert.title)}</span>
        <span class="badge">${escapeHtml(alert.status)}</span>
      </div>
      <div>${escapeHtml(new Date(alert.time).toLocaleString())}</div>
      <div class="service-details">
        CAN ID: ${escapeHtml(alert.service.canId || "n/a")}<br>
        Fault code: ${escapeHtml(alert.service.faultCode || "n/a")}<br>
        Raw reason: ${escapeHtml(alert.service.rawReason || "n/a")}
      </div>
    </article>
  `).join("");
  $("#alertsList").innerHTML = markup || "<p>No alerts recorded.</p>";
  $("#homeAlerts").innerHTML = markup || "<p>No active alerts.</p>";
}

function isRawLog(file) {
  return !String(file.name || "").includes("_events");
}

function renderFiles(files) {
  const visibleFiles = profile.serviceMode ? files : files.filter((file) => !isRawLog(file));
  $("#fileList").innerHTML = visibleFiles.map((file) => `
    <div class="file-row">
      <div>
        <strong>${escapeHtml(file.name)}</strong>
        <small>${formatNumber(file.size)} bytes${file.active ? " - active session" : ""}</small>
      </div>
      <div class="file-actions">
        <a class="secondary-button" href="/api/download?name=${encodeURIComponent(file.name)}">Download</a>
        <button class="text-button" data-preview="${encodeURIComponent(file.name)}">Preview</button>
      </div>
    </div>
  `).join("") || "<p>No report files available yet.</p>";
}

async function refreshStatus() {
  dashboardStatus = await api("/api/dashboard-status");
  renderHome(dashboardStatus);
  const alerts = await api("/api/alerts");
  renderAlerts(alerts);
}

async function refreshFiles() {
  const files = await api("/api/files");
  renderFiles(files);
}

async function saveProfile(event) {
  event.preventDefault();
  if (authSession?.mode === "cloud") {
    // Cloud profile is managed by the dashboard host (environment config); the
    // server rejects POST /api/profile with 403 in this mode.
    applyServiceMode();
    $("#testResult").textContent = "Settings are managed by the dashboard host in cloud mode.";
    return;
  }
  profile = await api("/api/profile", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      address: $("#loggerAddress").value,
      deviceName: $("#deviceName").value,
      token: $("#token").value,
      serviceMode: $("#serviceMode").checked
    })
  });
  applyServiceMode();
  $("#testResult").textContent = "Profile saved.";
  await refreshStatus();
  await refreshFiles();
}

async function testConnection() {
  $("#testResult").textContent = "Testing connection...";
  await saveProfile(new Event("submit"));
  const result = await api("/api/test-connection");
  $("#testResult").textContent = result.ok ? "Connection successful. Live vehicle status is available." : `Connection failed: ${result.error}`;
}

document.querySelectorAll(".nav-item").forEach((button) => button.addEventListener("click", () => setPage(button.dataset.page)));
document.querySelectorAll("[data-page-jump]").forEach((button) => button.addEventListener("click", () => setPage(button.dataset.pageJump)));
$("#connectShortcut").addEventListener("click", () => setPage("settings"));
$("#refreshButton").addEventListener("click", () => {
  refreshStatus();
  refreshFiles();
});
$("#profileForm").addEventListener("submit", saveProfile);
$("#testConnection").addEventListener("click", testConnection);
$("#serviceMode").addEventListener("change", () => {
  profile.serviceMode = $("#serviceMode").checked;
  applyServiceMode();
  refreshFiles();
});
$("#refreshFiles").addEventListener("click", refreshFiles);
$("#downloadReport").addEventListener("click", () => {
  window.location.href = "/api/report";
});
$("#fileList").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-preview]");
  if (!button) return;
  const text = await api(`/api/view?name=${button.dataset.preview}`);
  const blob = new Blob([text], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank", "noopener,noreferrer");
  setTimeout(() => URL.revokeObjectURL(url), 30000);
});

$("#loginForm").addEventListener("submit", handleLogin);
$("#logoutButton").addEventListener("click", handleLogout);

if (await checkAuth()) {
  await initializeDashboard();
}

setInterval(() => {
  if (authSession?.authenticated) {
    refreshStatus();
  }
}, 3000);
