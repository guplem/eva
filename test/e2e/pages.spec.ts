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

const bubbleFrame = '.message.answer .page-frame iframe[aria-label="steps-this-week"]';

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
  const probe = page.frameLocator('.message.answer iframe[aria-label="network-probe"]');
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
