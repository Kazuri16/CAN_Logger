// Tests for the 12 auth findings (S1-S11 + Missing#4) fixed in the CAN Logger dashboard.
// Framework: Node stdlib `node:test` + `node:assert` only. No dependencies.
// Server is exercised via a child-process harness: env is fixed BEFORE spawn,
// each scenario gets its own port, we poll /api/auth/session until it answers.

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { readFileSync, writeFileSync, existsSync, rmSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hashPassword } from "../server.js"; // safe: isMainModule guard means no listener

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoDir = path.resolve(__dirname, "..");
const serverPath = path.join(repoDir, "server.js");
const dataDir = path.join(repoDir, "data");
const sessionsPath = path.join(dataDir, "sessions.json");
const cloudStorePath = path.join(dataDir, "cloud-store.json");
const appPath = path.join(repoDir, "public", "app.js");

const PASSWORD = "correct-horse-battery-staple";
const HASH = hashPassword(PASSWORD);
const EMAIL = "owner@fleet.test";

// Only remove data files the tests create; leave any pre-existing ones alone.
const preexisting = new Set([sessionsPath, cloudStorePath].filter(existsSync));
const children = [];

// Blank every auth-related var so the parent process env can't leak into a scenario.
const BASE_ENV = {
  DASHBOARD_MODE: "",
  DASHBOARD_AUTH: "",
  DASHBOARD_AUTH_EMAIL: "",
  DASHBOARD_AUTH_PASSWORD: "",
  DASHBOARD_AUTH_PASSWORD_HASH: "",
  DEVICE_UPLOAD_TOKEN: "",
  CUSTOMER_ID: ""
};

function clearData() {
  for (const f of [sessionsPath, cloudStorePath]) {
    if (!preexisting.has(f) && existsSync(f)) rmSync(f);
  }
}

async function startServer(env, port) {
  const child = spawn(process.execPath, [serverPath], {
    cwd: repoDir,
    env: { ...process.env, ...BASE_ENV, ...env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"]
  });
  children.push(child);
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (d) => { stdout += d; });
  child.stderr.on("data", (d) => { stderr += d; });
  const base = `http://localhost:${port}`;
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${base}/api/auth/session`);
      if (r.status) {
        return {
          base,
          child,
          get stdout() { return stdout; },
          get stderr() { return stderr; }
        };
      }
    } catch {
      // not listening yet
    }
    await sleep(50);
  }
  child.kill();
  throw new Error(`server on ${port} did not start. stderr=${stderr} stdout=${stdout}`);
}

const jsonPost = (base, pathname, body, headers = {}) =>
  fetch(`${base}${pathname}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body)
  });

function cookieToken(res) {
  const m = res.headers.getSetCookie().join("\n").match(/(?:__Host-)?canlogger_session=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

after(async () => {
  for (const c of children) {
    try { c.kill(); } catch { /* already gone */ }
  }
  await sleep(150);
  for (const f of [sessionsPath, cloudStorePath]) {
    if (!preexisting.has(f) && existsSync(f)) rmSync(f);
  }
});

// ---------------------------------------------------------------------------
// S1 - hashed-password auth + deprecation warning for plaintext
// ---------------------------------------------------------------------------
test("S1 hashed-password login: correct creds -> 200 ok + Set-Cookie; wrong -> 401", async () => {
  clearData();
  const s = await startServer({ DASHBOARD_AUTH_PASSWORD_HASH: HASH, DASHBOARD_AUTH_EMAIL: EMAIL }, 5311);

  const ok = await jsonPost(s.base, "/api/auth/login", { email: EMAIL, password: PASSWORD });
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).ok, true);
  assert.ok(ok.headers.getSetCookie().length > 0, "login sends Set-Cookie");

  const bad = await jsonPost(s.base, "/api/auth/login", { email: EMAIL, password: "not-the-password" });
  assert.equal(bad.status, 401);
});

test("S1 hashPassword round-trips: same salt -> identical hash, different pw -> different hash", () => {
  const salt = HASH.split(":")[0];
  assert.equal(hashPassword(PASSWORD, salt), HASH);
  assert.notEqual(hashPassword("different-password", salt), HASH);
});

test("S1 plaintext DASHBOARD_AUTH_PASSWORD still logs in AND emits deprecation warning on stderr", async () => {
  clearData();
  const s = await startServer({ DASHBOARD_AUTH_PASSWORD: "plain-secret", DASHBOARD_AUTH_EMAIL: EMAIL }, 5312);

  const r = await jsonPost(s.base, "/api/auth/login", { email: EMAIL, password: "plain-secret" });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).ok, true);

  await sleep(50);
  assert.match(s.stderr, /DASHBOARD_AUTH_PASSWORD is deprecated/);
});

// ---------------------------------------------------------------------------
// S2 - session persistence + expiry filtering
// ---------------------------------------------------------------------------
test("S2 session persists to data/sessions.json and a second process accepts the cookie", async () => {
  clearData();
  const env = { DASHBOARD_AUTH_PASSWORD_HASH: HASH, DASHBOARD_AUTH_EMAIL: EMAIL };
  const a = await startServer(env, 5313);

  const login = await jsonPost(a.base, "/api/auth/login", { email: EMAIL, password: PASSWORD });
  assert.equal(login.status, 200);
  const token = cookieToken(login);
  assert.ok(token, "got a session token");
  assert.ok(existsSync(sessionsPath), "data/sessions.json exists after login");
  assert.ok(JSON.parse(readFileSync(sessionsPath, "utf8"))[token], "token stored in data/sessions.json");

  const b = await startServer(env, 5314); // fresh process, same data/
  const sess = await fetch(`${b.base}/api/auth/session`, { headers: { cookie: `canlogger_session=${token}` } });
  assert.equal((await sess.json()).authenticated, true);
});

test("S2 a persisted session whose expiresAt is in the past is rejected after boot", async () => {
  clearData();
  mkdirSync(dataDir, { recursive: true });
  const token = "stale-token-0001";
  writeFileSync(sessionsPath, JSON.stringify({
    [token]: {
      email: EMAIL,
      customerId: "X",
      expiresAt: Date.now() - 60_000,
      absoluteExpiresAt: Date.now() + 60_000
    }
  }));
  const s = await startServer({ DASHBOARD_AUTH_PASSWORD_HASH: HASH, DASHBOARD_AUTH_EMAIL: EMAIL }, 5315);

  const sess = await fetch(`${s.base}/api/auth/session`, { headers: { cookie: `canlogger_session=${token}` } });
  assert.equal((await sess.json()).authenticated, false);
});

// ---------------------------------------------------------------------------
// S3 - XSS escaping in the client
// ---------------------------------------------------------------------------
test("S3 escapeHtml neutralizes <img onerror> and quote-breakout payloads", () => {
  const src = readFileSync(appPath, "utf8");
  const m = src.match(/function escapeHtml\(value\)\s*\{[\s\S]*?\n\}/);
  assert.ok(m, "escapeHtml() found in public/app.js");
  const escapeHtml = new Function(`${m[0]}\nreturn escapeHtml;`)();

  const out = escapeHtml("<img src=x onerror=alert(1)>");
  assert.ok(out.includes("&lt;img"), "opening tag escaped");
  assert.ok(!out.includes("<img"), "no raw <img survives");
  assert.ok(escapeHtml('" onmouseover="x').includes("&quot;"), "double quote escaped");
});

test("S3 every alert.* / file.name interpolation in renderAlerts/renderFiles is escaped", () => {
  const src = readFileSync(appPath, "utf8");
  for (const fn of ["renderAlerts", "renderFiles"]) {
    const start = src.indexOf(`function ${fn}`);
    assert.ok(start >= 0, `${fn} found`);
    const rest = src.slice(start + 10);
    const nextFn = rest.indexOf("\nfunction ");
    const block = src.slice(start, start + 10 + (nextFn === -1 ? rest.length : nextFn));
    const risky = (block.match(/\$\{[^}]*\}/g) || []).filter((s) => /alert\.|file\.name/.test(s));
    assert.ok(risky.length > 0, `${fn} has device-supplied interpolations to check`);
    for (const r of risky) {
      assert.match(r, /\$\{\s*(escapeHtml|encodeURIComponent)\(/, `${fn}: ${r} is not wrapped`);
    }
  }
});

// ---------------------------------------------------------------------------
// S4 - device upload fails closed
// ---------------------------------------------------------------------------
test("S4 cloud mode without DEVICE_UPLOAD_TOKEN: POST /api/cloud/status -> 503", async () => {
  clearData();
  const s = await startServer(
    { DASHBOARD_MODE: "cloud", DASHBOARD_AUTH_PASSWORD_HASH: HASH, DASHBOARD_AUTH_EMAIL: EMAIL },
    5316
  );
  const r = await jsonPost(s.base, "/api/cloud/status", "{}");
  assert.equal(r.status, 503);
});

test("S4 with DEVICE_UPLOAD_TOKEN: matching bearer -> 200, wrong bearer -> 401", async () => {
  clearData();
  const s = await startServer(
    { DASHBOARD_MODE: "cloud", DEVICE_UPLOAD_TOKEN: "dev-token-xyz", DASHBOARD_AUTH_PASSWORD_HASH: HASH, DASHBOARD_AUTH_EMAIL: EMAIL },
    5317
  );
  const ok = await jsonPost(s.base, "/api/cloud/status", "{}", { authorization: "Bearer dev-token-xyz" });
  assert.equal(ok.status, 200);

  const bad = await jsonPost(s.base, "/api/cloud/status", "{}", { authorization: "Bearer wrong-token" });
  assert.equal(bad.status, 401);
});

// ---------------------------------------------------------------------------
// S5 - login lockout + no length leak
// ---------------------------------------------------------------------------
test("S5 wrong password returns 401 for very different lengths (no 400/500)", async () => {
  clearData();
  const s = await startServer({ DASHBOARD_AUTH_PASSWORD_HASH: HASH, DASHBOARD_AUTH_EMAIL: EMAIL }, 5318);
  for (const pw of ["x", "z".repeat(4096)]) {
    const r = await jsonPost(s.base, "/api/auth/login", { email: EMAIL, password: pw });
    assert.equal(r.status, 401, `password length ${pw.length} -> 401`);
  }
});

test("S5 five consecutive failures -> 6th is 429; a correct login mid-run resets the counter", async () => {
  clearData();
  const s = await startServer({ DASHBOARD_AUTH_PASSWORD_HASH: HASH, DASHBOARD_AUTH_EMAIL: EMAIL }, 5319);
  const wrong = () => jsonPost(s.base, "/api/auth/login", { email: EMAIL, password: "wrong" });
  const right = () => jsonPost(s.base, "/api/auth/login", { email: EMAIL, password: PASSWORD });

  for (let i = 0; i < 4; i++) assert.equal((await wrong()).status, 401, `pre-reset failure ${i + 1}`);
  assert.equal((await right()).status, 200, "correct login before the 5th still succeeds and resets");

  for (let i = 0; i < 4; i++) assert.equal((await wrong()).status, 401, `post-reset failure ${i + 1} (not locked)`);
  assert.equal((await wrong()).status, 401, "5th consecutive failure still 401");
  assert.equal((await wrong()).status, 429, "6th consecutive attempt is locked out");
});

// ---------------------------------------------------------------------------
// S6 - CSRF origin check
// ---------------------------------------------------------------------------
test("S6 cross-origin login -> 403; same-origin login -> not 403; device endpoint excluded", async () => {
  clearData();
  const s = await startServer({ DASHBOARD_AUTH_PASSWORD_HASH: HASH, DASHBOARD_AUTH_EMAIL: EMAIL }, 5320);

  const evil = await jsonPost(s.base, "/api/auth/login", { email: EMAIL, password: PASSWORD }, { origin: "http://evil.example" });
  assert.equal(evil.status, 403);
  assert.match((await evil.json()).error, /Cross-origin request blocked/);

  const same = await jsonPost(s.base, "/api/auth/login", { email: EMAIL, password: PASSWORD }, { origin: "http://localhost:5320" });
  assert.notEqual(same.status, 403);

  const device = await jsonPost(s.base, "/api/cloud/status", "{}", { origin: "http://evil.example" });
  assert.notEqual(device.status, 403);
});

// ---------------------------------------------------------------------------
// S7 / S8 / S9 - cookie Secure flag, __Host- prefix + absolute cap, real authStatus
// ---------------------------------------------------------------------------
test("S7/S8/S9 cloud mode: __Host- prefixed Secure cookie, Path=/ no Domain, ~7d absolute cap, real email in body", async () => {
  clearData();
  const s = await startServer(
    { DASHBOARD_MODE: "cloud", DEVICE_UPLOAD_TOKEN: "t", DASHBOARD_AUTH_PASSWORD_HASH: HASH, DASHBOARD_AUTH_EMAIL: EMAIL },
    5321
  );
  const r = await jsonPost(s.base, "/api/auth/login", { email: EMAIL, password: PASSWORD });
  assert.equal(r.status, 200);

  const cookie = r.headers.getSetCookie()[0];
  assert.match(cookie, /^__Host-canlogger_session=/, "S8 __Host- prefix");
  assert.match(cookie, /;\s*Secure/i, "S7 Secure flag in cloud mode");
  assert.match(cookie, /;\s*Path=\/(;|$)/, "S8 Path=/");
  assert.ok(!/Domain=/i.test(cookie), "S8 no Domain attribute");

  const body = await r.json();
  assert.equal(body.authenticated, true, "S9 authenticated:true from real authStatus path");
  assert.equal(body.email, EMAIL, "S9 email equals configured email");

  const token = cookieToken(r);
  const stored = JSON.parse(readFileSync(sessionsPath, "utf8"))[token];
  assert.equal(typeof stored.absoluteExpiresAt, "number", "S8 absoluteExpiresAt is numeric");
  const sevenDays = 7 * 24 * 60 * 60 * 1000;
  assert.ok(Math.abs(stored.absoluteExpiresAt - (Date.now() + sevenDays)) < 60_000, "S8 absoluteExpiresAt ~7 days ahead");
});

test("S7/S8 local mode (Host localhost): plain cookie name, no Secure flag", async () => {
  clearData();
  const s = await startServer({ DASHBOARD_AUTH_PASSWORD_HASH: HASH, DASHBOARD_AUTH_EMAIL: EMAIL }, 5322);
  const r = await jsonPost(s.base, "/api/auth/login", { email: EMAIL, password: PASSWORD });
  assert.equal(r.status, 200);

  const cookie = r.headers.getSetCookie()[0];
  assert.match(cookie, /^canlogger_session=/, "plain cookie name in local mode");
  assert.ok(!/Secure/i.test(cookie), "no Secure flag over local http");
});

// ---------------------------------------------------------------------------
// S10 - password field cleared on failed login
// ---------------------------------------------------------------------------
test("S10 handleLogin catch block resets #loginPassword value to empty string", () => {
  const src = readFileSync(appPath, "utf8");
  assert.match(src, /catch\s*\([^)]*\)\s*\{[^}]*\$\(["']#loginPassword["']\)\.value\s*=\s*""/);
});

// ---------------------------------------------------------------------------
// S11 - default-email startup warning
// ---------------------------------------------------------------------------
test("S11 warning fires when DASHBOARD_AUTH_EMAIL is left at the default", async () => {
  clearData();
  const s = await startServer({ DASHBOARD_AUTH_PASSWORD_HASH: HASH }, 5323);
  await sleep(50);
  assert.match(s.stderr, /DASHBOARD_AUTH_EMAIL is still the default/);
});

test("S11 warning absent when a real DASHBOARD_AUTH_EMAIL is set", async () => {
  clearData();
  const s = await startServer({ DASHBOARD_AUTH_PASSWORD_HASH: HASH, DASHBOARD_AUTH_EMAIL: EMAIL }, 5324);
  await sleep(50);
  assert.doesNotMatch(s.stderr, /DASHBOARD_AUTH_EMAIL is still the default/);
});

// ---------------------------------------------------------------------------
// Missing #4 - .env.example present, complete, and not git-ignored
// ---------------------------------------------------------------------------
test("Missing#4 .env.example documents every env var, is tracked, and .gitignore re-includes it", () => {
  const envExamplePath = path.join(repoDir, ".env.example");
  assert.ok(existsSync(envExamplePath), ".env.example exists");
  const env = readFileSync(envExamplePath, "utf8");
  for (const v of [
    "PORT", "DASHBOARD_MODE", "DEVICE_UPLOAD_TOKEN", "DASHBOARD_AUTH_EMAIL",
    "DASHBOARD_AUTH_PASSWORD_HASH", "DASHBOARD_AUTH", "CUSTOMER_ID",
    "CAN_LOGGER_ADDRESS", "DEVICE_NAME"
  ]) {
    assert.ok(env.includes(v), `${v} is documented in .env.example`);
  }

  const gitignore = readFileSync(path.join(repoDir, ".gitignore"), "utf8");
  assert.ok(gitignore.includes("!.env.example"), ".gitignore contains !.env.example");

  const r = spawnSync("git", ["-C", repoDir, "check-ignore", "-q", ".env.example"]);
  assert.notEqual(r.status, 0, ".env.example must NOT be git-ignored");
});
