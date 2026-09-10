// Fake @supabase/supabase-js client injected via server.js __setSupabaseFactory.
// No live Supabase in CI. Every .from() chain call and every auth call is
// appended (JSON line) to the file named by env FAKE_CALL_LOG so the parent test
// process can read what the server did. Behaviour is switched by env vars so each
// child process (one per scenario) is configured before server.js is imported.
import { appendFileSync } from "node:fs";

const LOG = process.env.FAKE_CALL_LOG || "";

function record(entry) {
  if (!LOG) return;
  try {
    appendFileSync(LOG, JSON.stringify(entry) + "\n");
  } catch {
    // best effort; a missing log must never break the server under test
  }
}

const nowSec = () => Math.floor(Date.now() / 1000);

function tableRead(table) {
  switch (table) {
    case "user_devices":
      return process.env.FAKE_USER_DEVICES === "empty"
        ? { data: [], error: null }
        : { data: [{ device_id: "dev-uuid-1" }], error: null };
    case "device_status_latest":
      if (process.env.FAKE_STATUS === "empty") {
        return { data: [], error: null };
      }
      return {
        data: [{
          device_id: "dev-uuid-1",
          source: "cloud",
          health: "Healthy",
          vehicle_state: "Parked",
          monitoring: "Cloud monitoring",
          latest_event: "ok",
          active_alert: "No active alerts",
          speed_kph: 0,
          brake_bar: 0,
          acceleration_mps2: 0,
          received_frames: 10,
          logged_frames: 1,
          decoded_signals: 5,
          event_count: 2,
          fault_count: 0,
          dropped_frames: 0,
          rejected_frames: 0,
          gps_status: "not_connected",
          latitude: null,
          longitude: null,
          raw_payload: {},
          received_at: new Date().toISOString()
        }],
        error: null
      };
    case "device_events":
      return {
        data: [{
          id: "evt-1",
          received_at: new Date().toISOString(),
          title: "t",
          severity: "info",
          status: "info",
          fault_code: null,
          can_id: null,
          raw_reason: null
        }],
        error: null
      };
    case "report_files":
      return {
        data: [{ file_name: "r.csv", byte_size: 10, file_type: "event_report", service_only: false }],
        error: null
      };
    case "devices":
      return process.env.FAKE_DEVICES === "notfound"
        ? { data: [], error: null }
        : { data: [{ id: "dev-uuid-1", claim_code: "claim-code-test" }], error: null };
    default:
      return { data: [], error: null };
  }
}

function makeChain(table, role) {
  const methods = [];
  const chain = {};
  for (const m of ["select", "eq", "in", "order", "limit", "upsert", "insert"]) {
    chain[m] = (...args) => {
      methods.push(m);
      record({ kind: "from", table, method: m, args, role });
      return chain;
    };
  }
  chain.then = (resolve, reject) => {
    let result;
    if (methods.includes("upsert") || methods.includes("insert")) {
      result = process.env.FAKE_WRITE === "error"
        ? { data: null, error: { message: "boom" } }
        : { data: null, error: null };
    } else {
      result = tableRead(table);
    }
    return Promise.resolve(result).then(resolve, reject);
  };
  return chain;
}

export function makeFakeFactory() {
  return (url, key, options) => {
    const authHeader = options?.global?.headers?.Authorization || null;
    let role;
    if (authHeader) role = "user";
    else if (key === process.env.SUPABASE_SERVICE_ROLE_KEY) role = "service";
    else role = "anon";

    return {
      _role: role,
      auth: {
        async signInWithPassword({ email, password }) {
          record({ kind: "auth", method: "signInWithPassword", role, email });
          const good = email === "owner@example.com" && password === "good-password";
          if (!good) {
            return { data: null, error: { message: "Invalid login credentials" } };
          }
          const expiresAt = process.env.FAKE_SIGNIN_EXPIRED === "1" ? nowSec() - 10 : nowSec() + 3600;
          return {
            data: {
              session: {
                access_token: "user-jwt-1",
                refresh_token: "refresh-1",
                expires_at: expiresAt,
                user: { id: "user-uuid-1", email }
              }
            },
            error: null
          };
        },
        async signUp({ email, password, options }) {
          record({ kind: "auth", method: "signUp", role, email, emailRedirectTo: options?.emailRedirectTo });
          if (process.env.FAKE_SIGNUP === "error") {
            return { data: null, error: { message: "signup disabled" } };
          }
          // Email-confirmation-on: a user row, no session.
          return { data: { user: { id: "new-user-uuid", email }, session: null }, error: null };
        },
        async signOut() {
          record({ kind: "auth", method: "signOut", role });
          return { error: null };
        },
        async refreshSession({ refresh_token }) {
          record({ kind: "auth", method: "refreshSession", role, refresh_token });
          const delayMs = Number(process.env.FAKE_REFRESH_DELAY || 0);
          if (delayMs > 0) {
            await new Promise((r) => setTimeout(r, delayMs));
          }
          const mode = process.env.FAKE_REFRESH || "success";
          if (mode === "throw") {
            throw new Error("refresh network failure");
          }
          if (mode === "fail") {
            return { data: null, error: { message: "invalid refresh token" } };
          }
          return {
            data: {
              session: {
                access_token: "user-jwt-2",
                refresh_token: "refresh-2",
                expires_at: nowSec() + 3600,
                user: { id: "user-uuid-1", email: "owner@example.com" }
              }
            },
            error: null
          };
        }
      },
      from(table) {
        return makeChain(table, role);
      }
    };
  };
}
