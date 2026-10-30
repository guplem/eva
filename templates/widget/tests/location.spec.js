import { expect, test } from "@playwright/test";
import { fakeEvaLocation } from "./helpers.js";

test.describe("outside Eva, when the visitor allows the location", () => {
  test.use({ geolocation: { latitude: 51.5007, longitude: -0.1246 }, permissions: ["geolocation"] });

  test("shows the visitor's real location", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator('[data-role="location"]')).toHaveText("Near 51.50, -0.12");
  });
});

test("outside Eva, when the visitor does not allow the location, shows the mock location", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator('[data-role="location"]')).toHaveText("Near 48.86, 2.29 (example location)");
});

test.describe("inside Eva", () => {
  test.use({ geolocation: { latitude: 51.5007, longitude: -0.1246 }, permissions: ["geolocation"] });

  test("shows Eva's location, never the browser's or the mock one", async ({ page }) => {
    await fakeEvaLocation(page, { latitude: 40.4168, longitude: -3.7038, accuracy: 20, at: "2026-01-01T09:30:00Z" });
    await page.goto("/");
    await expect(page.locator('[data-role="location"]')).toHaveText("Near 40.42, -3.70");
  });

  test("says when Eva has no location yet", async ({ page }) => {
    await fakeEvaLocation(page, null);
    await page.goto("/");
    await expect(page.locator('[data-role="location"]')).toHaveText("No location yet.");
  });
});
