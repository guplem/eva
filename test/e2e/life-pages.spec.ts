import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * The Life pages (#911): a page for the cases, people, objects, pets and periods of the demo vault
 * (`serve-demo.ts`). Each test runs on a computer and on a phone.
 */

// A route handler can still run as its test ends, and its error then fails the next test.
test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

async function logIn(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByLabel(/Token/).fill("e2e-demo-token");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
}

/** Opens a Life page by its address, as a link or a typed address does. */
async function open(page: Page, address: string, title: string): Promise<void> {
  await page.goto(`/${address}`);
  await expect(page.getByRole("heading", { level: 1, name: title, exact: true })).toBeVisible();
}

function card(page: Page, name: string | RegExp): Locator {
  // By the title, as another card can name the same person in its relation.
  return page.locator(".life-card").filter({ has: page.locator(".life-card-title").getByText(name, { exact: true }) });
}

test.beforeEach(async ({ page }) => {
  await logIn(page);
});

test("the Cases page tells open cases from closed ones, with the current step, its day, the wait, the progress and the deadline", async ({
  page,
}) => {
  await open(page, "#/cases", "Cases");
  await expect(page.locator(".main-header .sub")).toHaveText("3 open · 1 closed");
  const bumper = card(page, "Bumper claim");
  await expect(bumper).toContainText("Get the insurer's answer");
  await expect(bumper).toContainText("Waits for Example Insurance");
  await expect(bumper).toContainText("1 of 3 steps done");
  await expect(bumper).toContainText("Due 15 Jan 2099");
  await expect(bumper).toContainText("Deadline 1 Feb 2099");
  // A late step says so in words, not only in colour.
  await expect(card(page, "Gym refund")).toContainText(/Overdue by \d+ days/);
  await expect(card(page, "Flat move")).toHaveCount(0);

  const show = page.getByRole("group", { name: "Show" });
  await show.getByRole("button", { name: "Closed" }).click();
  await expect(card(page, "Flat move")).toContainText("Closed on 30 Apr 2025");
  await expect(card(page, "Bumper claim")).toHaveCount(0);

  await show.getByRole("button", { name: "All" }).click();
  await expect(page.getByRole("heading", { level: 2, name: /^Open/ })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: /^Closed/ })).toBeVisible();
  await expect(page.locator(".life-card")).toHaveCount(4);
});

test("the search filters a list by name, alias and summary, and says when nothing matches", async ({ page }) => {
  await open(page, "#/cases", "Cases");
  const search = page.getByRole("searchbox", { name: "Search cases" });
  // "the bumper claim" is an alias.
  await search.fill("THE BUMPER");
  await expect(page.locator(".life-card")).toHaveCount(1);
  await expect(card(page, "Bumper claim")).toBeVisible();
  await search.fill("backup is done");
  await expect(card(page, "Phone repair")).toBeVisible();
  await expect(page.locator(".life-card")).toHaveCount(1);
  await search.fill("no such words here");
  await expect(page.getByRole("status").filter({ hasText: "Nothing matches" })).toBeVisible();

  await open(page, "#/people", "People");
  await page.getByRole("searchbox", { name: "Search people" }).fill("Al");
  await expect(card(page, "Alex Example")).toBeVisible();
});

test("the People, Objects, Pets and Periods pages show the facts of each kind", async ({ page }) => {
  await open(page, "#/people", "People");
  await expect(card(page, "Sam Example")).toContainText("sister of Alex Example");
  await expect(card(page, "Jordan Example")).toContainText("colleague at Example Corp");

  await open(page, "#/objects", "Objects");
  await expect(page.getByRole("heading", { level: 2, name: /^Car/ })).toBeVisible();
  await expect(card(page, "Example Model")).toContainText("In use");
  await expect(card(page, "Example Model")).toContainText("Plate 1234ABC");
  await expect(card(page, "Example Tools")).toContainText("Lent");
  await expect(card(page, "Example Tools")).toContainText("Owner: Sam Example");
  await expect(card(page, "Example Phone 12")).toHaveCount(0);
  await page.getByRole("group", { name: "Show" }).getByRole("button", { name: "Gone" }).click();
  await expect(card(page, "Example Phone 12")).toContainText("Sold");

  await open(page, "#/pets", "Pets");
  await expect(card(page, "Luna")).toContainText("Dog · Border collie");
  await expect(card(page, "Luna")).toContainText(/\d+ years old/);
  await expect(card(page, "Milo")).toContainText("Died");
  await expect(card(page, "Milo")).toContainText("Lived about 16 years");

  await open(page, "#/periods", "Periods");
  const job = card(page, "Example corp engineer");
  await expect(job).toContainText("Sep 2024 to now");
  await expect(job).toContainText("Going on");
  const study = card(page, "Example university study");
  await expect(study).toContainText("Sep 2019 to Jun 2023");
  await expect(study).not.toContainText("Going on");
});

test("an entity with a bad main file shows with a warning, and the others show too", async ({ page }) => {
  await open(page, "#/pets", "Pets");
  await expect(page.locator(".life-card")).toHaveCount(3);
  await expect(card(page, "Pebble")).toContainText("1 warning");
  await card(page, "Pebble").click();
  await expect(page.getByRole("heading", { level: 1, name: "Pebble" })).toBeVisible();
  await expect(page.getByRole("note")).toContainText("The front matter is not a valid list of keys.");
  await expect(page.getByRole("region", { name: "Notes" })).toContainText("Swims in slow circles.");
});

test("a case opens its own page with its facts, steps, text and files, and Back returns to the list", async ({
  page,
}) => {
  await open(page, "#/cases", "Cases");
  await card(page, "Phone repair").click();
  await expect(page).toHaveURL(/#\/cases\/2026-05-15-phone-repair$/);
  await expect(page.getByRole("heading", { level: 1, name: "Phone repair" })).toBeVisible();
  const facts = page.getByRole("region", { name: "Facts" });
  await expect(facts).toContainText("The screen of the phone broke.");
  await expect(facts.getByRole("link", { name: "Open in Files" })).toHaveAttribute(
    "href",
    "#/files/Life/Cases/2026-05-15-phone-repair",
  );
  const steps = page.getByRole("region", { name: "Steps" });
  await expect(steps.locator(".life-step.done")).toContainText("Back up the phone");
  await expect(steps.locator(".life-step.current")).toContainText("Take the phone to the repair shop");
  await expect(steps.locator(".life-step.todo")).toContainText("Collect the phone and the invoice");
  // The heading of the text is the title of the page, so the text does not repeat it.
  await expect(page.getByRole("region", { name: "Notes" })).toContainText("The screen broke.");

  await page.getByRole("button", { name: "Back to cases" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Cases", exact: true })).toBeVisible();
  await expect(page).toHaveURL(/#\/cases$/);

  await card(page, "Phone repair").click();
  await page.getByRole("region", { name: "Files" }).getByRole("link", { name: "Repair quote.md" }).click();
  await expect(page).toHaveURL(/#\/files\/Life\/Cases\/2026-05-15-phone-repair\/Repair%20quote\.md$/);
  await expect(page.getByText("A new screen costs 120 euros.")).toBeVisible();
});

test("a path of another entity links to its page, in the text and in the facts", async ({ page }) => {
  await open(page, "#/cases/2026-09-01-bumper-claim", "Bumper claim");
  await page
    .getByRole("region", { name: "Notes" })
    .getByRole("link", { name: "Car - Example Model - 1234ABC" })
    .click();
  await expect(page.getByRole("heading", { level: 1, name: "Car - Example Model - 1234ABC" })).toBeVisible();

  await open(page, "#/people/Sam%20Example", "Sam Example");
  await page.getByRole("region", { name: "Facts" }).getByRole("link", { name: "Alex Example" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Alex Example" })).toBeVisible();
});

test("a page with no entry in the navigation opens by its address", async ({ page }) => {
  const nav = page.getByRole("navigation", { name: "Main" });
  if (test.info().project.name === "phone") {
    // A phone shows Chats, Projects, Files and Schedules by default.
    await expect(nav.getByRole("button", { name: "Periods" })).toHaveCount(0);
  } else {
    await nav.getByRole("button", { name: "Periods" }).click();
    await expect(page).toHaveURL(/#\/periods$/);
  }
  await open(page, "#/periods", "Periods");
  await expect(card(page, "Sabbatical")).toBeVisible();
});

test("a missing entity and an empty folder each show a clear state", async ({ page }) => {
  await open(page, "#/people/Nobody%20Here", "Not found");
  await expect(page.getByText("Eva cannot find “Nobody Here”.")).toBeVisible();
  await page.locator(".life-missing").getByRole("button", { name: "Back to People" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "People", exact: true })).toBeVisible();

  // A vault without the folder answers with an empty list.
  await page.route("**/api/life/pets", (route) => route.fulfill({ json: [] }));
  await open(page, "#/pets", "Pets");
  await expect(page.getByText("No pets yet.")).toBeVisible();
  await expect(page.getByText(/Ask Eva to add one/)).toBeVisible();
  await expect(page.getByRole("searchbox")).toHaveCount(0);
});
