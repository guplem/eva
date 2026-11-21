import { expect, test } from "@playwright/test";

/**
 * The settings of an on widget (#1022). The page talks to the demo server, but a test widget joins
 * the list here: it is on, and its newest commit is the installed one. The routes record the save,
 * so the demo's own widgets stay as they are for the other tests.
 */

const commit = "0123456789abcdef0123456789abcdef01234567";

const widget = {
  id: "example-owner/settings-widget",
  repository: "https://github.com/example-owner/settings-widget",
  owner: "example-owner",
  name: "Agenda",
  sources: ["list"],
  state: "on",
  size: "small",
  layout: {},
  problems: [],
  update: null,
  checkProblem: null,
};

const review = {
  id: widget.id,
  repository: widget.repository,
  owner: widget.owner,
  commit,
  manifest: {
    contract: 1,
    name: "Agenda",
    entry: "index.html",
    size: "small",
    inputs: [
      {
        id: "hideTitles",
        type: "text",
        label: "Hide events whose title matches",
        description: "A regular expression.",
        why: "The widget leaves out repeated events.",
        required: false,
        default: "",
      },
    ],
    hosts: [],
  },
  problems: [],
  values: { hideTitles: "standup" },
  installed: commit,
  added: [],
};

test("Settings of an on widget opens its form with the saved values, and Save keeps the version", async ({ page }) => {
  const saved: unknown[] = [];
  for (const address of ["**/api/widgets", "**/api/widgets/check"]) {
    await page.route(address, async (route) => {
      const response = await route.fetch();
      const items = (await response.json()) as unknown[];
      await route.fulfill({ response, json: [...items, widget] });
    });
  }
  await page.route(`**/api/widgets/${widget.id}/review`, (route) => route.fulfill({ json: review }));
  await page.route(`**/api/widgets/${widget.id}/approve`, async (route) => {
    saved.push(route.request().postDataJSON());
    await route.fulfill({ json: [widget] });
  });
  await page.goto("/");
  await page.getByLabel(/Token/).fill("e2e-demo-token");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
  await page.goto("/#/settings/personalize/widgets");
  const item = page.getByRole("list", { name: "Widgets" }).locator("li").filter({ hasText: "Agenda" });
  await item.getByRole("button", { name: "Settings" }).click();
  const dialog = page.getByRole("dialog", { name: "Settings of Agenda" });
  const field = dialog.getByLabel("Hide events whose title matches");
  await expect(field).toHaveValue("standup");
  await field.fill("standup|focus time");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toBeHidden();
  expect(saved).toEqual([{ commit, values: { hideTitles: "standup|focus time" } }]);
  await expect(page.getByText("Saved the settings of Agenda.")).toBeVisible();
});
