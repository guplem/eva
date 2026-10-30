import { expect, test } from "@playwright/test";
import { fakeWrites, today } from "./helpers.js";

test("shows the title of config.json and each mock habit", async ({ page }) => {
  await page.goto("/?size=medium");
  await expect(page.locator(".widget-title")).toHaveText("Habits");
  await expect(page.locator(".habit-check")).toHaveText(["Meditate", "Read", "Walk"]);
  await expect(page.locator('[data-role="summary"]')).toHaveText("0 of 3 done today");
});

test("a check writes the whole habit file, with the fields that the widget does not know", async ({ page }) => {
  const writes = await fakeWrites(page);
  await page.goto("/?size=medium");
  await page.getByRole("button", { name: "Read" }).click();
  await expect(page.getByRole("button", { name: "Read" })).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]).toEqual({
    method: "PUT",
    path: "data/habits/read.json",
    body: {
      name: "Read",
      kind: "yesNo",
      frequency: { times: 5, days: 7 },
      checks: [{ date: "2026-01-02" }, { date: today() }],
      tags: ["evening"],
    },
  });
  await expect(page.locator('[data-role="note"]')).toBeHidden();
});

test("outside Eva, a write fails, and the change shows on the screen only, with the demo note", async ({ page }) => {
  await page.goto("/?size=medium");
  await page.getByRole("button", { name: "Walk" }).click();
  await expect(page.getByRole("button", { name: "Walk" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('[data-role="summary"]')).toHaveText("1 of 3 done today");
  await expect(page.locator('[data-role="note"]')).toHaveText("This is a demo: the change shows on this screen only.");
});

test("the small size shows the count only", async ({ page }) => {
  await page.goto("/?size=small");
  await expect(page.locator('[data-role="summary"]')).toHaveText("0 of 3 done today");
  await expect(page.locator(".habit-list")).toBeHidden();
});

test("the demo server answers a broken address with 404, and keeps running", async ({ request }) => {
  expect((await request.get("/%E0%A4%A")).status()).toBe(404);
  expect((await request.get("/")).status()).toBe(200);
});
