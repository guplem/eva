import { expect, test, type Page, type WebSocketRoute } from "@playwright/test";

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

/** The task chip under the answer opens the chat's background tasks, also on a phone. */
async function expectBackgroundTasks(page: Page): Promise<void> {
  if (test.info().project.name === "desktop") {
    await expect(page.getByRole("complementary", { name: "Background tasks" })).toContainText("Search the notes");
  }
  await page.getByRole("button", { name: "1 background task", exact: true }).first().click();
  const dialog = page.getByRole("dialog", { name: "Background tasks" });
  await expect(dialog).toContainText("Search the notes");
  await expect(dialog).toContainText("done");
  await expect(dialog.getByRole("button", { name: "Close" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
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
  await page.getByLabel("Model for a new chat").selectOption("haiku");
  await page.getByRole("button", { name: "New chat", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("New chat");
  // The model comes first, and the chat keeps it (lesson 41).
  await expect(page.locator(".main-header .badge")).toHaveText("haiku");
  const composer = page.getByLabel("Message").first();
  await composer.fill("Hello Eva");
  await composer.press("Enter");
  await expect(page.locator(".message.answer").first()).toContainText(/Echo \d+: Hello Eva/);
  await expect(page.getByText("1 command, 1 tool").first()).toBeVisible();
  await expectBackgroundTasks(page);

  await page.getByRole("button", { name: "Retry" }).first().click();
  await expect(page.locator(".branch")).toHaveCount(2);
  await expect(page.getByText(/Branch after answer/)).toBeVisible();
});

test("an answer keeps its line breaks, lists and paragraphs", async ({ page }) => {
  await logIn(page);
  await openList(page);
  await page.getByRole("button", { name: "New chat", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("New chat");
  const composer = page.getByLabel("Message").first();
  await composer.fill("show me a list");
  await composer.press("Enter");
  const answer = page.locator(".message.answer").first();
  await expect(answer.locator("li")).toHaveText(["first", "second"]);
  await expect(answer.locator("p")).toHaveText(["Two steps:", "Done."]);
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
  // While the turn waits, its running task shows under the conversation, also on a phone.
  await expect(page.getByRole("button", { name: "1 background task running" })).toBeVisible();
  await dialog.getByRole("button", { name: "Allow" }).click();
  await expect(page.locator(".message.answer").first()).toContainText("The person answered: allow");
});

test("a new schedule's setup card waits in a dialog, and Got it lets it run (lesson 66)", async ({ page }, info) => {
  await logIn(page);
  const id = `card-${info.project.name}`;
  const created = await page.request.post("/api/schedules", {
    data: { id, name: `Card ${info.project.name}`, at: "07:30", text: "Drink water." },
  });
  expect(created.status()).toBe(201);
  const dialog = page.getByRole("dialog", { name: "Setup card" });
  await expect(dialog).toContainText(`New schedule: Card ${info.project.name}`);
  await expect(dialog).toContainText("Drink water.");
  await dialog.getByRole("button", { name: "Got it" }).click();
  await expect(dialog).toHaveCount(0);
  const waiting = (await (await page.request.get("/api/schedule-cards")).json()) as { scheduleId: string }[];
  expect(waiting.map((card) => card.scheduleId)).not.toContain(id);
  await page.request.delete(`/api/schedules/${id}`);
});

test("a setup card's Remove button removes the schedule", async ({ page }, info) => {
  await logIn(page);
  const id = `unknown-${info.project.name}`;
  await page.request.post("/api/schedules", { data: { id, name: "Pushed by someone", at: "07:30", text: "Hi." } });
  const dialog = page.getByRole("dialog", { name: "Setup card" });
  await expect(dialog).toContainText("New schedule: Pushed by someone");
  page.once("dialog", (question) => void question.accept());
  await dialog.getByRole("button", { name: "Remove schedule" }).click();
  await expect(dialog).toHaveCount(0);
  const listed = (await (await page.request.get("/api/schedules")).json()) as {
    schedules: { schedule: { id: string } }[];
  };
  expect(listed.schedules.map((view) => view.schedule.id)).not.toContain(id);
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
  // The first chat in a clone of an unknown repository asks for trust. Both screen
  // sizes share one demo server, so only the first of them sees the question.
  const answer = page.locator(".message.answer").first();
  const trustQuestion = page.getByRole("dialog", { name: "Approval" });
  await Promise.race([answer.waitFor(), trustQuestion.waitFor()]);
  if (await trustQuestion.isVisible()) {
    await expect(trustQuestion).toContainText("Trust this repository");
    await trustQuestion.getByRole("button", { name: "Deny" }).click();
  }
  await expect(answer).toContainText("Fix the bug");
  // Project mode shows the same activity as Assistant mode.
  await expect(page.getByText("1 command, 1 tool").first()).toBeVisible();
  await expectBackgroundTasks(page);

  // Another chat's tasks stay out of view. A project chat keeps the Assistant chat list unchanged.
  await openList(page);
  await page.getByRole("group", { name: "Chats in this clone" }).getByRole("button", { name: "New chat" }).click();
  if (test.info().project.name === "desktop") {
    await expect(page.getByRole("complementary", { name: "Background tasks" })).toContainText(
      "Nothing runs in the background.",
    );
  }
});

test("a clone lists all its chats, and a new chat starts in a clone that has one", async ({ page }) => {
  await logIn(page);
  await page.getByRole("button", { name: "Project" }).click();
  await openList(page);
  await page.getByLabel("Search projects").fill("example");
  await page.getByRole("button", { name: /Example app/ }).click();
  await page.getByRole("button", { name: "New clone" }).click();
  await page.getByRole("button", { name: "Start a chat in this clone" }).click();
  await openList(page);
  const chats = page.getByRole("group", { name: "Chats in this clone" });
  await expect(chats.locator(".list-item")).toHaveCount(1);
  await chats.getByRole("button", { name: "New chat", exact: true }).click();
  await openList(page);
  await expect(chats.locator(".list-item")).toHaveCount(2);
  await expect(chats.locator(".list-item").first()).toHaveAttribute("aria-current", "true");
  await chats.locator(".list-item").last().click();
  await openList(page);
  await expect(chats.locator(".list-item").last()).toHaveAttribute("aria-current", "true");
});

test("Project mode: the repository setup shows each item's light and copies its fix", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await logIn(page);
  await page.getByRole("button", { name: "Project" }).click();
  await openList(page);
  await page.getByRole("button", { name: /Example app/ }).click();
  await page.getByRole("button", { name: "Repository setup" }).click();
  await expect(page.getByRole("heading", { name: "Example app · Repository setup" })).toBeVisible();
  // The local remote is not on GitHub, so its report only says why.
  await expect(page.getByText("Only a repository on GitHub has a setup report.")).toBeVisible();
  const report = page.getByRole("group", { name: "example-owner/example-app" });
  const skill = report.locator(".setup-item", { hasText: "Skill write-commit" });
  await expect(skill.getByRole("img", { name: "Missing" })).toBeVisible();
  await skill.getByRole("button", { name: "Copy the fix for Skill write-commit" }).click();
  await expect(skill.getByRole("button", { name: "Copied" })).toHaveText("Copied");
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain("In example-owner/example-app, add the skill `write-commit`");
  await report.getByRole("button", { name: /Copy all fixes/ }).click();
  const all = await page.evaluate(() => navigator.clipboard.readText());
  expect(all).toContain("Open one pull request for all the file changes.");
  expect(all).toContain("allow_auto_merge=true");
  await expect(
    report.locator(".setup-item", { hasText: "Malware alerts" }).getByRole("img", { name: "Not checked" }),
  ).toBeVisible();
});

test("the status filter hides a closed project until Any status", async ({ page }) => {
  await logIn(page);
  await page.getByRole("button", { name: "Project" }).click();
  await openList(page);
  await expect(page.getByRole("button", { name: /Old tool/ })).toHaveCount(0);
  await page.getByLabel("Status").selectOption("");
  await expect(page.getByRole("button", { name: /Old tool/ })).toBeVisible();
  // A status word typed in the search wins over the select.
  await page.getByLabel("Status").selectOption("active");
  await page.getByLabel("Search projects").fill("status:closed");
  await expect(page.getByRole("button", { name: /Old tool/ })).toBeVisible();
});

test("the tag filter shows only the projects with that tag", async ({ page }) => {
  await logIn(page);
  await page.getByRole("button", { name: "Project" }).click();
  await openList(page);
  await page.getByLabel("Status").selectOption("");
  await expect(page.getByRole("button", { name: /Old tool/ })).toBeVisible();
  await page.getByLabel("Tag").selectOption("web");
  await expect(page.getByRole("button", { name: /Example app/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Old tool/ })).toHaveCount(0);
  await page.getByLabel("Tag").selectOption("");
  await expect(page.getByRole("button", { name: /Old tool/ })).toBeVisible();
  // A tag word typed in the search wins over the select.
  await page.getByLabel("Tag").selectOption("web");
  await page.getByLabel("Search projects").fill("#legacy");
  await expect(page.getByRole("button", { name: /Old tool/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Example app/ })).toHaveCount(0);
});

test("a project with a bad front matter field shows its warnings", async ({ page }) => {
  await logIn(page);
  await page.getByRole("button", { name: "Project" }).click();
  await openList(page);
  const project = page.getByRole("button", { name: /Broken notes/ });
  await expect(project).toContainText("1 warning");
  await project.click();
  await expect(page.getByRole("list", { name: "Warnings of Broken notes" })).toHaveText("repos must be a list of URLs");
});

test("Settings: the vault Test button checks the remote, and Log out ends the session", async ({ page }) => {
  await logIn(page);
  await page.getByRole("button", { name: "Settings" }).click();
  const vaultRow = page.locator(".check-row", { hasText: "Vault repository" });
  await vaultRow.getByRole("button", { name: "Test" }).click();
  await expect(vaultRow).toContainText("✓");
  await page.getByRole("button", { name: "Log out", exact: true }).click();
  await expect(page.getByRole("button", { name: "Log in" })).toBeVisible();
});

test("Settings: Log out every device ends this login too", async ({ page }) => {
  await logIn(page);
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Log out every device" }).click();
  await expect(page.getByRole("button", { name: "Log in" })).toBeVisible();
});

test("Settings: a token saves write-only, shows as saved, and can be removed", async ({ page }) => {
  await logIn(page);
  // A failed earlier run must not leave a token for this one.
  await page.request.delete("/api/secrets/githubToken");
  await page.getByRole("button", { name: "Settings" }).click();
  const field = page.getByLabel("GitHub token", { exact: true });
  await expect(page.getByText("No GitHub token is saved.")).toBeVisible();
  await field.fill("ghp_e2e-example-token");
  await page.getByRole("button", { name: "Save the GitHub token" }).click();
  await expect(page.getByText("A GitHub token is saved.")).toBeVisible();
  await expect(field).toHaveValue("");
  await expect(page.getByRole("status").filter({ hasText: "Restart Eva" })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByText("A GitHub token is saved.")).toBeVisible();
  expect(await page.content()).not.toContain("e2e-example-token");
  page.once("dialog", (dialog) => {
    void dialog.accept();
  });
  await page.getByRole("button", { name: "Remove the GitHub token" }).click();
  await expect(page.getByText("No GitHub token is saved.")).toBeVisible();
});

test("Settings: each engine has a Test that runs a tiny real prompt", async ({ page }) => {
  await logIn(page);
  await page.getByRole("button", { name: "Settings" }).click();
  const claudeRow = page.locator(".check-row", { hasText: "Test the Claude Code token" });
  await claudeRow.getByRole("button", { name: "Test" }).click();
  await expect(claudeRow).toContainText("✓ Claude Code answered:");
  const piRow = page.locator(".check-row", { hasText: "Test pi" });
  await piRow.getByRole("button", { name: "Test" }).click();
  // The demo server has only the scripted Claude Code engine.
  await expect(piRow).toContainText("✗ Eva did not find pi on this machine.");
  await expect(page.getByText("Telegram is not set up: save a bot token, then restart Eva.")).toBeVisible();
  await expect(page.getByText("Only the Tailscale account that owns this machine.")).toBeVisible();
});

test("Settings: the default model saves at once", async ({ page }) => {
  await logIn(page);
  try {
    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByLabel("Claude Code model").selectOption("sonnet");
    await expect(page.getByRole("status").filter({ hasText: "Saved." })).toBeVisible();
    await page.reload();
    await page.getByRole("button", { name: "Settings" }).click();
    await expect(page.getByLabel("Claude Code model")).toHaveValue("sonnet");
  } finally {
    // Later tests share the demo vault.
    await page.request.put("/api/settings", { data: { engines: { claudeCode: { defaultModel: "default" } } } });
  }
});

test("Settings: the vault sync state shows a conflict and the held-back files", async ({ page }) => {
  await page.route("**/api/status", async (route) => {
    const response = await route.fetch();
    const status = (await response.json()) as { vaultSync: Record<string, unknown> };
    status.vaultSync = {
      ...status.vaultSync,
      status: "conflict",
      lastError: "Notes/plan.md has a conflict.",
      withheldFiles: [
        { path: "Notes/keys.md", reason: "secret" },
        { path: "Media/film.mov", reason: "too_large" },
      ],
    };
    await route.fulfill({ response, json: status });
  });
  await logIn(page);
  await page.getByRole("button", { name: "Settings" }).click();
  const sync = page.getByRole("region", { name: "Vault sync" });
  await expect(sync).toContainText("Conflict: Notes/plan.md has a conflict.");
  await expect(sync).toContainText("Notes/keys.md (looks like a secret)");
  await expect(sync).toContainText("Media/film.mov (larger than 50 MB)");
});

test("Settings: the theme and the density apply at once and stay in this browser", async ({ page }) => {
  await logIn(page);
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByLabel("Theme").selectOption("dark");
  await page.getByLabel("Density").selectOption("compact");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("html")).toHaveAttribute("data-density", "compact");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("html")).toHaveAttribute("data-density", "compact");
});

test("device login: a browser that Tailscale names waits for Allow in Telegram, then opens", async ({
  page,
  context,
  baseURL,
}) => {
  let polls = 0;
  // The demo server has no Tailscale, so the browser plays the server's side of the device login.
  await page.route("**/api/login/device", (route) =>
    route.fulfill({
      status: 201,
      json: { id: "request-1", code: "K7QX", account: "owner@example.com", expiresAt: "2099-01-01T00:00:00.000Z" },
    }),
  );
  await page.route("**/api/login/device/request-1", async (route) => {
    polls += 1;
    if (polls < 2) {
      await route.fulfill({ json: { state: "pending" } });
      return;
    }
    // The real server sets the device cookie here; the demo login cookie stands in for it.
    await context.addCookies([{ name: "eva_token", value: token, url: baseURL ?? "" }]);
    await route.fulfill({ json: { state: "allowed" } });
  });
  await page.goto("/");
  await expect(page.getByText("Confirm this device in Telegram")).toBeVisible();
  await expect(page.getByText("K7QX")).toBeVisible();
  await expect(page.getByRole("group", { name: "Mode" })).toBeVisible();
});

test("device login: without a Telegram bot, the page says why and asks for the token", async ({ page }) => {
  await page.route("**/api/login/device", (route) =>
    route.fulfill({ status: 409, json: { error: "This machine runs no Telegram bot that can confirm a new device." } }),
  );
  await page.goto("/");
  await expect(page.getByRole("status")).toHaveText("This machine runs no Telegram bot that can confirm a new device.");
  await expect(page.getByLabel(/Token/)).toBeVisible();
});

test("device login: a denied request offers to ask again", async ({ page }) => {
  await page.route("**/api/login/device", (route) =>
    route.fulfill({
      status: 201,
      json: { id: "request-2", code: "M3PT", account: "owner@example.com", expiresAt: "2099-01-01T00:00:00.000Z" },
    }),
  );
  await page.route("**/api/login/device/request-2", (route) => route.fulfill({ json: { state: "denied" } }));
  await page.goto("/");
  await expect(page.getByRole("status")).toHaveText("The request was denied in Telegram.");
  await expect(page.getByRole("button", { name: "Ask in Telegram again" })).toBeVisible();
});

test("Settings: no schedule form, because schedules have their own page", async ({ page }) => {
  await logIn(page);
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("group", { name: "Setup" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add schedule" })).toHaveCount(0);
});

test("Schedules page: open it from the sidebar, add a schedule, see its next run, and remove it", async ({
  page,
}, testInfo) => {
  const id = `walk-${testInfo.project.name.replace(/\W+/g, "-").toLowerCase()}`;
  await logIn(page);
  await openList(page);
  await page.getByRole("button", { name: "Open schedules" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Schedules");
  // The page belongs to Assistant mode, so the topbar shows the way back.
  await expect(page.getByRole("button", { name: "Assistant" })).toHaveAttribute("aria-pressed", "true");
  // No sidebar shows here, so the list button would do nothing.
  await expect(page.getByRole("button", { name: "Show the list" })).toBeHidden();
  await page.getByLabel(/^Id/).fill(id);
  await page.getByLabel("Name").fill(`Walk ${id}`);
  await page.getByLabel("Time (HH:MM)").fill("7:30");
  await page.getByLabel("Fixed text").fill("Go for a walk.");
  await page.getByRole("button", { name: "Add schedule" }).click();
  await expect(page.getByRole("status").last()).toContainText("no valid time");
  await page.getByLabel("Time (HH:MM)").fill("07:30");
  await page.getByRole("button", { name: "Add schedule" }).click();
  // No front end shows cards in the demo, so the new schedule's card waits in a dialog.
  await page.getByRole("dialog", { name: "Setup card" }).getByRole("button", { name: "Got it" }).click();
  const row = page.locator(".check-row", { hasText: `Walk ${id}` });
  await expect(row).toContainText("next:");
  await row.getByRole("button", { name: `Remove Walk ${id}` }).click();
  await expect(row).toHaveCount(0);
  await page.getByRole("button", { name: "Assistant" }).click();
  await openList(page);
  await expect(page.getByRole("button", { name: "Open schedules" })).toBeVisible();
});

/** Starts a new Assistant chat and returns its session id. */
async function newChat(page: Page): Promise<string> {
  await openList(page);
  const created = page.waitForResponse(
    (response) => response.url().endsWith("/api/sessions") && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "New chat", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("New chat");
  return ((await (await created).json()) as { id: string }).id;
}

function textEvent(sessionId: string, text: string): string {
  return JSON.stringify({ kind: "text", text, messageId: "stale", sessionId, seq: 1, at: new Date().toISOString() });
}

/** Passes the event stream through, and keeps each connection so a test can drop it. */
async function routeEvents(page: Page): Promise<WebSocketRoute[]> {
  const sockets: WebSocketRoute[] = [];
  await page.routeWebSocket(/\/api\/events$/, (socket) => {
    socket.connectToServer();
    sockets.push(socket);
  });
  return sockets;
}

test("a dropped connection shows Reconnecting…, and the reconnect clears a stale answer", async ({ page }) => {
  const sockets = await routeEvents(page);
  await logIn(page);
  const sessionId = await newChat(page);
  sockets.at(-1)?.send(textEvent(sessionId, "half an answer"));
  await expect(page.getByText("half an answer")).toBeVisible();

  await sockets.at(-1)?.close();
  await expect(page.getByText("Reconnecting…")).toBeVisible();
  await expect(page.getByText("Reconnecting…")).toBeHidden();
  await expect(page.getByText("half an answer")).toHaveCount(0);
});

test("back on the page, a stale answer from before the sleep is cleared", async ({ page }) => {
  const sockets = await routeEvents(page);
  await logIn(page);
  const sessionId = await newChat(page);
  sockets.at(-1)?.send(textEvent(sessionId, "an answer from before the sleep"));
  await expect(page.getByText("an answer from before the sleep")).toBeVisible();
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(page.getByText("an answer from before the sleep")).toHaveCount(0);
});

test("an approval asked while the connection was down still opens the dialog after the reconnect", async ({ page }) => {
  const sockets: WebSocketRoute[] = [];
  await page.routeWebSocket(/\/api\/events$/, (socket) => {
    const server = socket.connectToServer();
    // The first connection loses the approval event, as a phone does while it sleeps.
    if (sockets.length === 0) {
      server.onMessage((message) => {
        if (!String(message).includes('"approval_needed"')) socket.send(message);
      });
    }
    sockets.push(socket);
  });
  await logIn(page);
  await newChat(page);
  await page.getByLabel("Message").first().fill("please approve this");
  await page.getByRole("button", { name: "Send" }).first().click();
  await expect
    .poll(async () => ((await (await page.request.get("/api/approvals")).json()) as unknown[]).length)
    .toBeGreaterThan(0);
  const dialog = page.getByRole("dialog", { name: "Approval" });
  await expect(dialog).toHaveCount(0);

  await sockets[0]?.close();
  await expect(dialog).toContainText("gh issue create");
  await dialog.getByRole("button", { name: "Allow" }).click();
  await expect(page.locator(".message.answer").first()).toContainText("The person answered: allow");
});

test("a failed send shows the error and keeps the typed text", async ({ page }) => {
  await logIn(page);
  await newChat(page);
  await page.route("**/api/sessions/*/messages", (route) =>
    route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({ error: "The chat is busy." }),
    }),
  );
  const composer = page.getByLabel("Message").first();
  await composer.fill("Keep this text");
  await page.getByRole("button", { name: "Send" }).first().click();
  await expect(page.getByRole("alert")).toContainText("The chat is busy.");
  await expect(composer).toHaveValue("Keep this text");
  await expect(page.locator(".message.user", { hasText: "Keep this text" })).toHaveCount(0);
});

test("open problems show in a banner at the top", async ({ page }) => {
  await page.route("**/api/status", async (route) => {
    const response = await route.fetch();
    const status = (await response.json()) as Record<string, unknown>;
    await route.fulfill({ response, json: { ...status, problems: ["The vault sync failed: disk full."] } });
  });
  await logIn(page);
  const banner = page.getByRole("region", { name: "Problems" });
  await expect(banner).toContainText("1 problem");
  await expect(banner).toContainText("The vault sync failed: disk full.");
});

test("no banner shows while all is good", async ({ page }) => {
  const statusRead = page.waitForResponse("**/api/status");
  await logIn(page);
  await statusRead;
  await expect(page.getByRole("region", { name: "Problems" })).toHaveCount(0);
});

test("Settings: Restart Eva asks first, then restarts and waits for Eva", async ({ page }) => {
  const restarts: string[] = [];
  await page.route("**/api/restart", async (route) => {
    restarts.push(route.request().method());
    await route.fulfill({ status: 202, json: { restarting: true } });
  });
  await logIn(page);
  await page.getByRole("button", { name: "Settings" }).click();
  const questions: string[] = [];
  page.once("dialog", (dialog) => {
    questions.push(dialog.message());
    void dialog.dismiss();
  });
  await page.getByRole("button", { name: "Restart Eva" }).click();
  await expect.poll(() => questions).toEqual(["Restart Eva now?"]);
  expect(restarts).toEqual([]);
  page.once("dialog", (dialog) => {
    void dialog.accept();
  });
  await page.getByRole("button", { name: "Restart Eva" }).click();
  await expect(page.getByText("Eva restarted.")).toBeVisible({ timeout: 10_000 });
  expect(restarts).toEqual(["POST"]);
});

test("Settings: Update now waits until the new Eva answers, not the old one", async ({ page }) => {
  const base = {
    kind: "executable",
    frequency: "daily",
    current: "0.1.0",
    latest: "0.2.0",
    available: true,
    lastCheckAt: null,
    lastError: null,
    failedStep: null,
  };
  let restarting = false;
  let readsWhileRestarting = 0;
  await page.route("**/api/update", async (route) => {
    if (route.request().method() === "POST") {
      restarting = true;
      await route.fulfill({ json: { ...base, phase: "restarting" } });
      return;
    }
    if (restarting) readsWhileRestarting += 1;
    // The old Eva answers twice more while a chat ends, then the new one answers.
    const old = restarting && readsWhileRestarting <= 2;
    await route.fulfill({ json: { ...base, phase: old ? "restarting" : "idle", available: !restarting } });
  });
  await logIn(page);
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Update now" }).click();
  await expect(page.getByText("Eva restarts with the new version when no chat runs…")).toBeVisible();
  await expect(page.getByText("Eva restarted with the new version.")).toBeVisible({ timeout: 20_000 });
  expect(readsWhileRestarting).toBe(3);
});

test("Settings: Update Claude Code starts the update and shows its result", async ({ page }) => {
  const posts: string[] = [];
  let finished = false;
  await page.route("**/api/update/engine", async (route) => {
    if (route.request().method() === "POST") {
      posts.push("POST");
      await route.fulfill({ json: { phase: "updating", last: null } });
      return;
    }
    const last = { outcome: "updated", before: "2.1.0", after: "2.2.0", detail: null, at: "2026-10-17T10:00:00Z" };
    await route.fulfill({ json: finished ? { phase: "idle", last } : { phase: "idle", last: null } });
  });
  await logIn(page);
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByText("Claude Code: no update has run yet")).toBeVisible();
  finished = true;
  await page.getByRole("button", { name: "Update Claude Code" }).click();
  await expect(page.getByText("Claude Code: updated from 2.1.0 to 2.2.0; the next turn uses it")).toBeVisible({
    timeout: 10_000,
  });
  expect(posts).toEqual(["POST"]);
});

test("Settings: a page opened during the engine update follows it, past a failed read", async ({ page }) => {
  let reads = 0;
  await page.route("**/api/update/engine", async (route) => {
    reads += 1;
    if (reads === 2) {
      await route.abort();
      return;
    }
    const last = { outcome: "up_to_date", before: "2.1.0", after: "2.1.0", detail: null, at: "2026-10-17T10:00:00Z" };
    await route.fulfill({ json: reads === 1 ? { phase: "waiting_for_idle", last: null } : { phase: "idle", last } });
  });
  await logIn(page);
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(
    page.getByText("Claude Code: the update starts when the running chats and Eva's own update end"),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Update Claude Code" })).toBeDisabled();
  await expect(page.getByText("Claude Code: 2.1.0 is the latest")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: "Update Claude Code" })).toBeEnabled();
});

test("a new chat that cannot reach Eva says so, and the message closes", async ({ page }) => {
  await logIn(page);
  await openList(page);
  await page.route("**/api/sessions", (route) =>
    route.request().method() === "POST" ? route.abort() : route.continue(),
  );
  await page.getByRole("button", { name: "New chat", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Eva cannot be reached");
  await page.getByRole("button", { name: "Close the message" }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("a long chat follows the newest message, unless the person scrolled up", async ({ page }) => {
  await logIn(page);
  await newChat(page);
  const composer = page.getByLabel("Message").first();
  await composer.fill(Array.from({ length: 60 }, (_, line) => `line ${String(line)}`).join("\n"));
  await page.getByRole("button", { name: "Send" }).first().click();
  const answer = page.locator(".message.answer").first();
  await expect(answer).toContainText("line 59");
  await expect(answer).toBeInViewport();
  await expect(composer).toBeInViewport();

  const branches = page.locator(".branches");
  await branches.evaluate((element) => {
    element.scrollTop = 0;
  });
  await composer.fill("one more");
  await page.getByRole("button", { name: "Send" }).first().click();
  await expect(page.locator(".message.answer").nth(1)).toContainText("one more");
  expect(await branches.evaluate((element) => element.scrollTop)).toBe(0);
});

test.describe("on a phone", () => {
  test.beforeEach(({ page: _page }, testInfo) => {
    test.skip(testInfo.project.name !== "phone", "These checks are for the phone size only.");
  });

  test("every button is at least 44 px tall, and a tap outside the list closes it", async ({ page }) => {
    await logIn(page);
    await openList(page);
    const sidebar = page.getByRole("navigation", { name: "Chats" });
    await expect(sidebar).toBeVisible();
    const heights = await page
      .locator("button:visible, select:visible")
      .evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().height));
    expect(Math.min(...heights)).toBeGreaterThanOrEqual(44);
    // An icon button is narrow by nature, so its width needs a check too.
    const iconBox = await page.getByRole("button", { name: "Open schedules" }).boundingBox();
    expect(iconBox?.width ?? 0).toBeGreaterThanOrEqual(44);
    await page.getByRole("button", { name: "Close the list" }).click({ position: { x: 360, y: 200 } });
    await expect(sidebar).toBeHidden();
  });

  test("the mode switch stays in place on a screen with no list", async ({ page }) => {
    await logIn(page);
    const modeSwitch = page.getByRole("group", { name: "Mode" });
    const before = await modeSwitch.boundingBox();
    await page.getByRole("button", { name: "Settings" }).click();
    await expect(page.getByRole("button", { name: "Show the list" })).toBeHidden();
    expect((await modeSwitch.boundingBox())?.x).toBe(before?.x);
  });

  test("on Settings too, every button is at least 44 px tall and nothing is wider than the screen", async ({
    page,
  }) => {
    await logIn(page);
    await page.getByRole("button", { name: "Settings" }).click();
    await expect(page.getByLabel("GitHub token", { exact: true })).toBeVisible();
    const heights = await page
      .locator("button:visible, select:visible")
      .evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().height));
    expect(Math.min(...heights)).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  });

  test("the composer sits at the bottom of the screen", async ({ page }) => {
    await logIn(page);
    await newChat(page);
    const box = await page.getByLabel("Message").first().boundingBox();
    const viewportHeight = page.viewportSize()?.height ?? 0;
    expect((box?.y ?? 0) + (box?.height ?? 0)).toBeGreaterThan(viewportHeight - 80);
  });
});

test.describe("on a touch screen", () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 375, height: 812 } });
  test.beforeEach(({ page: _page }, testInfo) => {
    test.skip(testInfo.project.name !== "phone", "One run is enough.");
  });

  test("Enter starts a new line, and the Send button sends", async ({ page }) => {
    await logIn(page);
    await newChat(page);
    expect(await page.evaluate(() => window.matchMedia("(pointer: coarse)").matches)).toBe(true);
    const composer = page.getByLabel("Message").first();
    await composer.fill("first line");
    await composer.press("Enter");
    await composer.pressSequentially("second line");
    await expect(composer).toHaveValue("first line\nsecond line");
    await expect(page.locator(".message.user")).toHaveCount(0);
    await page.getByRole("button", { name: "Send" }).first().click();
    await expect(page.locator(".message.answer").first()).toContainText("second line");
  });
});
