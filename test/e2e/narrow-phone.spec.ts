import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * A narrow phone, 320 px wide, with long real names in the demo vault: no page scrolls sideways
 * (issue 675). The demo server writes the long names in `serve-demo.ts`.
 */

const narrowPhone = { width: 320, height: 640 };

// The test sets its own screen, so one browser run is enough.
test.beforeEach(() => {
  test.skip(test.info().project.name !== "phone");
});
test.use({ viewport: narrowPhone });

async function logIn(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByLabel(/Token/).fill("e2e-demo-token");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
}

/**
 * Each visible element that reaches past the right edge of the screen, or of a box that scrolls.
 * A box that scrolls hides this from the width of the page, so the test looks at each element,
 * and at each box that scrolls sideways.
 * A box that clips, such as a chip that gets shorter, cuts its content on purpose.
 * A code block, a diff and the branch map scroll sideways on purpose, so wide content in them is fine.
 */
function pastTheEdge(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const sideways = "pre, .diff, .branch-map-column";
    const found = new Set<string>();
    for (const element of document.querySelectorAll<HTMLElement>("body *")) {
      const box = element.getBoundingClientRect();
      if (box.width === 0 || box.height === 0 || getComputedStyle(element).visibility === "hidden") continue;
      if (element.closest(sideways) !== null) continue;
      const label = `${element.tagName.toLowerCase()}${[...element.classList].map((name) => `.${name}`).join("")}`;
      // Text with no break point spills out of its own box, which keeps its width, and the box around it scrolls.
      if (/auto|scroll/.test(getComputedStyle(element).overflowX) && element.scrollWidth > element.clientWidth + 1) {
        found.add(`${label} scrolls sideways`);
      }
      let edge = innerWidth;
      let clipped = false;
      for (let parent = element.parentElement; parent !== null; parent = parent.parentElement) {
        const overflowX = getComputedStyle(parent).overflowX;
        if (overflowX === "visible") continue;
        const outer = parent.getBoundingClientRect();
        const right = outer.left + parent.clientLeft + parent.clientWidth;
        if (overflowX === "hidden" || overflowX === "clip") clipped ||= box.right > right + 1;
        else edge = Math.min(edge, right);
      }
      if (clipped || box.right <= edge + 1) continue;
      found.add(`${label}: ${String(Math.round(box.right - edge))} px`);
    }
    if (document.documentElement.scrollWidth > innerWidth + 1) found.add("the page scrolls sideways");
    return [...found];
  });
}

async function expectNoSideScroll(page: Page, address: string, shown: Locator): Promise<void> {
  await expect(shown, address).toBeVisible();
  expect(await pastTheEdge(page), address).toEqual([]);
}

test("no page scrolls sideways on a narrow phone, also with long names", async ({ page }) => {
  await logIn(page);
  const longProject = page.getByRole("button", { name: /Northwind Holdings reporting backend/ });
  const longNote = page.getByRole("link", { name: /Benachrichtigungseinstellungen/ });
  const pages: [string, Locator][] = [
    ["#/chats", page.locator(".composer-box")],
    ["#/projects", longProject],
    ["#/files/Notes", longNote],
    ["#/schedules", page.locator(".schedule-panel").first()],
    ["#/notifications", page.getByRole("heading", { level: 1 })],
    ["#/settings", page.locator(".section-card").first()],
  ];
  for (const [address, shown] of pages) {
    await page.goto(`/${address}`);
    await expectNoSideScroll(page, address, shown);
  }

  await page.goto("/#/projects");
  await longProject.click();
  await expectNoSideScroll(page, "the long project", page.getByRole("heading", { level: 1 }));

  for (const section of [
    "setup",
    "engines",
    "vault",
    "connections",
    "trust",
    "access",
    "personalize",
    "developer",
    "updates",
  ]) {
    const address = `#/settings/${section}`;
    await page.goto(`/${address}`);
    await expectNoSideScroll(page, address, page.locator(".settings-page .card").first());
  }
});

test("a chat and its details do not scroll sideways on a narrow phone", async ({ page }) => {
  await logIn(page);
  const created = await page.request.post("/api/sessions", { data: { mode: "assistant" } });
  const { id } = (await created.json()) as { id: string };
  await page.goto(`/#/chat/${id}`);
  // A long address has no break point. It also becomes the title of the chat.
  const words = "quarterly-reporting-backend-notifications@northwind-holdings.example.com";
  const composer = page.getByLabel("Message").first();
  await composer.fill(words);
  await composer.press("Enter");
  await expectNoSideScroll(page, "the chat", page.locator(".message.answer").filter({ hasText: words }));

  await page.getByRole("heading", { level: 1 }).getByRole("button").click();
  await expectNoSideScroll(page, "the chat details", page.getByRole("dialog", { name: "This chat" }));
});
