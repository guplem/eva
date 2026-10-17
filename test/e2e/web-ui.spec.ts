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
    await page.getByRole("button", { name: "Close the list" }).click({ position: { x: 360, y: 200 } });
    await expect(sidebar).toBeHidden();
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
