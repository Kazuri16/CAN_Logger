// Rebuilt suite for the Supabase Auth + Postgres + RLS migration.
// Old test/auth.test.js (env-var/scrypt auth) was deleted in this migration.
// No live Supabase: server.js's Supabase factory is swapped for a fake
// (test/fixtures/fake-supabase.mjs) inside a spawned child (test/fixtures/boot.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { boot, bootAndWaitExit, repoRoot } from "./fixtures/harness.mjs";

const GOOD = { email: "owner@example.com", password: "good-password" };

async function login(base, email = GOOD.email, password = GOOD.password, headers = {}) {
  const res = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ email, password })
  });
  const body = await res.json().catch(() => null);
  return { res, body, setCookie: res.headers.getSetCookie() };
}

const hostCookiePair = (setCookieArr) => {
  for (const sc of setCookieArr || []) {
    if (sc.startsWith("__Host-canlogger_session=") && !/Max-Age=0/.test(sc)) return sc.split(";")[0];
  }
  return null;
};

// --------------------------------------------------------------------------
// 1. Login calls signInWithPassword (no scrypt/hash path)
// --------------------------------------------------------------------------
test("1. login good creds -> 200, signInWithPassword recorded, no hash path", async () => {
  const s = await boot();
  try {
    assert.ok(s.ready, "server booted");
    const { res, body, setCookie } = await login(s.base);
    assert.equal(res.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.authenticated, true);
    assert.equal(body.email, GOOD.email);
    assert.ok(s.log().some((e) => e.kind === "auth" && e.method === "signInWithPassword"), "fake recorded signInWithPassword");
    assert.ok(hostCookiePair(setCookie), "session cookie set");
    const src = readFileSync(join(repoRoot, "server.js"), "utf8");
    for (const bad of ["hashPassword", "verifyPassword", "DASHBOARD_AUTH_PASSWORD"]) {
      assert.ok(!src.includes(bad), `server.js must not reference ${bad}`);
    }
  } finally {
    await s.stop();
  }
});

// --------------------------------------------------------------------------
// 2. Bad creds -> 401, still recorded, no Set-Cookie
// --------------------------------------------------------------------------
test("2. login bad creds -> 401 {ok:false}, no Set-Cookie", async () => {
  const s = await boot();
  try {
    const { res, body, setCookie } = await login(s.base, GOOD.email, "wrong-password");
    assert.equal(res.status, 401);
    assert.equal(body.ok, false);
    assert.equal((setCookie || []).length, 0, "no Set-Cookie on failed login");
    assert.ok(s.log().some((e) => e.method === "signInWithPassword"), "fake recorded signInWithPassword");
  } finally {
    await s.stop();
  }
});

// --------------------------------------------------------------------------
// 3. Stateless encrypted cookie round-trips + attributes
// --------------------------------------------------------------------------
test("3. encrypted cookie round-trips through /api/auth/session; __Host- + Secure/HttpOnly/SameSite=Lax/Path=/", async () => {
  const s = await boot();
  try {
    const { setCookie } = await login(s.base);
    const raw = (setCookie || [])[0] || "";
    assert.ok(raw.startsWith("__Host-canlogger_session="), `cookie name: ${raw}`);
    assert.match(raw, /Secure/);
    assert.match(raw, /HttpOnly/);
    assert.match(raw, /SameSite=Lax/);
    assert.match(raw, /Path=\//);
    const pair = raw.split(";")[0];
    const sres = await fetch(`${s.base}/api/auth/session`, { headers: { cookie: pair } });
    const sbody = await sres.json();
    assert.equal(sbody.authenticated, true);
    assert.equal(sbody.email, GOOD.email);
  } finally {
    await s.stop();
  }
});

// --------------------------------------------------------------------------
// 4. No cookie -> protected cloud read -> 401
// --------------------------------------------------------------------------
test("4. no cookie -> GET /api/dashboard-status (cloud) -> 401", async () => {
  const s = await boot();
  try {
    const r = await fetch(`${s.base}/api/dashboard-status`);
    assert.equal(r.status, 401);
  } finally {
    await s.stop();
  }
});

// --------------------------------------------------------------------------
// 5. Refresh on expiry + rotation
// --------------------------------------------------------------------------
test("5. expired session -> refreshSession -> fresh Set-Cookie + 200", async () => {
  const s = await boot({ FAKE_SIGNIN_EXPIRED: "1" });
  try {
    const { setCookie } = await login(s.base);
    const pair = hostCookiePair(setCookie) || (setCookie[0] || "").split(";")[0];
    s.clearLog();
    const r = await fetch(`${s.base}/api/dashboard-status`, { headers: { cookie: pair } });
    assert.equal(r.status, 200);
    const rotated = r.headers.getSetCookie();
    const newPair = hostCookiePair(rotated);
    assert.ok(newPair, "response carried a fresh non-clearing session cookie");
    assert.notEqual(newPair, pair, "cookie value rotated");
    assert.ok(s.log().some((e) => e.method === "refreshSession"), "fake recorded refreshSession");
  } finally {
    await s.stop();
  }
});

// --------------------------------------------------------------------------
// 6. Refresh failure -> 401 + cookie-clearing Set-Cookie
// --------------------------------------------------------------------------
test("6. refresh returns {error} -> 401 + Max-Age=0 Set-Cookie", async () => {
  const s = await boot({ FAKE_SIGNIN_EXPIRED: "1", FAKE_REFRESH: "fail" });
  try {
    const { setCookie } = await login(s.base);
    const pair = (setCookie[0] || "").split(";")[0];
    const r = await fetch(`${s.base}/api/dashboard-status`, { headers: { cookie: pair } });
    assert.equal(r.status, 401);
    const cleared = r.headers.getSetCookie();
    assert.ok(cleared.length >= 1, "a Set-Cookie was sent");
    assert.ok(cleared.some((c) => /Max-Age=0/.test(c) && c.startsWith("__Host-canlogger_session=")), "cookie-clearing Set-Cookie");
  } finally {
    await s.stop();
  }
});

// --------------------------------------------------------------------------
// 7. Refresh throws -> still 401, never 500 (try/catch fix)
// --------------------------------------------------------------------------
test("7. refresh throws -> 401, not 500", async () => {
  const s = await boot({ FAKE_SIGNIN_EXPIRED: "1", FAKE_REFRESH: "throw" });
  try {
    const { setCookie } = await login(s.base);
    const pair = (setCookie[0] || "").split(";")[0];
    const r = await fetch(`${s.base}/api/dashboard-status`, { headers: { cookie: pair } });
    assert.notEqual(r.status, 500, "must not 500");
    assert.equal(r.status, 401);
  } finally {
    await s.stop();
  }
});

// --------------------------------------------------------------------------
// 8. Per-user isolation filter on every cloud read
// --------------------------------------------------------------------------
test("8. every cloud read filters user_devices by user_id then telemetry by device_id", async () => {
  const s = await boot();
  try {
    const { setCookie } = await login(s.base);
    const pair = (setCookie[0] || "").split(";")[0];
    const telemetryTables = ["device_status_latest", "device_events", "report_files"];
    for (const ep of ["/api/dashboard-status", "/api/alerts", "/api/files", "/api/cloud/status", "/api/cloud/events"]) {
      s.clearLog();
      const r = await fetch(`${s.base}${ep}`, { headers: { cookie: pair } });
      assert.equal(r.status, 200, `${ep} -> 200`);
      const log = s.log().filter((e) => e.kind === "from");
      const hasOwnerEq = log.some((e) => e.table === "user_devices" && e.method === "eq" && e.args[0] === "user_id" && e.args[1] === "user-uuid-1");
      assert.ok(hasOwnerEq, `${ep}: user_devices eq('user_id','user-uuid-1')`);
      let sawTelemetryIn = false;
      log.forEach((e, i) => {
        if (!telemetryTables.includes(e.table)) return;
        const precededByOwnerEq = log.slice(0, i).some((p) => p.table === "user_devices" && p.method === "eq" && p.args[0] === "user_id");
        assert.ok(precededByOwnerEq, `${ep}: ${e.table}.${e.method} has a preceding user_devices eq`);
        if (e.method === "in") {
          sawTelemetryIn = true;
          assert.equal(e.args[0], "device_id");
          assert.deepEqual(e.args[1], ["dev-uuid-1"]);
        }
      });
      assert.ok(sawTelemetryIn, `${ep}: telemetry queried with in('device_id',[...])`);
    }
  } finally {
    await s.stop();
  }
});

// --------------------------------------------------------------------------
// 9. Empty owned devices
// --------------------------------------------------------------------------
test("9. empty user_devices -> waiting status; alerts/files -> []", async () => {
  const s = await boot({ FAKE_USER_DEVICES: "empty" });
  try {
    const { setCookie } = await login(s.base);
    const pair = (setCookie[0] || "").split(";")[0];

    const dsr = await fetch(`${s.base}/api/dashboard-status`, { headers: { cookie: pair } });
    assert.equal(dsr.status, 200);
    const ds = await dsr.json();
    assert.equal(ds.connected, false);
    assert.equal(ds.health, "Waiting for logger upload");

    const ar = await fetch(`${s.base}/api/alerts`, { headers: { cookie: pair } });
    assert.equal(ar.status, 200);
    assert.deepEqual(await ar.json(), []);

    const fr = await fetch(`${s.base}/api/files`, { headers: { cookie: pair } });
    assert.equal(fr.status, 200);
    assert.deepEqual(await fr.json(), []);
  } finally {
    await s.stop();
  }
});

// --------------------------------------------------------------------------
// 10. Ingestion uses ONLY the service client + attribution
// --------------------------------------------------------------------------
test("10. POST /api/cloud/status: devices lookup by sha256(token) + upsert + insert, all on service client", async () => {
  const s = await boot();
  try {
    const token = "device-token-test";
    const tokenHash = createHash("sha256").update(token).digest("hex");
    s.clearLog();
    const r = await fetch(`${s.base}/api/cloud/status`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ deviceId: "esp-1", latestEvent: "test", faultCode: "F01", metrics: { received: 5 } })
    });
    assert.equal(r.status, 200);
    assert.equal((await r.json()).ok, true);

    const fromCalls = s.log().filter((e) => e.kind === "from");
    const devEq = fromCalls.find((e) => e.table === "devices" && e.method === "eq");
    assert.ok(devEq, "devices lookup happened");
    assert.equal(devEq.args[0], "upload_token_hash");
    assert.equal(devEq.args[1], tokenHash);
    assert.ok(fromCalls.some((e) => e.table === "device_status_latest" && e.method === "upsert"), "device_status_latest upsert");
    assert.ok(fromCalls.some((e) => e.table === "device_events" && e.method === "insert"), "device_events insert");
    for (const e of fromCalls) {
      assert.equal(e.role, "service", `${e.table}.${e.method} must run on the service client (no Authorization header, service key)`);
    }
  } finally {
    await s.stop();
  }
});

// --------------------------------------------------------------------------
// 11. Device not provisioned -> 503
// --------------------------------------------------------------------------
test("11. devices lookup empty -> POST /api/cloud/status -> 503", async () => {
  const s = await boot({ FAKE_DEVICES: "notfound" });
  try {
    const r = await fetch(`${s.base}/api/cloud/status`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer device-token-test" },
      body: JSON.stringify({ latestEvent: "x" })
    });
    assert.equal(r.status, 503);
  } finally {
    await s.stop();
  }
});

// --------------------------------------------------------------------------
// 12. Upload token fail-closed (S4)
// --------------------------------------------------------------------------
test("12. wrong device bearer -> 401; unset DEVICE_UPLOAD_TOKEN in cloud mode -> 503", async () => {
  const s = await boot();
  try {
    const r1 = await fetch(`${s.base}/api/cloud/status`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer wrong-token" },
      body: "{}"
    });
    assert.equal(r1.status, 401);
  } finally {
    await s.stop();
  }

  const s2 = await boot({ DEVICE_UPLOAD_TOKEN: "" });
  try {
    const r2 = await fetch(`${s2.base}/api/cloud/status`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}"
    });
    assert.equal(r2.status, 503);
  } finally {
    await s2.stop();
  }
});

// --------------------------------------------------------------------------
// 13. Login rate limit (S5)
// --------------------------------------------------------------------------
test("13. 6th bad login -> 429; a good login resets the counter", async () => {
  const s = await boot();
  try {
    for (let i = 0; i < 4; i++) {
      const { res } = await login(s.base, GOOD.email, "bad");
      assert.equal(res.status, 401, `pre-reset bad login #${i + 1}`);
    }
    assert.equal((await login(s.base)).res.status, 200, "good login succeeds and resets");

    const codes = [];
    for (let i = 0; i < 5; i++) {
      codes.push((await login(s.base, GOOD.email, "bad")).res.status);
    }
    assert.deepEqual(codes, [401, 401, 401, 401, 401], "fresh budget of 5 after reset");
    const sixth = await login(s.base, GOOD.email, "bad");
    assert.equal(sixth.res.status, 429, "6th consecutive bad login blocked");
  } finally {
    await s.stop();
  }
});

// --------------------------------------------------------------------------
// 14. CSRF (S6)
// --------------------------------------------------------------------------
test("14. cross-origin login POST -> 403; same-origin -> not 403; device endpoint exempt", async () => {
  const s = await boot();
  try {
    const evil = await fetch(`${s.base}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://evil.example" },
      body: JSON.stringify(GOOD)
    });
    assert.equal(evil.status, 403);

    const same = await fetch(`${s.base}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: s.base },
      body: JSON.stringify(GOOD)
    });
    assert.notEqual(same.status, 403);

    const device = await fetch(`${s.base}/api/cloud/status`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://evil.example", authorization: "Bearer device-token-test" },
      body: JSON.stringify({ latestEvent: "x" })
    });
    assert.notEqual(device.status, 403);
  } finally {
    await s.stop();
  }
});

// --------------------------------------------------------------------------
// 15. Hard-fail on missing SESSION_COOKIE_SECRET
// --------------------------------------------------------------------------
test("15. cloud mode without SESSION_COOKIE_SECRET -> exit non-zero + FATAL; DASHBOARD_AUTH=off boots", async () => {
  const exit = await bootAndWaitExit({ SESSION_COOKIE_SECRET: null });
  assert.notEqual(exit.code, 0, "child exits non-zero");
  assert.match(exit.stderr, /FATAL/, "stderr contains FATAL");

  const s = await boot({ DASHBOARD_AUTH: "off", SESSION_COOKIE_SECRET: null });
  try {
    assert.equal(s.child.exitCode, null, "child stays alive with DASHBOARD_AUTH=off and no secret");
    assert.ok(s.ready, "server answers");
  } finally {
    await s.stop();
  }
});

// --------------------------------------------------------------------------
// 16. Client retained protections (public/app.js source checks)
// --------------------------------------------------------------------------
test("16. app.js: escapeHtml defined + used in renderAlerts/renderFiles; login catch clears #loginPassword", async () => {
  const src = readFileSync(join(repoRoot, "public", "app.js"), "utf8");
  assert.match(src, /function escapeHtml\s*\(/, "escapeHtml defined");
  const slice = (from, to) => src.slice(src.indexOf(from), src.indexOf(to));
  assert.ok(slice("function renderAlerts", "function isRawLog").includes("escapeHtml("), "escapeHtml used in renderAlerts");
  assert.ok(slice("function renderFiles", "async function refreshStatus").includes("escapeHtml("), "escapeHtml used in renderFiles");
  const handleLogin = slice("async function handleLogin", "async function handleLogout");
  assert.match(handleLogin, /catch[\s\S]*loginPassword"\)\.value\s*=\s*""/, "failed-login catch clears #loginPassword");
});

// --------------------------------------------------------------------------
// 17. Migration SQL sanity (static)
// --------------------------------------------------------------------------
test("17. 0001_init.sql: RLS enable+force on all 6 tables, subquery auth.uid(), definer trigger, no write policies, indexes", async () => {
  const sql = readFileSync(join(repoRoot, "database", "migrations", "0001_init.sql"), "utf8");
  const tables = ["profiles", "devices", "user_devices", "device_status_latest", "device_events", "report_files"];
  for (const t of tables) {
    assert.match(sql, new RegExp(`alter table public\\.${t}\\s+enable row level security`), `${t}: enable RLS`);
    assert.match(sql, new RegExp(`alter table public\\.${t}\\s+force row level security`), `${t}: force RLS`);
  }
  const sqlNoComments = sql.replace(/--[^\n]*/g, ""); // ignore prose in -- comments
  const bare = sqlNoComments.match(/auth\.uid\(\)/g) || [];
  const wrapped = sqlNoComments.match(/\(\s*select\s+auth\.uid\(\)\s*\)/g) || [];
  assert.ok(bare.length >= 5, "policies reference auth.uid()");
  assert.equal(bare.length, wrapped.length, "every auth.uid() in policy SQL is wrapped as (select auth.uid())");

  const fn = sql.slice(sql.indexOf("function public.handle_new_user"), sql.indexOf("$$;") + 3);
  assert.match(fn, /security definer/, "handle_new_user is security definer");
  assert.match(fn, /set search_path = ''/, "handle_new_user sets search_path = ''");

  assert.ok(!/for\s+(insert|update|delete)/i.test(sql), "no insert/update/delete policies on any table");

  assert.match(sql, /on public\.user_devices\(user_id\)/, "index user_devices(user_id)");
  assert.match(sql, /on public\.device_events\(device_id, received_at/, "index device_events(device_id, received_at)");
  assert.match(sql, /on public\.report_files\(device_id, created_at/, "index report_files(device_id, created_at)");
  assert.match(sql, /on public\.devices\(upload_token_hash/, "index devices(upload_token_hash)");
});

// --------------------------------------------------------------------------
// 18. Single-flight refresh: N concurrent authenticated requests near expiry
//     trigger refreshSession exactly once (#3).
// --------------------------------------------------------------------------
test("18. concurrent requests on an expired session refresh only once", async () => {
  // FAKE_REFRESH_DELAY keeps the first refresh in flight long enough for the
  // rest of the batch to arrive - mirrors a real network round-trip to Supabase,
  // which is the window single-flight collapses.
  const s = await boot({ FAKE_SIGNIN_EXPIRED: "1", FAKE_REFRESH_DELAY: "60" });
  try {
    const { setCookie } = await login(s.base);
    const pair = hostCookiePair(setCookie) || (setCookie[0] || "").split(";")[0];
    s.clearLog();
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        fetch(`${s.base}/api/dashboard-status`, { headers: { cookie: pair } }).then((r) => r.status))
    );
    assert.ok(results.every((c) => c === 200), `all concurrent reads 200: ${results}`);
    const refreshes = s.log().filter((e) => e.kind === "auth" && e.method === "refreshSession");
    assert.equal(refreshes.length, 1, "refreshSession called exactly once for the batch");
  } finally {
    await s.stop();
  }
});

// --------------------------------------------------------------------------
// 19. Logout revokes server-side (#5).
// --------------------------------------------------------------------------
test("19. POST /api/auth/logout calls auth.signOut for the session", async () => {
  const s = await boot();
  try {
    const { setCookie } = await login(s.base);
    const pair = (setCookie[0] || "").split(";")[0];
    s.clearLog();
    const r = await fetch(`${s.base}/api/auth/logout`, { method: "POST", headers: { cookie: pair, origin: s.base } });
    assert.equal(r.status, 200);
    assert.ok(
      s.log().some((e) => e.kind === "auth" && e.method === "signOut"),
      "fake recorded signOut"
    );
    const cleared = r.headers.getSetCookie();
    assert.ok(cleared.some((c) => /Max-Age=0/.test(c)), "cookie cleared");
  } finally {
    await s.stop();
  }
});

// --------------------------------------------------------------------------
// 20. Login throttle ignores spoofed X-Forwarded-For: a rotating XFF does not
//     buy a fresh attempt budget (#6).
// --------------------------------------------------------------------------
test("20. spoofed X-Forwarded-For does not evade the login rate limit", async () => {
  const s = await boot();
  try {
    const codes = [];
    for (let i = 0; i < 5; i++) {
      const { res } = await login(s.base, GOOD.email, "bad", { "x-forwarded-for": `203.0.113.${i}` });
      codes.push(res.status);
    }
    assert.deepEqual(codes, [401, 401, 401, 401, 401], "first five share one budget despite differing XFF");
    const sixth = await login(s.base, GOOD.email, "bad", { "x-forwarded-for": "203.0.113.250" });
    assert.equal(sixth.res.status, 429, "sixth blocked - XFF spoof did not reset the counter");
  } finally {
    await s.stop();
  }
});

// --------------------------------------------------------------------------
// 21. Serverless wrapper (api/index.js) reproduces the http.createServer
//     listener: static + /api both respond through server.emit (#9).
// --------------------------------------------------------------------------
test("21. api/index.js wrapper serves a static route and an /api route", async () => {
  process.env.DASHBOARD_MODE = "cloud";
  process.env.SESSION_COOKIE_SECRET = "wrapper-test-secret-0123456789abcdefghij";
  process.env.SUPABASE_URL = "https://fake.supabase.co";
  process.env.SUPABASE_ANON_KEY = "anon-key-test";
  const { default: handler } = await import(pathToFileURL(join(repoRoot, "api", "index.js")).href);
  const srv = http.createServer(handler);
  await new Promise((r) => srv.listen(0, r));
  const port = srv.address().port;
  try {
    const root = await fetch(`http://localhost:${port}/`);
    assert.equal(root.status, 200);
    assert.match(root.headers.get("content-type") || "", /text\/html/);

    const session = await fetch(`http://localhost:${port}/api/auth/session`);
    assert.equal(session.status, 200);
    const body = await session.json();
    assert.equal(body.authenticated, false);

    const missing = await fetch(`http://localhost:${port}/nope.css`);
    assert.equal(missing.status, 404);
  } finally {
    await new Promise((r) => srv.close(r));
  }
});

// --------------------------------------------------------------------------
// Extra: data/ stays clean (no session/cloud store writes)
// --------------------------------------------------------------------------
test("extra. data/ directory has no runtime writes", async () => {
  const dir = join(repoRoot, "data");
  const entries = existsSync(dir) ? readdirSync(dir).filter((e) => e !== ".gitkeep") : [];
  assert.deepEqual(entries, [], "nothing written to data/");
});

// ==========================================================================
// Device claiming (Approach A: server-mediated signup + claim)
// ==========================================================================

async function signup(base, body, headers = {}) {
  const res = await fetch(`${base}/api/auth/signup`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body)
  });
  return { res, body: await res.json().catch(() => null), setCookie: res.headers.getSetCookie() };
}

async function claim(base, cookie, body, headers = {}) {
  const res = await fetch(`${base}/api/devices/claim`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}), ...headers },
    body: JSON.stringify(body)
  });
  return { res, body: await res.json().catch(() => null) };
}

const GOOD_SIGNUP = { email: "new@example.com", password: "at-least-8-chars" };
const GOOD_CLAIM = { deviceId: "esp-1", claimCode: "claim-code-test" };

// 22. signup -> signUp() called with emailRedirectTo, no session cookie, needs confirm
test("22. POST /api/auth/signup -> 200 {ok,emailConfirmationRequired}, signUp recorded, no Set-Cookie", async () => {
  const s = await boot();
  try {
    const { res, body, setCookie } = await signup(s.base, GOOD_SIGNUP);
    assert.equal(res.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.emailConfirmationRequired, true);
    assert.equal((setCookie || []).length, 0, "no session cookie on signup");
    const rec = s.log().find((e) => e.kind === "auth" && e.method === "signUp");
    assert.ok(rec, "fake recorded signUp");
    assert.match(String(rec.emailRedirectTo || ""), /^https?:\/\/.+\/$/, "emailRedirectTo passed");
  } finally {
    await s.stop();
  }
});

// 23. signup is CSRF-guarded like the other state-changing POSTs
test("23. cross-origin signup POST -> 403", async () => {
  const s = await boot();
  try {
    const { res } = await signup(s.base, GOOD_SIGNUP, { origin: "http://evil.example" });
    assert.equal(res.status, 403);
  } finally {
    await s.stop();
  }
});

// 24. signup per-IP rate limit
test("24. 6th signup from one IP -> 429", async () => {
  const s = await boot();
  try {
    for (let i = 0; i < 5; i++) {
      const { res } = await signup(s.base, { email: `u${i}@example.com`, password: "at-least-8-chars" });
      assert.equal(res.status, 200, `signup #${i + 1}`);
    }
    const sixth = await signup(s.base, { email: "u6@example.com", password: "at-least-8-chars" });
    assert.equal(sixth.res.status, 429, "6th blocked");
  } finally {
    await s.stop();
  }
});

// 25. GET /api/devices lists the session user's claimed devices
test("25. GET /api/devices -> {devices,count}; filters user_devices by user_id", async () => {
  const s = await boot();
  try {
    const { setCookie } = await login(s.base);
    const pair = (setCookie[0] || "").split(";")[0];
    s.clearLog();
    const r = await fetch(`${s.base}/api/devices`, { headers: { cookie: pair } });
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.count, 1);
    assert.equal(body.devices[0].id, "dev-uuid-1");
    assert.ok(
      s.log().some((e) => e.kind === "from" && e.table === "user_devices" && e.method === "eq" && e.args[0] === "user_id" && e.args[1] === "user-uuid-1"),
      "user_devices eq('user_id', <session user>)"
    );
  } finally {
    await s.stop();
  }
});

// 26. claim happy path: service-role devices match + status check + user_devices upsert
test("26. POST /api/devices/claim -> 200; devices.eq(device_id) + device_status_latest check + user_devices upsert, all service role", async () => {
  const s = await boot();
  try {
    const { setCookie } = await login(s.base);
    const pair = (setCookie[0] || "").split(";")[0];
    s.clearLog();
    const { res, body } = await claim(s.base, pair, GOOD_CLAIM);
    assert.equal(res.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.deviceId, "esp-1");

    const from = s.log().filter((e) => e.kind === "from");
    const devEq = from.find((e) => e.table === "devices" && e.method === "eq");
    assert.ok(devEq, "devices lookup happened");
    assert.deepEqual([devEq.args[0], devEq.args[1]], ["device_id", "esp-1"]);
    assert.ok(from.some((e) => e.table === "device_status_latest" && e.method === "eq"), "device_status_latest checked");
    assert.ok(from.some((e) => e.table === "user_devices" && e.method === "upsert"), "user_devices upsert");
    for (const e of from) {
      assert.equal(e.role, "service", `${e.table}.${e.method} must run on the service client`);
    }
  } finally {
    await s.stop();
  }
});

// 27. wrong claim code -> 404 (same response as a wrong device id)
test("27. claim with wrong code -> 404, no user_devices upsert", async () => {
  const s = await boot();
  try {
    const { setCookie } = await login(s.base);
    const pair = (setCookie[0] || "").split(";")[0];
    s.clearLog();
    const { res, body } = await claim(s.base, pair, { deviceId: "esp-1", claimCode: "wrong" });
    assert.equal(res.status, 404);
    assert.equal(body.ok, false);
    assert.ok(!s.log().some((e) => e.table === "user_devices" && e.method === "upsert"), "no link written");
  } finally {
    await s.stop();
  }
});

// 28. device that has never reported -> 409
test("28. claim a device with no device_status_latest row -> 409", async () => {
  const s = await boot({ FAKE_STATUS: "empty" });
  try {
    const { setCookie } = await login(s.base);
    const pair = (setCookie[0] || "").split(";")[0];
    const { res } = await claim(s.base, pair, GOOD_CLAIM);
    assert.equal(res.status, 409);
  } finally {
    await s.stop();
  }
});

// 29. claim without a session -> 401
test("29. claim with no cookie -> 401", async () => {
  const s = await boot();
  try {
    const { res } = await claim(s.base, null, GOOD_CLAIM);
    assert.equal(res.status, 401);
  } finally {
    await s.stop();
  }
});

// 30. claim rate limit (per IP / per user)
test("30. 11th claim attempt -> 429", async () => {
  const s = await boot();
  try {
    const { setCookie } = await login(s.base);
    const pair = (setCookie[0] || "").split(";")[0];
    for (let i = 0; i < 10; i++) {
      const { res } = await claim(s.base, pair, GOOD_CLAIM);
      assert.notEqual(res.status, 429, `claim #${i + 1} not throttled`);
    }
    const eleventh = await claim(s.base, pair, GOOD_CLAIM);
    assert.equal(eleventh.res.status, 429, "11th blocked");
  } finally {
    await s.stop();
  }
});

// 31. migration divergence reconciled + claiming migration present
test("31. migrations: 0002 rpc lockdown, 0003 retention (renamed), 0004 claim_code column + index", async () => {
  const dir = join(repoRoot, "database", "migrations");
  const names = readdirSync(dir).sort();
  assert.deepEqual(names, [
    "0001_init.sql",
    "0002_lock_down_handle_new_user_rpc.sql",
    "0003_device_events_retention.sql",
    "0004_device_claiming.sql"
  ], "migration files renumbered");

  const rpc = readFileSync(join(dir, "0002_lock_down_handle_new_user_rpc.sql"), "utf8");
  assert.match(rpc, /revoke execute on function public\.handle_new_user\(\)\s+from\s+anon,\s*authenticated,\s*public/i);

  const claim = readFileSync(join(dir, "0004_device_claiming.sql"), "utf8");
  assert.match(claim, /alter table public\.devices add column if not exists claim_code text/i);
  assert.match(claim, /create index if not exists devices_claim_code_idx/i);
  assert.ok(!/for\s+insert/i.test(claim), "0004 adds no INSERT policy (user_devices stays service-only)");
});
