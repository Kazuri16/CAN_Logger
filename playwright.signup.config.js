import { defineConfig, devices } from "@playwright/test";

const port = 5179;

export default defineConfig({
  testDir: "./e2e",
  // Only run signup tests with auth-on config
  testMatch: "**/signup-*.spec.js",
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: {
    baseURL: `http://localhost:${port}`,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "node server.js",
    url: `http://localhost:${port}/api/dashboard-status`,
    reuseExistingServer: false,
    env: {
      PORT: String(port),
      DASHBOARD_MODE: "local",
      // Enable auth so the login screen appears
      DASHBOARD_AUTH: "on",
      SESSION_COOKIE_SECRET: "test-secret-for-e2e-testing-only",
      SUPABASE_URL: "http://localhost:9999",
      SUPABASE_ANON_KEY: "test-anon-key",
      SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
    },
  },
});
