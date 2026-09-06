// Spawn helpers for the child-process server boots. No top-level side effects, so
// `node --test` loading this as a stray test file just finds zero tests.
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));
const bootPath = join(here, "boot.mjs");
export const repoRoot = join(here, "..", "..");

let portCounter = 0;
const portBase = 34000 + Math.floor(Math.random() * 1000);
function pickPort() {
  return String(portBase + portCounter++);
}

function baseEnv() {
  return {
    DASHBOARD_MODE: "cloud",
    SESSION_COOKIE_SECRET: "test-secret-abcdefghijklmnopqrstuvwxyz0123456789",
    SUPABASE_URL: "https://fake.supabase.co",
    SUPABASE_ANON_KEY: "anon-key-test",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-key-test",
    DEVICE_UPLOAD_TOKEN: "device-token-test"
  };
}

function buildEnv(overrides, extra) {
  const env = { ...process.env, ...baseEnv(), ...overrides, ...extra };
  for (const [k, v] of Object.entries(overrides)) {
    if (v === null || v === undefined) delete env[k];
  }
  return env;
}

// Boot a server child and wait until GET /api/auth/session answers (~50ms x60).
export async function boot(overrides = {}) {
  const port = String(overrides.PORT || pickPort());
  const logFile = join(tmpdir(), `fake-call-log-${port}-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`);
  writeFileSync(logFile, "");
  const env = buildEnv(overrides, { PORT: port, BOOT_FIXTURE: "1", FAKE_CALL_LOG: logFile });
  const child = spawn(process.execPath, [bootPath], { cwd: repoRoot, env, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (d) => { stdout += d; });
  child.stderr.on("data", (d) => { stderr += d; });

  const base = `http://localhost:${port}`;
  let ready = false;
  for (let i = 0; i < 60; i++) {
    if (child.exitCode !== null) break;
    try {
      const r = await fetch(`${base}/api/auth/session`);
      if (r.status === 200) { ready = true; break; }
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 50));
  }

  return {
    port,
    base,
    child,
    ready,
    get stdout() { return stdout; },
    get stderr() { return stderr; },
    clearLog() { writeFileSync(logFile, ""); },
    log() {
      if (!existsSync(logFile)) return [];
      const raw = readFileSync(logFile, "utf8").trim();
      return raw ? raw.split("\n").map((l) => JSON.parse(l)) : [];
    },
    async stop() {
      try { child.kill(); } catch {}
      await new Promise((r) => {
        let done = false;
        const fin = () => { if (!done) { done = true; r(); } };
        child.on("exit", fin);
        setTimeout(fin, 1000);
      });
      try { rmSync(logFile, { force: true }); } catch {}
    }
  };
}

// Spawn a server child and wait for it to exit; return code + captured output.
export async function bootAndWaitExit(overrides = {}) {
  const port = String(overrides.PORT || pickPort());
  const env = buildEnv(overrides, { PORT: port, BOOT_FIXTURE: "1" });
  const child = spawn(process.execPath, [bootPath], { cwd: repoRoot, env, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (d) => { stdout += d; });
  child.stderr.on("data", (d) => { stderr += d; });
  const code = await new Promise((r) => child.on("exit", r));
  return { code, stdout, stderr };
}
