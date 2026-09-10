import { defineConfig, devices } from "@playwright/test";

// Dedicated port so a dashboard already running on the default 5177 is not
// disturbed and does not silently serve the tests.
const port = 5178;

export default defineConfig({
  // Deliberately NOT under test/ — `npm test` runs `node --test`, which globs
  // test/**/*.js and would try to execute these specs outside the Playwright
  // runner.
  testDir: "./e2e",
  // Only run smoke tests with auth-off config
  testMatch: "**/smoke.spec.js",
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
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
      // Local mode with auth off boots without SESSION_COOKIE_SECRET or any
      // Supabase credentials, so the suite needs no secrets. Auth flows are
      // covered by the node:test suite in test/dashboard.test.js.
      DASHBOARD_MODE: "local",
      DASHBOARD_AUTH: "off",
    },
  },
});
