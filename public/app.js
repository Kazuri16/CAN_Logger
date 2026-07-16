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

const $ = (selector) => document.querySelector(selector);

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
    throw new Error(`Request failed: HTTP ${response.status}`);
  }
  const type = response.headers.get("content-type") || "";
  return type.includes("application/json") ? response.json() : response.text();
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
    <article class="alert-card ${alert.severity}">
      <div class="alert-title">
        <span>${alert.title}</span>
        <span class="badge">${alert.status}</span>
      </div>
      <div>${new Date(alert.time).toLocaleString()}</div>
      <div class="service-details">
        CAN ID: ${alert.service.canId || "n/a"}<br>
        Fault code: ${alert.service.faultCode || "n/a"}<br>
        Raw reason: ${alert.service.rawReason || "n/a"}
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
        <strong>${file.name}</strong>
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

await loadProfile();
await refreshStatus();
await refreshFiles();
setInterval(refreshStatus, 3000);
