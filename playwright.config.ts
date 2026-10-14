import { defineConfig, devices } from "@playwright/test";

/** Browser tests of the web UI (docs/plan.md §10, P5), at desktop size and at 375 px. */
export default defineConfig({
  testDir: "test/e2e",
  testMatch: "**/*.spec.ts",
  timeout: 60_000,
  // Every Assistant turn pulls and saves the vault with git, which is slow on Windows.
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: "http://127.0.0.1:7499", trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "phone", use: { ...devices["Desktop Chrome"], viewport: { width: 375, height: 812 }, isMobile: false } },
  ],
  webServer: {
    command: "bun run test/e2e/serve-demo.ts",
    url: "http://127.0.0.1:7499/",
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
