import { expect, test } from "@playwright/test";

/**
 * Plays Eva's part of the asks: it answers each request with the approved asks and records it.
 * Opened alone, the widget's parent is its own window, so the fake listens there.
 */
async function fakeEva(page) {
  await page.addInitScript(() => {
    window.sentAsks = [];
    window.addEventListener("message", (event) => {
      const data = event.data;
      if (data?.eva !== "widget" || "ok" in data) return;
      window.sentAsks.push(data);
      const answer = data.ask === "hello" ? { ok: true, asks: ["chat", "open"] } : { ok: true };
      window.postMessage({ eva: "widget", id: data.id, ...answer }, "*");
    });
  });
}

test("outside Eva, no answer comes, and the asks stay hidden", async ({ page }) => {
  await page.goto("/?size=medium");
  await expect(page.locator(".widget")).toHaveAttribute("data-ready", "true");
  await expect(page.locator("[data-ask]")).toHaveCount(2);
  await expect(page.locator("[data-ask]:visible")).toHaveCount(0);
});

test("inside Eva, each approved ask shows, and a tap sends it", async ({ page }) => {
  await fakeEva(page);
  await page.goto("/?size=medium");
  await page.getByRole("button", { name: "Chat about my habits" }).click();
  await page.getByRole("button", { name: "Open the folder in Eva" }).click();
  // A message arrives a moment after the tap. JSON leaves out the keys that a message has not.
  const sent = () =>
    page.evaluate(() =>
      JSON.parse(JSON.stringify(window.sentAsks.map(({ ask, text, path }) => ({ ask, text, path })))),
    );
  await expect
    .poll(sent)
    .toEqual([
      { ask: "hello" },
      { ask: "chat", text: "Let us talk about my habits in Life/Habits." },
      { ask: "open", path: "Life/Habits" },
    ]);
});
