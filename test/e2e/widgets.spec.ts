import { expect, test, type Frame, type Page } from "@playwright/test";

/**
 * The widgets of the home page in a real browser (#691). The demo server approved the habits
 * widget of the template for `Life/Habits`.
 */

async function logIn(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByLabel(/Token/).fill("e2e-demo-token");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
}

/** The frame of the habits widget in the grid, once the widget has its content. */
async function habitsFrame(page: Page): Promise<Frame> {
  await page.goto("/#/chats/new");
  const grid = page.getByRole("group", { name: "Widgets" });
  await expect(grid).toBeVisible();
  await expect(page.frameLocator(".widget-grid iframe").locator('.widget[data-ready="true"]')).toBeVisible();
  const frame = page.frames().find((candidate) => candidate.url().includes("/widgets/"));
  if (frame === undefined) throw new Error("The grid must show the widget's frame.");
  return frame;
}

test("the home page shows the widget below the greeting, and a tap marks a habit", async ({ page }) => {
  await logIn(page);
  await habitsFrame(page);
  const order = await page
    .locator(".new-chat > *")
    .evaluateAll((parts): string[] => parts.map((part) => part.getAttribute("class") ?? ""));
  expect(order.indexOf("widget-grid")).toBeGreaterThan(0);
  expect(order.indexOf("widget-grid")).toBeLessThan(order.indexOf("suggestions"));
  const widget = page.frameLocator(".widget-grid iframe");
  const first = widget.locator(".habit-check").first();
  const before = await first.getAttribute("aria-pressed");
  await first.click();
  await expect(first).toHaveAttribute("aria-pressed", before === "true" ? "false" : "true");
  // The widget wrote the file in the vault: the Files page reads the check of today.
  const today = await page.evaluate(() => {
    const now = new Date();
    return `${String(now.getFullYear())}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  });
  const checkedToday = async (): Promise<boolean> => {
    const texts = await Promise.all(
      ["meditate", "read", "walk"].map(async (habit) => {
        const answer = await page.request.get(`/api/files?path=${encodeURIComponent(`Life/Habits/${habit}.json`)}`);
        return ((await answer.json()) as { text?: string }).text ?? "";
      }),
    );
    return texts.some((text) => text.includes(`"${today}"`));
  };
  await expect.poll(checkedToday).toBe(before !== "true");
  await first.click();
  await expect(first).toHaveAttribute("aria-pressed", before ?? "false");
});

test("a widget has no origin: it cannot read Eva's API, the cookie or the page", async ({ page }) => {
  await logIn(page);
  const frame = await habitsFrame(page);
  const reach = await frame.evaluate(async () => {
    const tryRead = async (address: string): Promise<string> => {
      try {
        const answer = await fetch(address);
        return `status ${String(answer.status)}`;
      } catch {
        return "blocked";
      }
    };
    let cookie: string;
    try {
      cookie = document.cookie;
    } catch {
      cookie = "blocked";
    }
    let parentPage: string;
    try {
      parentPage = window.parent.document.title;
    } catch {
      parentPage = "blocked";
    }
    let storage: string;
    try {
      storage = String(window.localStorage.length);
    } catch {
      storage = "blocked";
    }
    return {
      api: await tryRead("/api/status"),
      outside: await tryRead("https://example.com/"),
      config: await tryRead("config.json"),
      cookie,
      parentPage,
      storage,
      origin: window.origin,
    };
  });
  expect(reach).toEqual({
    api: "blocked",
    outside: "blocked",
    config: "status 200",
    cookie: "blocked",
    parentPage: "blocked",
    storage: "blocked",
    origin: "null",
  });
});

test("a widget address opened as a page of its own shows nothing", async ({ page, context }) => {
  await logIn(page);
  const frame = await habitsFrame(page);
  const alone = await context.newPage();
  const answer = await alone.goto(frame.url());
  expect(answer?.status()).toBe(403);
  await alone.close();
});

test("the corner button opens the widget in full screen inside Eva, and its close button closes it", async ({
  page,
}) => {
  await logIn(page);
  await habitsFrame(page);
  await page.getByRole("button", { name: "Open Habits in full screen" }).click();
  const full = page.getByRole("dialog", { name: "Habits" });
  await expect(full).toBeVisible();
  await expect(page.frameLocator(".widget-full iframe").locator('.widget[data-size="full"]')).toBeVisible();
  await page.getByRole("button", { name: "Close full screen" }).click();
  await expect(full).toHaveCount(0);
});

test("Personalize lists the widget, on, with its repository and owner", async ({ page }) => {
  await logIn(page);
  await page.goto("/#/settings/personalize/widgets");
  const list = page.getByRole("list", { name: "Widgets" });
  await expect(list).toContainText("Habits");
  await expect(list).toContainText("example-owner/habits-widget");
  await expect(list).toContainText("On");
});

test("Preview on a clone shows a change that is not pushed, with example data first, then my data", async ({
  page,
}) => {
  await logIn(page);
  await page.getByRole("button", { name: "Projects", exact: true }).click();
  await page.getByLabel("Search projects").fill("habits widget");
  await page.getByRole("button", { name: /Habits widget/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Habits widget" })).toBeVisible();
  await page.locator('[aria-label="Repository habits-widget"]').getByRole("button", { name: "Preview" }).click();
  const dialog = page.getByRole("dialog", { name: /Preview of/ });
  await expect(dialog.getByRole("button", { name: "Example data" })).toHaveAttribute("aria-pressed", "true");
  const widget = dialog.frameLocator("iframe");
  // The clone's config.json has a title that is not pushed.
  await expect(widget.locator(".widget-title")).toHaveText("Mock habits");
  await dialog.getByRole("button", { name: "My data" }).click();
  // The widget is set up in Eva and the clone adds no permission: it shows the person's data at once.
  await expect(widget.locator('.widget[data-ready="true"]')).toBeVisible();
  await expect(widget.locator(".widget-title")).not.toHaveText("Mock habits");
  await dialog.getByRole("button", { name: "Example data" }).click();
  await expect(widget.locator(".widget-title")).toHaveText("Mock habits");
});
