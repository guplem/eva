import { expect, test, type Page } from "@playwright/test";

const token = "e2e-demo-token";

async function logIn(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByLabel(/Token/).fill(token);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("group", { name: "Mode" })).toBeVisible();
}

async function openList(page: Page): Promise<void> {
  const menu = page.getByRole("button", { name: "Show the list" });
  if (await menu.isVisible()) await menu.click();
}

test("a wrong token is refused, and the page asks again", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel(/Token/).fill("wrong");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("alert")).toHaveText("This token is not valid.");
});

test("Assistant mode: a chat, its answer, a retry branch and the background tasks", async ({ page }) => {
  await logIn(page);
  await openList(page);
  await page.getByRole("button", { name: "New chat", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("New chat");
  const composer = page.getByLabel("Message").first();
  await composer.fill("Hello Eva");
  await composer.press("Enter");
  await expect(page.locator(".message.answer").first()).toContainText(/Echo \d+: Hello Eva/);
  await expect(page.getByText("1 tools").first()).toBeVisible();

  await page.getByRole("button", { name: "Retry" }).first().click();
  await expect(page.locator(".branch")).toHaveCount(2);
  await expect(page.getByText(/Branch after answer/)).toBeVisible();
});

test("an approval opens a dialog, and Allow answers the turn", async ({ page }) => {
  await logIn(page);
  await openList(page);
  await page.getByRole("button", { name: "New chat", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("New chat");
  const composer = page.getByLabel("Message").first();
  await composer.fill("please approve this");
  await composer.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Approval" });
  await expect(dialog).toContainText("gh issue create");
  await dialog.getByRole("button", { name: "Allow" }).click();
  await expect(page.locator(".message.answer").first()).toContainText("The person answered: allow");
});

test("Project mode: search, a new clone with its branch, and a chat in it", async ({ page }) => {
  await logIn(page);
  await page.getByRole("button", { name: "Project" }).click();
  await openList(page);
  await page.getByLabel("Search projects").fill("example");
  await page.getByRole("button", { name: /Example app/ }).click();
  await page.getByRole("button", { name: "New clone" }).click();
  await expect(page.getByRole("heading", { name: /Example app · remote-\d+/ })).toBeVisible();
  await expect(page.locator(".badge", { hasText: "main" })).toBeVisible();
  await page.getByRole("button", { name: "Start a chat in this clone" }).click();
  const composer = page.getByLabel("Message").first();
  await composer.fill("Fix the bug");
  await composer.press("Enter");
  // The first chat in a clone of an unknown repository asks for trust (plan §12). Both screen
  // sizes share one demo server, so only the first of them sees the question.
  const answer = page.locator(".message.answer").first();
  const trustQuestion = page.getByRole("dialog", { name: "Approval" });
  await Promise.race([answer.waitFor(), trustQuestion.waitFor()]);
  if (await trustQuestion.isVisible()) {
    await expect(trustQuestion).toContainText("Trust this repository");
    await trustQuestion.getByRole("button", { name: "Deny" }).click();
  }
  await expect(answer).toContainText("Fix the bug");
});

test("the status filter hides a closed project until Any status", async ({ page }) => {
  await logIn(page);
  await page.getByRole("button", { name: "Project" }).click();
  await openList(page);
  await expect(page.getByRole("button", { name: /Old tool/ })).toHaveCount(0);
  await page.getByLabel("Status").selectOption("");
  await expect(page.getByRole("button", { name: /Old tool/ })).toBeVisible();
});

test("Settings: the vault Test button checks the remote, and Log out ends the session", async ({ page }) => {
  await logIn(page);
  await page.getByRole("button", { name: "Settings" }).click();
  const vaultRow = page.locator(".check-row", { hasText: "Vault repository" });
  await vaultRow.getByRole("button", { name: "Test" }).click();
  await expect(vaultRow).toContainText("✓");
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page.getByRole("button", { name: "Log in" })).toBeVisible();
});

test("Settings: add a schedule, see its next run, and remove it (plan §9)", async ({ page }, testInfo) => {
  const id = `walk-${testInfo.project.name.replace(/\W+/g, "-").toLowerCase()}`;
  await logIn(page);
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByLabel(/^Id/).fill(id);
  await page.getByLabel("Name").fill(`Walk ${id}`);
  await page.getByLabel("Time (HH:MM)").fill("7:30");
  await page.getByLabel("Fixed text").fill("Go for a walk.");
  await page.getByRole("button", { name: "Add schedule" }).click();
  await expect(page.getByRole("status").last()).toContainText("no valid time");
  await page.getByLabel("Time (HH:MM)").fill("07:30");
  await page.getByRole("button", { name: "Add schedule" }).click();
  const row = page.locator(".check-row", { hasText: `Walk ${id}` });
  await expect(row).toContainText("next:");
  await row.getByRole("button", { name: `Remove Walk ${id}` }).click();
  await expect(row).toHaveCount(0);
});
