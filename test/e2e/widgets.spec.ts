import { expect, test, type Frame, type Locator, type Page } from "@playwright/test";

/**
 * The widgets of the home page in a real browser (#691). The demo server approved, in this order,
 * a static Calendar (xlarge), the habits widget of the template for `Life/Habits` (small)
 * and a static Cases (tall).
 */

/** The Projects button. A Project chat of another test can add its unread count to the name. */
const projectsButton = /^Projects(?: \d+ unread chats?)?$/;

async function logIn(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByLabel(/Token/).fill("e2e-demo-token");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
}

const habitsInGrid = '.widget-grid iframe[aria-label="Habits"]';

/** The frame of the habits widget in the grid, once the widget has its content. */
async function habitsFrame(page: Page): Promise<Frame> {
  await page.goto("/#/home");
  const grid = page.getByRole("group", { name: "Widgets" });
  await expect(grid).toBeVisible();
  await expect(page.frameLocator(habitsInGrid).locator('.widget[data-ready="true"]')).toBeVisible();
  const frame = await (await page.locator(habitsInGrid).elementHandle()).contentFrame();
  if (frame === null) throw new Error("The grid must show the widget's frame.");
  return frame;
}

/** The box of each card of the grid, by the widget's name. */
async function cardBoxes(page: Page): Promise<Record<string, { x: number; y: number; width: number; height: number }>> {
  const boxes: Record<string, { x: number; y: number; width: number; height: number }> = {};
  for (const name of ["Calendar", "Habits", "Cases"]) {
    const box = await page.locator(`.widget-card:has(iframe[aria-label="${name}"])`).boundingBox();
    if (box === null) throw new Error(`The grid must show ${name}.`);
    boxes[name] = box;
  }
  return boxes;
}

test("with a widget on, the home page is a day panel: a one-line greeting, the widgets, no suggestions", async ({
  page,
}) => {
  await logIn(page);
  await habitsFrame(page);
  const panel = page.locator(".new-chat.day-panel");
  await expect(panel.locator(".day-greeting h2")).toBeVisible();
  await expect(panel.locator(".day-greeting .mk")).toBeVisible();
  await expect(page.getByRole("group", { name: "Suggestions" })).toHaveCount(0);
  await expect(page.locator(".fact-question")).toHaveCount(0);
  // The grid takes the whole width of the column of the page.
  const grid = await page.locator(".widget-grid").boundingBox();
  const column = await page.locator(".branch").boundingBox();
  expect(Math.abs((grid?.width ?? 0) - (column?.width ?? 0))).toBeLessThan(2);
  const { Calendar: calendar, Habits: habits, Cases: cases } = await cardBoxes(page);
  if (calendar === undefined || habits === undefined || cases === undefined) throw new Error("three cards");
  const composer = await page.locator(".composer-box").boundingBox();
  if (test.info().project.name === "phone") {
    // A phone stacks Habits, Cases, then Calendar at the full width, and the page scrolls.
    expect(habits.y).toBeLessThan(cases.y);
    expect(cases.y).toBeLessThan(calendar.y);
    expect(Math.abs(calendar.width - (grid?.width ?? 0))).toBeLessThan(2);
    expect(Math.abs(cases.width - (grid?.width ?? 0))).toBeLessThan(2);
    // Habits is the only small card, so it takes the whole row, not half of it.
    expect(Math.abs(habits.width - (grid?.width ?? 0))).toBeLessThan(2);
    expect(calendar.height).toBeGreaterThan(cases.height);
  } else {
    // A computer: Calendar at the left, three columns wide, and Habits above Cases in the fourth column.
    expect(calendar.x).toBeLessThan(habits.x);
    expect(Math.abs(habits.x - cases.x)).toBeLessThan(2);
    expect(habits.y).toBeLessThan(cases.y);
    expect(Math.abs(calendar.y - habits.y)).toBeLessThan(2);
    expect(calendar.width).toBeGreaterThan(habits.width * 2.5);
    // The three rows fill the height above the message box.
    expect(Math.abs(calendar.y + calendar.height - (cases.y + cases.height))).toBeLessThan(2);
    expect((composer?.y ?? 0) - (calendar.y + calendar.height)).toBeLessThan(80);
    expect(calendar.height).toBeGreaterThan(3 * 140);
  }
});

test("on a phone two small cards share a row, and a small card with no partner takes the whole row", async ({
  page,
}) => {
  test.skip(test.info().project.name !== "phone", "The phone grid only.");
  // A card to approve is always small, so these cards have a frame. Its page does not exist: the test needs only its place.
  const card = (id: string, size: string): Record<string, unknown> => ({
    id,
    name: id,
    size,
    layout: {},
    src: `/widgets/none/${id}/index.html`,
    token: null,
  });
  await page.route("**/api/widgets/frames", async (route) => {
    await route.fulfill({
      json: [
        card("Small one", "small"),
        card("Tall card", "tall"),
        card("Small two", "small"),
        card("Small three", "small"),
      ],
    });
  });
  await logIn(page);
  await page.goto("/#/home");
  const grid = await page.locator(".widget-grid").boundingBox();
  const box = async (name: string): Promise<{ x: number; y: number; width: number }> => {
    const found = await page.locator(`.widget-card:has(iframe[aria-label="${name}"])`).boundingBox();
    if (found === null) throw new Error(`The grid must show ${name}.`);
    return found;
  };
  await expect(page.locator(".widget-card")).toHaveCount(4);
  const [a, c, d] = [await box("Small one"), await box("Small two"), await box("Small three")];
  expect(Math.abs(a.y - c.y)).toBeLessThan(2);
  expect(a.width).toBeLessThan((grid?.width ?? 0) / 2);
  expect(Math.abs(d.width - (grid?.width ?? 0))).toBeLessThan(2);
});

test("with no widget on, the home page keeps the large visor and the suggestions", async ({ page }) => {
  await page.route("**/api/widgets/frames", async (route) => {
    await route.fulfill({ json: [] });
  });
  await logIn(page);
  await page.goto("/#/home");
  await expect(page.getByRole("group", { name: "Suggestions" })).toBeVisible();
  await expect(page.locator(".new-chat .mk.xl")).toBeVisible();
  await expect(page.locator(".day-panel")).toHaveCount(0);
  await expect(page.getByRole("group", { name: "Widgets" })).toHaveCount(0);
});

/**
 * Opens Habits in full screen, and waits until the widget is ready. The widget draws its buttons again after Eva
 * answers its `hello`, so a tap before that can hit a button that is gone, and no ask leaves.
 */
async function openHabitsFull(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Open Habits in full screen" }).click();
  await expect(page.frameLocator(".widget-full iframe").locator('.widget[data-ready="true"]')).toBeVisible();
}

test("a widget asks Eva after a tap: its text goes in the message box, and a path opens its page (#696, #1006)", async ({
  page,
}) => {
  await logIn(page);
  await habitsFrame(page);
  const box = page.getByRole("textbox", { name: "Message" });
  await box.fill("My own words");
  // The small card shows only the count, so the taps happen in full screen.
  await openHabitsFull(page);
  await page.frameLocator(".widget-full iframe").getByRole("button", { name: "Chat about my habits" }).click();
  // Full screen closes, the text comes after the person's own words, and the box names the widget.
  await expect(page.locator(".widget-full")).toHaveCount(0);
  await expect(box).toHaveValue("My own words\n\nLet us talk about my habits in Life/Habits.");
  await expect(page.getByRole("list", { name: "Where the text comes from" })).toHaveText("From Habits");
  // Eva never sends the text: the person clears it, and the box no longer names the widget.
  await box.fill("");
  await expect(page.getByRole("list", { name: "Where the text comes from" })).toHaveCount(0);
  await openHabitsFull(page);
  await page.frameLocator(".widget-full iframe").getByRole("button", { name: "Open the folder in Eva" }).click();
  await expect(page).toHaveURL(/#\/files\/Life\/Habits$/);
  await expect(page.locator(".widget-full")).toHaveCount(0);
});

test("a widget's message with no tap before it does nothing (#696)", async ({ page }) => {
  await logIn(page);
  const frame = await habitsFrame(page);
  // The widget sends the ask by itself, with no tap of the person.
  const answer = await frame.evaluate(
    () =>
      new Promise((resolve) => {
        window.addEventListener("message", (event: MessageEvent) => {
          const data = event.data as { id?: number; ok?: boolean };
          if (data.id === 990 && typeof data.ok === "boolean") resolve(data);
        });
        window.parent.postMessage({ eva: "widget", id: 990, ask: "open", path: "Life" }, "*");
      }),
  );
  expect(answer).toEqual({ eva: "widget", id: 990, ok: false, reason: "no-tap" });
  await expect(page).toHaveURL(/#\/home$/);
});

test("a tap in the habits widget in full screen marks a habit", async ({ page }) => {
  await logIn(page);
  await habitsFrame(page);
  // The small card shows only the count, so the tap happens in full screen.
  await page.getByRole("button", { name: "Open Habits in full screen" }).click();
  const widget = page.frameLocator(".widget-full iframe");
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
  // The grid's frame got the size of the manifest.
  expect(await page.locator(habitsInGrid).getAttribute("src")).toMatch(/\?size=small$/);
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

/** The demo's stand-in Summary has the size header, so the default puts it in the header slot (#1007). */
const summaryCard = '.widget-card:has(iframe[aria-label="Summary"])';

/** Puts the header slot back to its default, after a test that changed it. */
async function defaultSlot(page: Page): Promise<void> {
  const saved = await page.request.put("/api/widgets/layout", { data: { header: null } });
  expect(saved.ok()).toBe(true);
}

test("the tiles button of the home page scrolls Settings to the Widget layout card and marks it (issue 1002)", async ({
  page,
}) => {
  await logIn(page);
  await page.goto("/#/home");
  await page.getByRole("button", { name: "Arrange the widgets" }).click();
  await expect(page).toHaveURL(/#\/settings\/personalize\/widget-layout$/);
  // The card comes after the widget list loads, so it shows after the first scroll of the page.
  const editor = page.getByRole("region", { name: "Widget layout" });
  await expect(editor).toHaveClass(/\bflash\b/);
  await expect(editor).toBeInViewport();
  // The cards of the page below it fill late too: the card stays at the top.
  await page.waitForTimeout(500);
  await expect(editor).toBeInViewport();
});

test("the widget layout places a widget, leaves a gap, and the home page shows the same places", async ({ page }) => {
  await logIn(page);
  const form = test.info().project.name === "phone" ? "Phone" : "Computer";
  // The tiles button of the home page opens the editor.
  await page.goto("/#/home");
  await page.getByRole("button", { name: "Arrange the widgets" }).click();
  const editor = page.getByRole("region", { name: "Widget layout" });
  await expect(editor).toBeVisible();
  await editor.getByRole("tab", { name: form }).click();
  const preview = editor.getByRole("group", { name: /^Preview of the home page/ });
  const box = (name: string): Locator => preview.getByRole("group", { name: new RegExp(`^${name},`) });
  const place = async (locator: Locator): Promise<string> =>
    locator.evaluate((element) => `${element.style.gridColumn} ${element.style.gridRow}`);
  // The view mode is read only: no box takes the focus, and Reset shows only in the edit mode.
  await expect(box("Habits")).not.toHaveAttribute("tabindex");
  await expect(editor.getByRole("button", { name: "Reset to default" })).toHaveCount(0);
  await editor.getByRole("button", { name: "Edit" }).click();

  // A drag that Escape cancels puts the box back.
  const cases = box("Cases");
  const before = await place(cases);
  const start = await cases.boundingBox();
  if (start === null) throw new Error("Cases has no box.");
  await page.mouse.move(start.x + 20, start.y + 20);
  await page.mouse.down();
  await page.mouse.move(start.x + 20, start.y + start.height + 120, { steps: 8 });
  await page.keyboard.press("Escape");
  await page.mouse.up();
  expect(await place(cases)).toBe(before);

  // The keyboard moves Habits past the other boxes, which leaves a gap, and Shift with an arrow resizes it.
  const habits = box("Habits");
  const status = editor.getByRole("status");
  const keys =
    form === "Computer"
      ? ["ArrowDown", "ArrowLeft", "ArrowLeft", "ArrowLeft", "Shift+ArrowRight", "Shift+ArrowDown"]
      : ["ArrowDown", "Shift+ArrowLeft", "ArrowRight", "Shift+ArrowDown"];
  for (const key of keys) await habits.press(key);
  const [shape, size] = form === "Computer" ? ["2 columns by 2 rows", "large"] : ["1 column by 2 rows", "tall"];
  await expect(status).toHaveText(`Habits is ${shape} now.`);
  await expect(habits).toHaveAccessibleName(new RegExp(`^Habits, ${shape}, at`));
  await expect(habits.locator(".layout-box-size")).toHaveText(form === "Computer" ? "2 × 2" : "1 × 2");
  const previewPlaces = {
    Habits: await place(habits),
    Cases: await place(cases),
    Calendar: await place(box("Calendar")),
  };
  await editor.getByRole("button", { name: "Done" }).click();
  await expect(editor.getByRole("button", { name: "Edit" })).toBeVisible();
  await page.goto("/#/home");
  const grid = page.getByRole("group", { name: "Widgets" });
  // On a phone, the widget of the header slot takes the first row of the home grid (#1007).
  await expect(grid.locator(".widget-card").first()).toBeVisible();
  const below = form === "Phone" && (await grid.locator(summaryCard).count()) > 0 ? 1 : 0;
  const shifted = (spot: string): string =>
    spot.replace(
      /(\d+) \/ span (\d+)$/,
      (_all, row: string, span: string) => `${String(Number(row) + below)} / span ${span}`,
    );
  for (const [name, expected] of Object.entries(previewPlaces))
    expect(await place(grid.locator(`.widget-card:has(iframe[aria-label="${name}"])`))).toBe(shifted(expected));
  // The frame gets the size name of the new shape.
  expect(await grid.locator('iframe[aria-label="Habits"]').getAttribute("src")).toMatch(new RegExp(`\\?size=${size}$`));
  // Put the default back, so the other tests see the grid of the demo.
  await page.goto("/#/settings/personalize/widget-layout");
  await editor.getByRole("tab", { name: form }).click();
  await editor.getByRole("button", { name: "Edit" }).click();
  await editor.getByRole("button", { name: "Reset to default" }).click();
  await expect(editor.getByRole("button", { name: "Reset to default" })).toHaveAttribute("aria-disabled", "true");
  await editor.getByRole("button", { name: "Done" }).click();
  await expect(editor.getByRole("button", { name: "Edit" })).toBeVisible();
});

test("the widget layout keeps the changes of both tabs until Done or Cancel", async ({ page }) => {
  await logIn(page);
  await page.goto("/#/settings/personalize/widget-layout");
  const editor = page.getByRole("region", { name: "Widget layout" });
  const habits = editor.getByRole("group", { name: /^Habits,/ });
  await editor.getByRole("button", { name: "Edit" }).click();
  await habits.press("ArrowDown");
  const moved = await habits.getAttribute("aria-label");
  await editor.getByRole("tab", { name: "Phone" }).click();
  await editor.getByRole("tab", { name: "Computer" }).click();
  await expect(habits).toHaveAccessibleName(moved ?? "");
  await editor.getByRole("button", { name: "Cancel" }).click();
  await expect(habits).not.toHaveAccessibleName(moved ?? "");
  await expect(editor.getByRole("button", { name: "Edit" })).toBeVisible();
});
test("Preview on a clone shows a change that is not pushed, with example data first, then my data", async ({
  page,
}) => {
  await logIn(page);
  await page.getByRole("button", { name: projectsButton }).click();
  await page.getByLabel("Search projects").fill("habits widget");
  await page
    .getByRole("navigation", { name: "Projects" })
    .locator("button.project-card")
    .filter({ hasText: /Habits widget/ })
    .click();
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

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

async function boxOf(locator: Locator): Promise<Box> {
  const box = await locator.boundingBox();
  if (box === null) throw new Error("The element has no box.");
  return box;
}

test("the header slot shows its widget beside the greeting on a computer, and as the first row on a phone (#1007)", async ({
  page,
}) => {
  await logIn(page);
  await defaultSlot(page);
  await page.goto("/#/home");
  const card = page.locator(summaryCard);
  await expect(card.locator("iframe")).toHaveAttribute("src", /\?size=header$/);
  await expect(card.getByRole("button", { name: "Open Summary in full screen" })).toBeVisible();
  const slot = await boxOf(card);
  const greeting = await boxOf(page.locator(".day-greeting h2"));
  if (test.info().project.name === "phone") {
    // No room beside the greeting: the first card of the grid, at the full width, one row.
    await expect(page.locator(".day-greeting").locator(summaryCard)).toHaveCount(0);
    const grid = await boxOf(page.locator(".widget-grid"));
    expect(Math.abs(slot.y - grid.y)).toBeLessThan(2);
    expect(Math.abs(slot.width - grid.width)).toBeLessThan(2);
    expect(slot.height).toBe(168);
    const habits = await boxOf(page.locator('.widget-card:has(iframe[aria-label="Habits"])'));
    expect(habits.y).toBeGreaterThan(slot.y + slot.height);
  } else {
    // At the right of the greeting, in the same row: one line of content, wide and short.
    await expect(page.locator(".day-greeting").locator(summaryCard)).toHaveCount(1);
    expect(slot.x).toBeGreaterThan(greeting.x + greeting.width);
    expect(slot.y).toBeLessThan(greeting.y + greeting.height);
    expect(slot.width).toBeGreaterThanOrEqual(320);
    expect(slot.width).toBeLessThanOrEqual(640);
    expect(slot.height).toBe(72);
    await expect(page.locator(".widget-grid").locator(summaryCard)).toHaveCount(0);
  }
});

test("a narrow window shrinks the header slot, then shows it as the first card of the phone layout (#1007, #1023)", async ({
  page,
}) => {
  test.skip(test.info().project.name === "phone", "The break points are widths of a computer window.");
  // An ordinary day: a special day, such as a full moon, has a longer greeting that takes two lines.
  await page.clock.setFixedTime(new Date("2026-07-15T12:00:00"));
  await logIn(page);
  await defaultSlot(page);
  await page.goto("/#/home");
  const card = page.locator(summaryCard);
  const row = page.locator(".day-greeting");
  const heading = row.locator("h2");
  const placeAt = async (width: number): Promise<{ slot: Box; greeting: Box; row: Box }> => {
    await page.setViewportSize({ width, height: 800 });
    await expect(card).toBeVisible();
    // The greeting stays on one line, and nothing in the row spills out of it.
    expect((await boxOf(heading)).height).toBeLessThan(45);
    expect(await row.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    return { slot: await boxOf(card), greeting: await boxOf(heading), row: await boxOf(row) };
  };
  // Wide: beside the greeting, at its widest.
  const wide = await placeAt(1920);
  expect(wide.slot.y).toBeLessThan(wide.greeting.y + wide.greeting.height);
  expect(wide.slot.width).toBe(640);
  // Narrower: still beside the greeting, and smaller.
  // The home page has no chat list beside it (#1037), so it is the window less the rail.
  const middle = await placeAt(1000);
  expect(middle.slot.y).toBeLessThan(middle.greeting.y + middle.greeting.height);
  expect(middle.slot.width).toBeLessThan(640);
  expect(middle.slot.width).toBeGreaterThanOrEqual(320);
  // No room for both: the panel is too narrow for four columns too, so the phone layout shows the
  // widget as the first card of the grid, below the greeting, at the full width.
  for (const width of [800, 761, 760]) {
    const below = await placeAt(width);
    expect(below.slot.y).toBeGreaterThanOrEqual(below.greeting.y + below.greeting.height);
    expect(Math.abs(below.slot.width - below.row.width)).toBeLessThan(2);
    await expect(page.locator(".widget-grid").locator(summaryCard)).toHaveCount(1);
    await expect(card.locator("iframe")).toHaveAttribute("src", /\?size=header$/);
  }
});

test("the layout editor moves a widget into the header slot and out of it, with the pointer and the keyboard (#1007)", async ({
  page,
}) => {
  test.skip(test.info().project.name === "phone", "The slot sits beside the greeting only on the Computer tab.");
  await logIn(page);
  await defaultSlot(page);
  // Tall enough for the slot and the whole grid, so each drag starts and ends on the screen.
  await page.setViewportSize({ width: 1280, height: 1200 });
  await page.goto("/#/settings/personalize/widget-layout");
  await page.getByRole("region", { name: "Widget layout" }).scrollIntoViewIfNeeded();
  const editor = page.getByRole("region", { name: "Widget layout" });
  const slot = editor.getByRole("group", { name: "Header slot, beside the greeting" });
  const preview = editor.getByRole("group", { name: /^Preview of the home page/ });
  const status = editor.getByRole("status");
  await expect(slot.getByRole("group", { name: "Summary, beside the greeting" })).toBeVisible();
  // The Phone tab shows the widget of the slot as the first row.
  await editor.getByRole("tab", { name: "Phone" }).click();
  await expect(editor.getByRole("group", { name: /^Summary, the first row/ })).toBeVisible();
  await editor.getByRole("tab", { name: "Computer" }).click();
  await editor.getByRole("button", { name: "Edit" }).click();

  // A drag takes Summary out of the slot, to a free cell of the grid.
  const held = await boxOf(slot.getByRole("group", { name: "Summary, beside the greeting" }));
  const grid = await boxOf(preview);
  const cell = { x: grid.x + grid.width * 0.1, y: grid.y + grid.height - 10 };
  await page.mouse.move(held.x + 20, held.y + 10);
  await page.mouse.down();
  await page.mouse.move(cell.x, cell.y, { steps: 8 });
  await page.mouse.up();
  await expect(slot.getByText("Drop a widget here")).toBeVisible();
  await expect(preview.getByRole("group", { name: /^Summary,/ })).toBeVisible();
  await expect(status).toHaveText(/^Summary moved to column 1, row \d+\.$/);

  // Arrow Up from the top row puts Habits in the slot, and the focus follows it.
  const habits = preview.getByRole("group", { name: /^Habits,/ });
  await habits.press("ArrowUp");
  const habitsInSlot = slot.getByRole("group", { name: "Habits, beside the greeting" });
  await expect(habitsInSlot).toBeFocused();
  await expect(status).toHaveText("Habits is beside the greeting now.");
  // Arrow Down takes it back to the grid.
  await habitsInSlot.press("ArrowDown");
  await expect(preview.getByRole("group", { name: /^Habits,/ })).toBeFocused();
  await expect(slot.getByText("Drop a widget here")).toBeVisible();

  // A drag of a box onto the slot puts it there.
  const summary = await boxOf(preview.getByRole("group", { name: /^Summary,/ }));
  const target = await boxOf(slot);
  await page.mouse.move(summary.x + 20, summary.y + 10);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect(slot.getByRole("group", { name: "Summary, beside the greeting" })).toBeVisible();
  await expect(preview.getByRole("group", { name: /^Summary,/ })).toHaveCount(0);

  // Habits to the slot, and Done: the home page shows it there, and Summary in the grid.
  await preview.getByRole("group", { name: /^Habits,/ }).press("ArrowUp");
  await editor.getByRole("button", { name: "Done" }).click();
  await expect(editor.getByRole("button", { name: "Edit" })).toBeVisible();
  await page.goto("/#/home");
  const habitsCard = page.locator(".day-greeting").locator('.widget-card:has(iframe[aria-label="Habits"])');
  await expect(habitsCard.locator("iframe")).toHaveAttribute("src", /\?size=header$/);
  await expect(page.locator(".widget-grid").locator(summaryCard).locator("iframe")).toHaveAttribute(
    "src",
    /\?size=medium$/,
  );
  // Put the demo back: the default places, and Summary in the slot.
  await page.request.put("/api/widgets/layout", { data: { computer: null, header: null } });
});

test("a narrow day panel on a computer uses the phone layout: two columns, and the header widget as the first card (#1023)", async ({
  page,
}) => {
  test.skip(test.info().project.name === "phone", "The phone always has the phone layout.");
  await logIn(page);
  await defaultSlot(page);
  const columns = (): Promise<number> =>
    page.locator(".widget-grid").evaluate((grid) => getComputedStyle(grid).gridTemplateColumns.split(" ").length);
  // The rail and the margins take about 130 px, so a window of 800 px leaves a panel under 680 px.
  await page.setViewportSize({ width: 800, height: 760 });
  await page.goto("/#/home");
  await expect(page.locator(".widget-grid").locator(summaryCard)).toHaveCount(1);
  await expect(page.locator(".day-greeting").locator(summaryCard)).toHaveCount(0);
  await expect(page.locator(".widget-grid").locator(summaryCard).locator("iframe")).toHaveAttribute(
    "src",
    /\?size=header$/,
  );
  expect(await columns()).toBe(2);
  // A wide window keeps the computer layout: four columns, and the slot beside the greeting.
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.locator(".day-greeting").locator(summaryCard)).toHaveCount(1);
  expect(await columns()).toBe(4);
});
