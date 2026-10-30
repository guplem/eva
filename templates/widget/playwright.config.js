import { defineConfig, devices } from "@playwright/test";

// The tests run the widget on the small static server, as GitHub Pages runs it: writes fail there,
// and tests/helpers.js fakes them where a test needs them.
export default defineConfig({
  testDir: "tests",
  testMatch: "*.spec.js",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL: "http://localhost:3100/", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "node scripts/serve.js",
    url: "http://localhost:3100/",
    env: { PORT: "3100" },
    reuseExistingServer: !process.env.CI,
  },
});
