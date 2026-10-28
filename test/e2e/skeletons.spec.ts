import { expect, test, type Page } from "@playwright/test";

/**
 * A skeleton must have the shape of the page that comes, or the page jumps when it loads.
 * Each part of a skeleton names the real part that it stands for in `data-copies`, a CSS
 * selector, and the edges that must match in `data-edges`. This test holds an answer of Eva,
 * reads the box of each named part, lets the answer go, and reads the real part.
 */

/** A part may sit this many pixels away from the real one: a grey line is not text. */
const tolerance = 4;

/** The first load waits for the chat list: until it comes, Eva does not know whether the person is logged in. */
const firstLoad = "**/api/sessions";

type Edge = "left" | "top" | "right" | "bottom";

interface Part {
  readonly copies: string;
  readonly edges: readonly Edge[];
  readonly box: Record<Edge, number>;
}

async function logIn(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByLabel(/Token/).fill("e2e-demo-token");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
}

/** The named parts of the skeleton on the page, in the order of the page. */
function skeletonParts(page: Page): Promise<Part[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>(".skeleton [data-copies]")]
      .filter((element) => element.getClientRects().length > 0)
      .map((element) => {
        const box = element.getBoundingClientRect();
        return {
          copies: element.dataset["copies"] ?? "",
          edges: (element.dataset["edges"] ?? "left top right bottom").split(" ") as Edge[],
          box: { left: box.left, top: box.top, right: box.right, bottom: box.bottom },
        };
      }),
  );
}

/** The box of the n-th shown element that matches the selector, or null. */
function realBox(page: Page, selector: string, index: number): Promise<Record<Edge, number> | null> {
  return page.evaluate(
    ([css, nth]) => {
      const shown = [...document.querySelectorAll(css)].filter(
        (element) => element.closest(".skeleton") === null && element.getClientRects().length > 0,
      );
      const box = shown[nth]?.getBoundingClientRect();
      return box === undefined ? null : { left: box.left, top: box.top, right: box.right, bottom: box.bottom };
    },
    [selector, index] as const,
  );
}

/** Each edge of a skeleton part that does not match its real part, such as `.chat-search #0: top is 9 px off`. */
async function mismatches(page: Page, parts: readonly Part[]): Promise<string[]> {
  const seen = new Map<string, number>();
  const wrong: string[] = [];
  for (const part of parts) {
    const index = seen.get(part.copies) ?? 0;
    seen.set(part.copies, index + 1);
    const real = await realBox(page, part.copies, index);
    if (real === null) {
      wrong.push(`${part.copies} #${String(index)}: no such part on the page`);
      continue;
    }
    for (const edge of part.edges) {
      const off = Math.round(part.box[edge] - real[edge]);
      if (Math.abs(off) > tolerance) wrong.push(`${part.copies} #${String(index)}: ${edge} is ${String(off)} px off`);
    }
  }
  return wrong;
}

/**
 * Holds each request that matches `hold`, opens the address, and checks that each named part
 * of the skeleton has the place of its real part once the requests go on.
 */
async function expectSameShape(page: Page, address: string, hold: string): Promise<void> {
  let release = (): void => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(hold, async (route) => {
    await held;
    await route.continue();
  });
  // A new search part makes a new page load, so the first load shows its skeleton too.
  await page.goto(`/?skeleton=${String(Date.now())}${address}`);
  // A skeleton inside a page comes after the first load, which has a skeleton of its own.
  if (hold !== firstLoad) await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
  await expect(page.locator(".skeleton").first()).toBeVisible();
  const parts = await skeletonParts(page);
  expect(parts.length, `The skeleton of ${address} names no part.`).toBeGreaterThan(0);
  release();
  await expect(page.locator(".skeleton")).toHaveCount(0);
  await page.unroute(hold);
  // The page draws its content in more than one step, such as the list, then the open chat.
  await expect.poll(() => mismatches(page, parts)).toEqual([]);
}

/** A chat of its own, so the first answer of the page is a short answer of the scripted engine. */
async function openNewChat(page: Page, text: string): Promise<string> {
  await page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: "Chats" }).click();
  const newChat = page.getByRole("button", { name: /^New/ }).first();
  if (await newChat.isVisible()) await newChat.click();
  const composer = page.getByLabel("Message").first();
  await composer.fill(text);
  await composer.press("Enter");
  await expect(page.locator(".message.answer").first()).toContainText("Echo");
  return new URL(page.url()).hash;
}

test.beforeEach(async ({ page }) => {
  // The shimmer moves, and a moving part would make the boxes differ by chance.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await logIn(page);
});

test("the first load of a chat has the shape of the chat", async ({ page }) => {
  const chat = await openNewChat(page, "Skeleton shapes chat sample");
  await expectSameShape(page, chat, firstLoad);
});

for (const [name, address] of [
  ["Projects", "#/projects"],
  ["a project", "#/projects/2025-03-02-1015-example-app"],
  ["Files", "#/files"],
  ["Schedules", "#/schedules"],
  ["Settings", "#/settings"],
] as const) {
  test(`the first load of ${name} has the shape of the page`, async ({ page }) => {
    await expectSameShape(page, address, firstLoad);
  });
}

for (const [name, address, hold] of [
  ["the project list", "#/projects", "**/api/projects?*"],
  ["a folder", "#/files", "**/api/files?*"],
  ["the settings", "#/settings", "**/api/settings"],
] as const) {
  test(`the skeleton of ${name} has the shape of the list`, async ({ page }) => {
    await expectSameShape(page, address, hold);
  });
}
