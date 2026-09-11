const pages = {
  home: document.querySelector("#homePage"),
  alerts: document.querySelector("#alertsPage"),
  reports: document.querySelector("#reportsPage"),
  settings: document.querySelector("#settingsPage"),
  location: document.querySelector("#locationPage"),
  ai: document.querySelector("#aiPage")
};

const titles = {
  home: "Home",
  alerts: "Alerts",
  reports: "Reports",
  settings: "Settings",
  location: "Location",
  ai: "AI Assistant"
};

let profile = {
  address: "canlogger.local",
  deviceName: "Family Vehicle",
  token: "",
  serviceMode: false
};
let dashboardStatus = null;
let authSession = null;
let authMode = "login"; // "login" | "signup"

// GPS tracking state
let map = null;
let gpsMarker = null;
let gpsRoute = [];
let lastGpsData = null;

// AI state
let aiHistory = [];
let aiCloudEnabled = false;

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
  Object.entries(pages).forEach(([name, element]) => {
    if (element) element.classList.toggle("active", name === page);
  });
  document.querySelectorAll(".nav-link").forEach((button) => button.classList.toggle("active", button.dataset.page === page));
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
  $("#mainApp").classList.add("d-none");
  $("#loginMessage").textContent = message;
  $("#loginEmail").focus();
}

function hideLogin() {
  document.body.classList.remove("locked");
  $("#loginScreen").hidden = true;
}

function setAuthMode(mode) {
  authMode = mode;
  const signup = mode === "signup";
  $("#loginTitle").textContent = signup ? "Create account" : "Sign in";
  $("#authSubmit").textContent = signup ? "Create account" : "Sign in";
  $("#authToggle").textContent = signup ? "Have an account? Sign in" : "New here? Create an account";
  $("#loginPassword").setAttribute("autocomplete", signup ? "new-password" : "current-password");
  $("#loginDescription").textContent = signup
    ? "Pick a password of at least 8 characters. We'll email you a confirmation link."
    : "Use the email and password assigned to this vehicle dashboard.";

  // Toggle confirm password field for signup
  const confirmRow = $("#confirmPasswordRow");
  confirmRow.hidden = !signup;
  if (signup) {
    $("#confirmPassword").required = true;
    $("#loginMessage").textContent = "Pick a strong password of at least 8 characters.";
  } else {
    $("#confirmPassword").required = false;
    $("#loginMessage").textContent = "Enter your dashboard account details.";
  }

  // Clear validation hints
  clearValidationHints();
  $("#passwordStrength").hidden = true;
}

function clearValidationHints() {
  ["emailHint", "passwordHint", "confirmHint"].forEach(id => {
    const el = $(id);
    if (el) el.textContent = "";
  });
}

function validateEmail(email) {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email);
}

function getPasswordStrength(password) {
  let score = 0;
  if (password.length >= 8) score++;
  if (/[A-Z]/.test(password)) score++;
  if (/[0-9]/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;
  return score;
}

function updatePasswordStrength(password) {
  const strengthEl = $("#passwordStrength");
  const labelEl = $("#strengthLabel");
  const barEl = $("#strengthBar");
  const hintEl = $("#passwordHint");

  if (!password) {
    strengthEl.hidden = true;
    if (hintEl) hintEl.textContent = "";
    if (barEl) barEl.style.width = "0%";
    return;
  }

  strengthEl.hidden = false;
  const score = getPasswordStrength(password);

  // Update bar width
  const pct = (score / 4) * 100;
  if (barEl) barEl.style.width = pct + "%";

  // Update label
  const labels = ["Weak", "Fair", "Good", "Strong"];
  const colors = ["bg-danger", "bg-warning", "bg-info", "bg-success"];
  if (labelEl) {
    labelEl.textContent = labels[score - 1] || "";
    labelEl.className = "form-hint " + (score <= 2 ? "text-danger" : score === 3 ? "text-warning" : "text-success");
  }

  // Update hint
  const hints = [
    "Add more characters (min 8)",
    "Add uppercase, numbers, or symbols",
    "Good — consider adding symbols",
    "Excellent password!"
  ];
  if (hintEl) hintEl.textContent = hints[score - 1] || "";
}

function validatePassword(password) {
  if (!password) return "Password is required";
  if (password.length < 8) return "Password must be at least 8 characters";
  return "";
}

function validateConfirmPassword(password, confirm) {
  if (!confirm) return "Please confirm your password";
  if (password !== confirm) return "Passwords do not match";
  return "";
}

// Real-time validation listeners
document.addEventListener("DOMContentLoaded", () => {
  const emailInput = $("#loginEmail");
  const passwordInput = $("#loginPassword");
  const confirmInput = $("#confirmPassword");

  emailInput.addEventListener("blur", () => {
    const val = emailInput.value.trim();
    const hint = $("#emailHint");
    if (!val) {
      hint.textContent = "";
      return;
    }
    if (!validateEmail(val)) {
      hint.textContent = "Please enter a valid email";
      hint.className = "form-hint text-danger";
    } else {
      hint.textContent = "✓ Valid email";
      hint.className = "form-hint text-success";
    }
  });

  passwordInput.addEventListener("input", () => {
    updatePasswordStrength(passwordInput.value);
    if (authMode === "signup" && confirmInput && confirmInput.value) {
      const err = validateConfirmPassword(passwordInput.value, confirmInput.value);
      const hint = $("#confirmHint");
      if (err) {
        hint.textContent = err;
        hint.className = "form-hint text-danger";
      } else {
        hint.textContent = "✓ Passwords match";
        hint.className = "form-hint text-success";
      }
    }
  });

  if (confirmInput) {
    confirmInput.addEventListener("blur", () => {
      if (authMode === "signup" && confirmInput.value) {
        const err = validateConfirmPassword(passwordInput.value, confirmInput.value);
        const hint = $("#confirmHint");
        if (err) {
          hint.textContent = err;
          hint.className = "form-hint text-danger";
        } else {
          hint.textContent = "✓ Passwords match";
          hint.className = "form-hint text-success";
        }
      }
    });
  }
});

function showClaim(message = "This links the device to your account.") {
  document.body.classList.add("locked");
  hideLogin();
  $("#claimScreen").hidden = false;
  $("#claimMessage").textContent = message;
  $("#claimDeviceId").focus();
}

function hideClaim() {
  document.body.classList.remove("locked");
  $("#claimScreen").hidden = true;
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
  $("#mainApp").classList.remove("d-none");
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

async function handleSignup() {
  $("#loginMessage").textContent = "Creating account...";
  // fetch directly (not api()) so a 400/429 body is read instead of thrown.
  const res = await fetch("/api/auth/signup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: $("#loginEmail").value,
      password: $("#loginPassword").value
    })
  });
  const body = await res.json().catch(() => ({}));
  $("#loginPassword").value = ""; // don't leave the password in the DOM (S10)

  // Handle local mode (auth off) - signup not available
  if (!body.authConfigured && !body.authRequired) {
    $("#loginMessage").textContent = "Signup requires cloud mode. Set SUPABASE_URL and SUPABASE_ANON_KEY to enable user registration.";
    $("#loginMessage").className = "alert alert-warning";
    return;
  }

  if (res.ok && body.ok) {
    setAuthMode("login");
    $("#loginMessage").textContent = body.emailConfirmationRequired
      ? "Account created. Check your email for the confirmation link, then sign in."
      : "Account created. You can sign in now.";
    $("#loginMessage").className = "alert alert-success";
    return;
  }
  $("#loginMessage").textContent = body.error || "Could not create the account.";
  $("#loginMessage").className = "alert alert-danger";
}

async function handleAuthSubmit(event) {
  event.preventDefault();
  if (authMode === "signup") {
    await handleSignup();
    return;
  }
  await handleLogin(event);
}

async function handleClaim(event) {
  event.preventDefault();
  $("#claimMessage").textContent = "Connecting device...";
  const res = await fetch("/api/devices/claim", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      deviceId: $("#claimDeviceId").value,
      claimCode: $("#claimCode").value
    })
  });
  const body = await res.json().catch(() => ({}));
  if (res.ok && body.ok) {
    $("#claimCode").value = "";
    hideClaim();
    await initializeDashboard();
    return;
  }
  $("#claimMessage").textContent = body.error || "Could not connect that device.";
}

async function handleLogout() {
  await api("/api/auth/logout", { method: "POST" });
  authSession = null;
  hideClaim();
  showLogin("Signed out.");
}

async function initializeDashboard() {
  if (authSession?.authRequired) {
    try {
      const owned = await api("/api/devices");
      if (!owned.count) {
        showClaim("Enter your device's ID and claim code to finish setup.");
        return;
      }
    } catch {
      // a devices lookup failure should not block the dashboard
    }
  }
  hideClaim();
  await loadProfile();
  await refreshStatus();
  await refreshFiles();
  initMap();
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

  // Update gauge colors based on health status
  gauge.className = "avatar avatar-xl rounded-circle d-flex align-items-center justify-content-center";
  if (kind === "warning") {
    gauge.classList.add("bg-warning-subtle", "text-warning");
  } else if (kind === "critical") {
    gauge.classList.add("bg-danger-subtle", "text-danger");
  } else {
    gauge.classList.add("bg-primary-subtle", "text-primary");
  }
  gauge.style.fontSize = "24px";
  gauge.style.fontWeight = "700";
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
  connection.className = "badge " + (status.connected ? "bg-success" : "bg-warning");
  $("#setupBanner").hidden = !status.connected;
}

function renderAlerts(alerts) {
  const markup = alerts.map((alert) => `
    <div class="alert alert-${escapeHtml(alert.severity) === 'warning' ? 'warning' : escapeHtml(alert.severity) === 'critical' ? 'danger' : 'info'} alert-dismissible fade show" role="alert">
      <strong>${escapeHtml(alert.title)}</strong>
      <span class="badge bg-${escapeHtml(alert.severity) === 'warning' ? 'warning' : escapeHtml(alert.severity) === 'critical' ? 'danger' : 'info'} ms-2">${escapeHtml(alert.status)}</span>
      <div class="small text-muted">${escapeHtml(new Date(alert.time).toLocaleString())}</div>
      ${profile.serviceMode ? `<div class="service-details small text-muted mt-2">CAN ID: ${escapeHtml(alert.service?.canId || "n/a")}<br>Fault code: ${escapeHtml(alert.service?.faultCode || "n/a")}<br>Reason: ${escapeHtml(alert.service?.rawReason || "n/a")}</div>` : ''}
      <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="close"></button>
    </div>
  `).join("");
  $("#alertsList").innerHTML = markup || "<p class='text-muted'>No alerts recorded.</p>";
  $("#homeAlerts").innerHTML = markup || "<p class='text-muted'>No active alerts.</p>";
}

function isRawLog(file) {
  return !String(file.name || "").includes("_events");
}

function renderFiles(files) {
  const visibleFiles = profile.serviceMode ? files : files.filter((file) => !isRawLog(file));
  $("#fileList").innerHTML = visibleFiles.map((file) => `
    <div class="list-group-item d-flex justify-content-between align-items-center">
      <div>
        <strong>${escapeHtml(file.name)}</strong>
        <div class="small text-muted">${formatNumber(file.size)} bytes${file.active ? " - active session" : ""}</div>
      </div>
      <div class="btn-group">
        <a class="btn btn-sm btn-outline-primary" href="/api/download?name=${encodeURIComponent(file.name)}">Download</a>
        <button class="btn btn-sm btn-outline-secondary" data-preview="${encodeURIComponent(file.name)}">Preview</button>
      </div>
    </div>
  `).join("") || "<p class='text-muted'>No report files available yet.</p>";
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

// ==================== GPS Tracking ====================
function initMap() {
  // Initialize Leaflet map
  map = L.map('map').setView([0, 0], 2);

  // Add OpenStreetMap tiles (free, no API key needed)
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors'
  }).addTo(map);

  // Hide map until we have GPS data
  document.getElementById('map').style.display = 'none';
}

function updateMap(lat, lng, timestamp) {
  if (!map) return;

  document.getElementById('map').style.display = 'block';

  // Update center view
  map.setView([lat, lng], 13);

  // Add or update marker
  if (gpsMarker) {
    gpsMarker.setLatLng([lat, lng]);
  } else {
    gpsMarker = L.marker([lat, lng]).addTo(map)
      .bindPopup(`Vehicle Location<br>${new Date(timestamp).toLocaleString()}`)
      .openPopup();
  }

  // Add to route
  gpsRoute.push([lat, lng]);
  if (gpsRoute.length > 1) {
    L.polyline(gpsRoute, { color: 'blue', weight: 3 }).addTo(map);
  }

  // Update status
  $("#gpsStatus").textContent = "Connected";
  $("#gpsStatus").className = "text-success";
  $("#lastLocation").textContent = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
}

function updateLocationFromStatus(status) {
  // Check if status contains GPS data
  if (status.gpsLatitude && status.gpsLongitude) {
    updateMap(status.gpsLatitude, status.gpsLongitude, status.updatedAt);
  } else {
    // Try to get from metrics
    if (status.metrics?.latitude && status.metrics?.longitude) {
      updateMap(status.metrics.latitude, status.metrics.longitude, status.updatedAt);
    }
  }
}

async function refreshLocation() {
  try {
    const status = await api("/api/dashboard-status");
    updateLocationFromStatus(status);
  } catch (error) {
    console.error("Failed to refresh location:", error);
  }
}

// ==================== AI Assistant ====================
function addAiMessage(role, content) {
  const chat = $("#aiChat");
  const div = document.createElement("div");
  div.className = "mb-3";

  const badge = document.createElement("span");
  badge.className = `badge ${role === 'user' ? 'bg-primary' : 'bg-success'} mb-2`;
  badge.textContent = role === 'user' ? 'You' : 'AI';

  const p = document.createElement("p");
  p.className = "mb-0";
  p.textContent = content;

  div.appendChild(badge);
  div.appendChild(p);
  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;
}

async function sendAiQuery(query) {
  if (!query.trim()) return;

  addAiMessage("user", query);

  // Local AI analysis (always available)
  const localResponse = performLocalAnalysis(query);

  // If cloud AI is enabled, also call the API
  if (aiCloudEnabled) {
    try {
      const cloudResponse = await api("/api/ai/query", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query, history: aiHistory })
      });
      addAiMessage("ai", cloudResponse.answer);
      aiHistory.push({ role: "user", content: query });
      aiHistory.push({ role: "assistant", content: cloudResponse.answer });
    } catch (error) {
      addAiMessage("ai", localResponse);
    }
  } else {
    // Use local analysis
    setTimeout(() => addAiMessage("ai", localResponse), 500);
  }
}

function performLocalAnalysis(query) {
  const q = query.toLowerCase();

  // Fault diagnosis
  if (q.includes("fault") || q.includes("code") || q.includes("diagnos")) {
    if (dashboardStatus?.metrics?.faultCode) {
      return `Current fault code: ${dashboardStatus.metrics.faultCode}. This typically indicates a ${getFaultExplanation(dashboardStatus.metrics.faultCode)}. Recommended action: Check the corresponding sensor and inspect wiring connections.`;
    }
    return "No active fault codes detected. All systems appear to be operating normally.";
  }

  // Predictive maintenance
  if (q.includes("mainten") || q.includes("predict") || q.includes("when")) {
    if (dashboardStatus?.metrics?.events > 100) {
      return `Based on ${dashboardStatus.metrics.events} recorded events, I recommend scheduling maintenance within the next 500km. Key indicators: high event count suggests increased wear on braking system.`;
    }
    return "Vehicle health is good. Next scheduled maintenance can be delayed based on current usage patterns.";
  }

  // Anomaly detection
  if (q.includes("anomal") || q.includes("unusual") || q.includes("weird")) {
    if (dashboardStatus?.metrics?.accelerationMps2 > 0.5) {
      return "Detected unusual acceleration patterns. This could indicate aggressive driving or road conditions. Consider reviewing driving habits.";
    }
    return "No significant anomalies detected in recent driving patterns.";
  }

  // General health
  if (q.includes("health") || q.includes("how is") || q.includes("status")) {
    const health = dashboardStatus?.health || "Unknown";
    return `Current vehicle health status: ${health}. ${getHealthRecommendation(health)}`;
  }

  // Default response
  return "I can help you understand your vehicle's health data. Try asking about faults, maintenance, or anomalies.";
}

function getFaultExplanation(code) {
  const explanations = {
    "F01": "brake system pressure issue",
    "F02": "engine temperature warning",
    "F03": "battery voltage low",
    "F04": "oil pressure warning",
    "F05": " ABS system fault"
  };
  return explanations[code] || "a sensor or system fault";
}

function getHealthRecommendation(health) {
  const recs = {
    "Healthy": "Continue regular maintenance schedule.",
    "Warning": "Schedule a diagnostic check soon.",
    "Critical": "Immediate attention required. Pull over safely and contact service."
  };
  return recs[health] || "Monitor closely.";
}

// Theme toggle
function toggleTheme() {
  const html = document.documentElement;
  const current = html.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  html.setAttribute('data-theme', next);
  localStorage.setItem('theme', next);
}

// ==================== Event Listeners ====================
document.querySelectorAll(".nav-link").forEach((button) => button.addEventListener("click", () => setPage(button.dataset.page)));
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

$("#loginForm").addEventListener("submit", handleAuthSubmit);
$("#authToggle").addEventListener("click", () => setAuthMode(authMode === "login" ? "signup" : "login"));
$("#claimForm").addEventListener("submit", handleClaim);
$("#claimLogout").addEventListener("click", handleLogout);
$("#logoutButton").addEventListener("click", handleLogout);

// Location page
$("#refreshLocation").addEventListener("click", refreshLocation);

// AI Assistant
$("#aiSend").addEventListener("click", () => {
  const input = $("#aiInput");
  sendAiQuery(input.value);
  input.value = "";
});
$("#aiInput").addEventListener("keypress", (e) => {
  if (e.key === "Enter") {
    sendAiQuery(e.target.value);
    e.target.value = "";
  }
});
$("#aiCloudEnabled").addEventListener("change", (e) => {
  aiCloudEnabled = e.target.checked;
});

// Theme toggle
$("#themeToggle").addEventListener("click", toggleTheme);

// Restore theme preference
const savedTheme = localStorage.getItem('theme');
if (savedTheme) {
  document.documentElement.setAttribute('data-theme', savedTheme);
}

// Initialize
if (await checkAuth()) {
  await initializeDashboard();
}

setInterval(() => {
  if (authSession?.authenticated) {
    refreshStatus();
    // Update location if on location page
    if (!$("#locationPage").hidden) {
      refreshLocation();
    }
  }
}, 3000);
