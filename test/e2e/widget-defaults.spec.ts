import { expect, test, type Page } from "@playwright/test";

/**
 * The default place of a folder input in the "Turn on" form (#984). The page talks to the demo
 * server, but a test widget joins the list here: a manifest with three folder defaults. The demo
 * vault has `Life/Habits`, has no `Life/Health/Sleep`, and `.eva/` is closed to widgets.
 */

const widget = {
  id: "example-owner/defaults-widget",
  repository: "https://github.com/example-owner/defaults-widget",
  owner: "example-owner",
  name: "Defaults",
  sources: ["list"],
  state: "off",
  size: "small",
  problems: [],
  update: null,
  checkProblem: null,
};

function folderInput(id: string, label: string, path: string): Record<string, unknown> {
  return {
    id,
    type: "folder",
    label,
    description: `The folder of the ${id}.`,
    why: "The widget shows them.",
    required: id === "habits",
    access: "read",
    files: "*.json",
    default: path,
  };
}

const review = {
  id: widget.id,
  repository: widget.repository,
  owner: widget.owner,
  commit: "0123456789abcdef0123456789abcdef01234567",
  manifest: {
    contract: 1,
    name: "Defaults",
    entry: "index.html",
    size: "small",
    inputs: [
      folderInput("habits", "Habits folder", "Life/Habits"),
      folderInput("sleep", "Sleep folder", "Life/Health/Sleep"),
      folderInput("secret", "Closed folder", ".eva/data"),
    ],
    hosts: [],
  },
  problems: [],
  values: {},
  installed: null,
  added: null,
};

async function openTurnOn(page: Page): Promise<{ created: string[] }> {
  const created: string[] = [];
  for (const address of ["**/api/widgets", "**/api/widgets/check"]) {
    await page.route(address, async (route) => {
      const response = await route.fetch();
      const items = (await response.json()) as unknown[];
      await route.fulfill({ response, json: [...items, widget] });
    });
  }
  await page.route(`**/api/widgets/${widget.id}/review`, (route) => route.fulfill({ json: review }));
  // A widget with no approval on this computer: "Turn on" opens the form.
  await page.route(`**/api/widgets/${widget.id}/enabled`, (route) =>
    route.fulfill({ status: 409, json: { error: "Approve it first.", code: "widget_needs_approval" } }),
  );
  // The real core creates the folder; here the demo vault stays as it is for the other tests.
  await page.route("**/api/widgets/folders", async (route) => {
    created.push((route.request().postDataJSON() as { path: string }).path);
    await new Promise((resolve) => setTimeout(resolve, 300));
    await route.fulfill({ status: 201, json: { path: created.at(-1) } });
  });
  await page.goto("/");
  await page.getByLabel(/Token/).fill("e2e-demo-token");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
  await page.goto("/#/settings/personalize/widgets");
  const item = page.getByRole("list", { name: "Widgets" }).locator("li").filter({ hasText: "Defaults" });
  await item.getByRole("button", { name: "Turn on" }).click();
  await expect(page.getByRole("dialog", { name: "Turn on Defaults" })).toBeVisible();
  return { created };
}

function field(page: Page, label: string): ReturnType<Page["locator"]> {
  return page.getByRole("dialog", { name: "Turn on Defaults" }).locator(".field").filter({ hasText: label });
}

test("a folder default that exists is one tap away, a missing one is created only after the tap, and a closed one has no button", async ({
  page,
}) => {
  const { created } = await openTurnOn(page);
  const habits = field(page, "Habits folder (required)");
  await expect(habits.locator(".widget-picked")).toHaveText("Nothing picked");
  const use = habits.getByRole("button", { name: "Use the default folder" });
  await expect(use).toHaveAttribute("data-tooltip", "Picks the folder Life/Habits");
  // A phone has no hover: the path shows as text too.
  await expect(habits).toContainText("Default folder: Life/Habits");
  await expect(habits.getByRole("button", { name: "Pick a folder" })).toBeVisible();
  await use.click();
  await expect(habits.locator(".widget-picked")).toHaveText("Life/Habits");
  await expect(use).toHaveCount(0);
  await expect(page.getByRole("dialog")).toContainText("Reads the folder Life/Habits");

  const sleep = field(page, "Sleep folder");
  const create = sleep.getByRole("button", { name: "Create the default folder" });
  await expect(create).toHaveAttribute(
    "data-tooltip",
    "Creates the folder Life/Health/Sleep in your vault and picks it",
  );
  await expect(sleep).toContainText("Default folder: Life/Health/Sleep");
  expect(created).toEqual([]);
  await create.click();
  await expect(sleep.locator(".widget-picked")).toHaveText("Life/Health/Sleep");
  expect(created).toEqual(["Life/Health/Sleep"]);

  const closed = field(page, "Closed folder");
  await expect(closed.getByRole("button", { name: "Pick a folder" })).toBeVisible();
  await expect(closed.getByRole("button", { name: /default folder/ })).toHaveCount(0);
  await expect(closed).not.toContainText("Default folder");
});

test("on a phone the default buttons fit the sheet with no side scroll", async ({ page }) => {
  await openTurnOn(page);
  const dialog = page.getByRole("dialog", { name: "Turn on Defaults" });
  for (const name of ["Use the default folder", "Create the default folder"]) {
    const box = await dialog.getByRole("button", { name }).boundingBox();
    const viewport = page.viewportSize();
    expect(box).not.toBeNull();
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(viewport?.width ?? 0);
  }
  const overflow = await dialog.evaluate((element) => element.scrollWidth > element.clientWidth);
  expect(overflow).toBe(false);
});
