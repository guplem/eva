import { expect, test, type Page } from "@playwright/test";

/**
 * Save and Pin of a page of a chat (#1130) in a real browser. Each test sketches a page with a name
 * of its own: a saved page outlives its test, and the tests share one demo server.
 */

async function logIn(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByLabel(/Token/).fill("e2e-demo-token");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
}

/** Sends one message in a new chat, and waits for the page of the answer. */
async function sketch(page: Page, name: string): Promise<void> {
  await page.goto("/#/chats/new");
  const composer = page.getByLabel("Message").first();
  await composer.fill(`sketch the stroll ${name}`);
  await composer.press("Control+Enter");
  await expect(
    page.frameLocator(`.message.answer iframe[aria-label="Page: ${name}"]`).locator('body[data-ready="true"]'),
  ).toBeVisible();
}

function isPhone(page: Page): boolean {
  return (page.viewportSize()?.width ?? 0) <= 760;
}

test("Save keeps a page, which shows that it is saved after a reload, and Remove makes it gone", async ({ page }) => {
  await logIn(page);
  await sketch(page, "kept-stroll");
  const answer = page.locator(".message.answer").first();
  await answer.getByRole("button", { name: "Save kept-stroll" }).click();
  const saved = answer.getByRole("button", { name: "kept-stroll is saved" });
  await expect(saved).toHaveText("Saved");
  await page.reload();
  await expect(saved).toHaveText("Saved");
  await expect(
    page.frameLocator('.message.answer iframe[aria-label="Page: kept-stroll"]').locator('body[data-ready="true"]'),
  ).toBeVisible();

  await saved.click();
  await page.getByRole("menuitem", { name: "Remove the saved page" }).click();
  const question = page.getByRole("dialog", { name: "Remove kept-stroll?" });
  await question.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(question).toHaveCount(0);
  await expect(answer.locator(".page-note")).toHaveText(
    "This page is gone. Eva deletes a page that nobody saved after 7 days.",
  );
});

test("Pin shows the page beside the chat, keeps it after a reload, and shows Eva's change after her answer", async ({
  page,
}) => {
  await logIn(page);
  await sketch(page, "pinned-stroll");
  await page.getByRole("button", { name: "Pin pinned-stroll beside the chat" }).click();
  // Pin also saves the page.
  await expect(page.getByRole("button", { name: "pinned-stroll is saved" })).toBeVisible();
  const pinned = isPhone(page)
    ? page.getByRole("group", { name: "Pinned page" })
    : page.getByRole("complementary", { name: "Pinned page: pinned-stroll" });
  await expect(pinned).toBeVisible();
  if (!isPhone(page)) {
    const column = page.frameLocator('.pinned-page iframe[aria-label="Page: pinned-stroll"]');
    await expect(column.locator('body[data-ready="true"]')).toBeVisible();
    await expect(column.getByText("Goal 8k")).toBeVisible();
  }

  // The page stays in view while the chat goes on, and the column shows Eva's change by itself.
  const composer = page.getByLabel("Message").first();
  await composer.fill("raise the stroll goal of pinned-stroll");
  await composer.press("Control+Enter");
  await expect(page.locator(".message.answer").getByText("The goal is now 10,000 steps.")).toBeVisible();
  await expect(pinned).toBeVisible();
  if (!isPhone(page))
    await expect(
      page.frameLocator('.pinned-page iframe[aria-label="Page: pinned-stroll"]').getByText("Goal 10k"),
    ).toBeVisible();

  await page.reload();
  await expect(pinned).toBeVisible();
  await pinned.getByRole("button", { name: "Unpin pinned-stroll" }).click();
  await expect(pinned).toHaveCount(0);
  // Unpin keeps the saved file.
  await expect(page.getByRole("button", { name: "pinned-stroll is saved" }).first()).toBeVisible();
});

test("on a phone the pinned page is a bar above the message box, and a tap opens it in full screen", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await logIn(page);
  await sketch(page, "phone-stroll");
  await page.getByRole("button", { name: "Pin phone-stroll beside the chat" }).click();
  const bar = page.getByRole("group", { name: "Pinned page" });
  await expect(bar).toBeVisible();
  await expect(page.locator(".pinned-page")).toHaveCount(0);
  // The bar sits right above the message box.
  const barBox = await bar.boundingBox();
  const boxBox = await page.locator(".composer-box").boundingBox();
  expect((barBox?.y ?? 0) + (barBox?.height ?? 0)).toBeLessThanOrEqual(boxBox?.y ?? 0);
  await bar.getByRole("button", { name: "Open phone-stroll in full screen" }).click();
  const full = page.getByRole("dialog", { name: "phone-stroll" });
  await expect(full.locator("iframe")).toBeVisible();
  await page.goBack();
  await expect(full).toHaveCount(0);
});

test("a computer keeps the chat readable: the column has limits, and the details cover it when both do not fit", async ({
  page,
}) => {
  test.skip(isPhone(page), "A phone shows the bar.");
  await page.setViewportSize({ width: 1280, height: 800 });
  await logIn(page);
  await sketch(page, "wide-stroll");
  await page.getByRole("button", { name: "Pin wide-stroll beside the chat" }).click();
  const column = page.getByRole("complementary", { name: "Pinned page: wide-stroll" });
  await expect(column).toBeVisible();
  const chatWidth = async (): Promise<number> => (await page.locator(".layout > .main").boundingBox())?.width ?? 0;
  expect(await chatWidth()).toBeGreaterThanOrEqual(480);

  // The divider makes the column wider, but never takes the chat below its width.
  const divider = page.getByRole("separator", { name: "Width of the pinned page" });
  const before = (await column.boundingBox())?.width ?? 0;
  await divider.focus();
  await page.keyboard.press("ArrowLeft");
  await expect.poll(async () => (await column.boundingBox())?.width ?? 0).toBeGreaterThan(before);
  for (let step = 0; step < 30; step += 1) await page.keyboard.press("ArrowLeft");
  expect(await chatWidth()).toBeGreaterThanOrEqual(480);
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await column.boundingBox())?.width ?? 0).toBe(400);

  // At 1280 px the details open over the column, and the column stays under them.
  await page.getByRole("button", { name: "Show the chat details" }).click();
  await expect(page.locator(".layout.details-over-pin .chat-panel")).toBeVisible();
  await expect(column).toBeAttached();
  await page.getByRole("button", { name: "Hide the chat details" }).click();
  await expect(page.locator(".layout .chat-panel")).toHaveCount(0);

  // A narrow window shows the bar instead of the column.
  await page.setViewportSize({ width: 1000, height: 800 });
  await expect(column).toHaveCount(0);
  await expect(page.getByRole("group", { name: "Pinned page" })).toBeVisible();
});
