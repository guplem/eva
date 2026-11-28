import { expect, test, type Page } from "@playwright/test";
import { outsideAddress } from "./demo-pages.ts";

/**
 * The pages of a chat answer in a real browser (#1129): the frame in the bubble, its script, full
 * screen, the note of a page that is gone, and a network that stays shut.
 */

async function logIn(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByLabel(/Token/).fill("e2e-demo-token");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
}

/** Sends one message in a new chat. Each demo message holds words that no button name holds. */
async function ask(page: Page, text: string): Promise<void> {
  await page.goto("/#/chats/new");
  const composer = page.getByLabel("Message").first();
  await composer.fill(text);
  await composer.press("Control+Enter");
}

const bubbleFrame = '.message.answer .page-frame iframe[aria-label="Page: steps-this-week"]';

test("an answer shows its page in the bubble, with no marker, and the page's script runs", async ({ page }) => {
  await logIn(page);
  await ask(page, "draw my walking");
  const answer = page.locator(".message.answer").first();
  await expect(answer.locator(".answer-body")).toHaveText("Here are your steps of this week.");
  await expect(answer).not.toContainText("[[show");
  const frame = page.frameLocator(bubbleFrame);
  await expect(frame.locator('body[data-ready="true"]')).toBeVisible();
  // The sandbox: scripts only, and no origin.
  await expect(page.locator(bubbleFrame)).toHaveAttribute("sandbox", "allow-scripts");
  // The theme of Eva reaches the page.
  const accent = await frame.locator("body").evaluate((body) => getComputedStyle(body).getPropertyValue("--accent"));
  expect(accent.trim()).not.toBe("");
  await frame.locator(".hit").nth(5).click();
  await expect(frame.locator("#value")).toHaveText("Sat: 11,240 steps");
  // The page fits its box: nothing scrolls sideways.
  const widths = await frame
    .locator("html")
    .evaluate((html) => ({ scroll: html.scrollWidth, client: html.clientWidth }));
  expect(widths.scroll).toBeLessThanOrEqual(widths.client);

  // After a reload, the stored answer still shows the page.
  await page.reload();
  await expect(page.frameLocator(bubbleFrame).locator('body[data-ready="true"]')).toBeVisible();
});

test("the full-screen button opens the page over the app, and Back closes it", async ({ page }) => {
  await logIn(page);
  await ask(page, "draw my walking");
  await expect(page.frameLocator(bubbleFrame).locator('body[data-ready="true"]')).toBeVisible();
  await page.getByRole("button", { name: "Open steps-this-week in full screen" }).click();
  const full = page.getByRole("dialog", { name: "steps-this-week" });
  await expect(full).toBeVisible();
  await expect(page.frameLocator(".widget-full iframe").locator('body[data-ready="true"]')).toBeVisible();
  const box = await full.boundingBox();
  const viewport = page.viewportSize();
  expect(box?.width).toBe(viewport?.width);
  await page.getByRole("button", { name: "Close full screen" }).click();
  await expect(full).toHaveCount(0);

  await page.getByRole("button", { name: "Open steps-this-week in full screen" }).click();
  await expect(full).toBeVisible();
  await page.goBack();
  await expect(full).toHaveCount(0);
  await expect(page.locator(bubbleFrame)).toBeVisible();
});

test("full screen takes the focus, Escape closes it, and the focus goes back", async ({ page }) => {
  await logIn(page);
  await ask(page, "draw my walking");
  await expect(page.frameLocator(bubbleFrame).locator('body[data-ready="true"]')).toBeVisible();
  const open = page.getByRole("button", { name: "Open steps-this-week in full screen" });
  await open.click();
  const full = page.getByRole("dialog", { name: "steps-this-week" });
  await expect(page.getByRole("button", { name: "Close full screen" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(full).toHaveCount(0);
  await expect(open).toBeFocused();
});

test("full screen of a page that went away shows the note of the bubble", async ({ page }) => {
  await logIn(page);
  await ask(page, "draw my walking");
  await expect(page.frameLocator(bubbleFrame).locator('body[data-ready="true"]')).toBeVisible();
  await page.route("**/api/pages/frame", (route) =>
    route.fulfill({ json: { state: "gone", reason: ".eva/scratch/steps-this-week.html does not exist." } }),
  );
  await page.getByRole("button", { name: "Open steps-this-week in full screen" }).click();
  await expect(page.getByRole("dialog").locator(".page-note")).toHaveText(
    "This page is gone. Eva deletes a page after 7 days.",
  );
  await expect(page.getByRole("dialog").getByRole("progressbar")).toHaveCount(0);
});

test("a token that served no page gets a new one, and a frame never stays blank", async ({ page }) => {
  let asked = 0;
  await page.route("**/api/pages/frame", async (route) => {
    asked += 1;
    await route.continue();
  });
  let loads = 0;
  // The first load plays a token that expired before the frame loaded.
  await page.route("**/api/pages/loaded", async (route) => {
    loads += 1;
    if (loads === 1) await route.fulfill({ json: { served: false } });
    else await route.continue();
  });
  await logIn(page);
  await ask(page, "draw my walking");
  await expect(page.frameLocator(bubbleFrame).locator('body[data-ready="true"]')).toBeVisible();
  await expect(page.locator(".message.answer .page-wait")).toHaveCount(0);
  expect(loads).toBe(2);
  expect(asked).toBeGreaterThanOrEqual(2);

  // A frame that no token serves gives up with a note.
  await page.unroute("**/api/pages/loaded");
  await page.route("**/api/pages/loaded", (route) => route.fulfill({ json: { served: false } }));
  await page.reload();
  await expect(page.locator(".message.answer .page-note")).toHaveText(
    "Eva could not load this page. Reload the chat to try again.",
  );
});

test("a page that is gone shows a short note instead of the frame", async ({ page }) => {
  await logIn(page);
  await ask(page, "the lost drawing");
  const answer = page.locator(".message.answer").first();
  await expect(answer.locator(".page-note")).toHaveText("This page is gone. Eva deletes a page after 7 days.");
  await expect(answer.locator("iframe")).toHaveCount(0);
});

test("a page reaches no network: fetch, images, scripts, frames, workers, forms and popups all fail", async ({
  page,
}) => {
  const reached: string[] = [];
  await page.context().route(`${outsideAddress}/**`, async (route) => {
    reached.push(route.request().url());
    await route.fulfill({ status: 200, body: "" });
  });
  await logIn(page);
  await ask(page, "probe the wire");
  const probe = page.frameLocator('.message.answer iframe[aria-label="Page: network-probe"]');
  await expect(probe.locator('body[data-done="true"]')).toBeAttached();
  const out = probe.locator("#out");
  for (const line of [
    "refused connect-src",
    "refused img-src",
    "refused script-src",
    "refused frame-src",
    "fetch failed",
    "popup blocked",
    "storage blocked",
  ])
    await expect(out).toContainText(line);
  await expect(out).not.toContainText("loaded");
  await expect(out).not.toContainText("fetch reached");
  expect(reached).toEqual([]);
  // The page never moved the app.
  await expect(page).toHaveURL(/#\/chat/);
});
