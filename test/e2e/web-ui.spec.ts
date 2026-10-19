import { expect, test, type Page, type WebSocketRoute } from "@playwright/test";

const token = "e2e-demo-token";

async function logIn(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByLabel(/Token/).fill(token);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
}

async function openList(page: Page): Promise<void> {
  const menu = page.getByRole("button", { name: "Show the list" });
  if (await menu.isVisible()) await menu.click();
}

/** Opens Settings, then a section by its card on the home page, which a phone shows too. */
async function openSettings(page: Page, section?: string): Promise<void> {
  // Only the main navigation: a chat or a project in the list may also have "Settings" in its name.
  await page
    .getByRole("navigation", { name: "Main" })
    .getByRole("button", { name: /^Settings/ })
    .click();
  if (section === "Setup") await page.getByRole("button", { name: "See every step" }).click();
  else if (section !== undefined) await page.locator(".section-card", { hasText: section }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(section ?? "Settings");
}

/** The task chip under the answer opens the tasks of that answer, also on a phone. They ended with the turn. */
async function expectBackgroundTasks(page: Page): Promise<void> {
  if (test.info().project.name === "desktop") {
    await expect(page.getByRole("complementary", { name: "This chat" })).toContainText(
      "Nothing runs in the background.",
    );
  }
  await page.getByRole("button", { name: "1 background task", exact: true }).first().click();
  const dialog = page.getByRole("dialog", { name: "Background tasks" });
  await expect(dialog).toContainText("Search the notes");
  await expect(dialog).toContainText("Ended");
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
  await expect(page.getByRole("button", { name: "Show 3 steps" }).first()).toHaveAttribute(
    "title",
    "1 command, 1 tool",
  );
  await expectBackgroundTasks(page);

  await page.getByRole("button", { name: "Retry" }).first().click();
  await expect(page.locator(".branch")).toHaveCount(2);
  await expect(page.getByText(/Branch after answer/)).toBeVisible();
});

test("Delete chat asks first, then removes the chat from the list", async ({ page }) => {
  // Both screen sizes share one demo server, so each size names its own chats.
  const title = `A chat to delete (${test.info().project.name})`;
  await logIn(page);
  await openList(page);
  await page.getByRole("button", { name: "New chat", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("New chat");
  const composer = page.getByLabel("Message").first();
  await composer.fill(title);
  await composer.press("Enter");
  await expect(page.locator(".message.answer").first()).toContainText(title);
  // The list keeps its items when it is closed on a phone, so the count needs no open list.
  const listed = page.locator(".sidebar .list-item", { hasText: title });
  await expect(listed).toHaveCount(1);
  // A chat that still works refuses a delete, and it works until the vault sync after its answer.
  await waitUntilIdle(page, await chatIdNamed(page, title));
  const deletes: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "DELETE") deletes.push(request.url());
  });

  page.once("dialog", (dialog) => void dialog.dismiss());
  await page.getByRole("button", { name: "Delete chat" }).click();
  await expect(listed).toHaveCount(1);
  expect(deletes).toEqual([]);

  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Delete chat" }).click();
  await expect(listed).toHaveCount(0);
  expect(deletes).toHaveLength(1);
});

/** Waits until the chat's turn and its vault sync are over, so a delete is not refused. */
async function waitUntilIdle(page: Page, chatId: string): Promise<void> {
  await expect
    .poll(
      async () =>
        ((await (await page.request.get("/api/status")).json()) as { busySessionIds: string[] }).busySessionIds,
    )
    .not.toContain(chatId);
}

async function chatIdNamed(page: Page, title: string): Promise<string> {
  const sessions = (await (await page.request.get("/api/sessions")).json()) as { id: string; title: string }[];
  const found = sessions.find((session) => session.title === title);
  if (found === undefined) throw new Error(`no chat named ${title}`);
  return found.id;
}

/** A new Assistant chat with one answer. Each screen size names its own chats, on the shared demo server. */
async function newAnsweredChat(page: Page, text: string): Promise<string> {
  const title = `${text} (${test.info().project.name})`;
  await openList(page);
  await page.getByRole("button", { name: "New chat", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("New chat");
  const composer = page.getByLabel("Message").first();
  await composer.fill(title);
  await composer.press("Enter");
  await expect(page.locator(".message.answer").first()).toContainText(title);
  return title;
}

test("the address #/chat/<id> opens that Assistant chat, as a link from Telegram does", async ({ page }) => {
  await logIn(page);
  const first = await newAnsweredChat(page, "First linked chat");
  const second = await newAnsweredChat(page, "Second linked chat");
  await page.goto(`/#/chat/${await chatIdNamed(page, first)}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(first);

  // The link opens once: the person's own choice then stays, also after another screen.
  await openList(page);
  await page.locator(".sidebar .list-item", { hasText: second }).click();
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Chats" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(second);
  expect(new URL(page.url()).hash).toBe("#/chats");
});

test("a link opened before the login opens its chat after the login", async ({ page }) => {
  await logIn(page);
  const linked = await newAnsweredChat(page, "Linked before login");
  await newAnsweredChat(page, "Newer chat");
  const chatId = await chatIdNamed(page, linked);
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Log out", exact: true }).click();

  await page.goto(`/#/chat/${chatId}`);
  await page.getByLabel(/Token/).fill(token);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(linked);
});

test("a link to a deleted chat says so", async ({ page }) => {
  await logIn(page);
  const title = await newAnsweredChat(page, "A chat that goes");
  const chatId = await chatIdNamed(page, title);
  await waitUntilIdle(page, chatId);
  expect((await page.request.delete(`/api/sessions/${chatId}`)).status()).toBe(200);
  // The page learns of the delete over its socket. A link that comes first finds the chat in the old list and opens it.
  await expect(page.locator(".sidebar .list-item", { hasText: title })).toHaveCount(0);
  await page.goto(`/#/chat/${chatId}`);
  await expect(page.getByRole("alert")).toContainText("That chat no longer exists.");
  expect(new URL(page.url()).hash).toBe("#/chats");
});

test("the address #/chat/<id> opens a Project chat in its clone", async ({ page }) => {
  const title = `Linked project work (${test.info().project.name})`;
  await logIn(page);
  await page.getByRole("button", { name: "Projects", exact: true }).click();
  await openList(page);
  await page.getByLabel("Search projects").fill("example");
  await page.getByRole("button", { name: /Example app/ }).click();
  await page.getByRole("button", { name: "New clone" }).click();
  await page.getByRole("button", { name: "Start a chat in this clone" }).click();
  const composer = page.getByLabel("Message").first();
  await composer.fill(title);
  await composer.press("Enter");
  // Only the first chat in a new clone asks for trust; both screen sizes share one demo server.
  const answer = page.locator(".message.answer").first();
  const trustQuestion = page.getByRole("region", { name: "Eva asks for permission" });
  // The working card shows at once, so only the finished answer tells that no trust question comes.
  await Promise.race([answer.filter({ hasText: title }).waitFor(), trustQuestion.waitFor()]);
  if (await trustQuestion.isVisible()) await trustQuestion.getByRole("button", { name: "Deny" }).click();
  await expect(answer).toContainText(title);
  const chatId = await chatIdNamed(page, title);

  await page.goto("/");
  await expect(page.getByRole("button", { name: "Chats" })).toHaveAttribute("aria-current", "page");
  await page.goto(`/#/chat/${chatId}`);
  await expect(page.getByRole("button", { name: "Projects", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.locator(".message.user").first()).toContainText(title);
});

test("a chat gets a new title in the header and the list, and Escape keeps the old one (issue 46)", async ({
  page,
}) => {
  await logIn(page);
  await openList(page);
  await page.getByRole("button", { name: "New chat", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("New chat");

  await page.getByRole("button", { name: "Rename this chat" }).click();
  await page.getByLabel("Chat title").fill("Draft");
  await page.getByLabel("Chat title").press("Escape");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("New chat");

  await page.getByRole("button", { name: "Rename this chat" }).click();
  // The field is selected, so typing replaces the old title.
  await page.getByLabel("Chat title").pressSequentially("Trip");
  await expect(page.getByLabel("Chat title")).toHaveValue("Trip");
  if (test.info().project.name === "phone") {
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  }
  await page.getByLabel("Chat title").fill("Trip plans");
  await page.getByLabel("Chat title").press("Enter");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Trip plans");
  await openList(page);
  await expect(page.locator(".list-item[aria-current='true']")).toContainText("Trip plans");

  // A rename in Telegram or the terminal reaches the page through the event stream.
  const sessions = (await (await page.request.get("/api/sessions")).json()) as { id: string; title: string }[];
  const chat = sessions.find((session) => session.title === "Trip plans");
  expect(chat).toBeDefined();
  await page.request.post(`/api/sessions/${chat?.id ?? ""}/rename`, { data: { title: "Rome in May" } });
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Rome in May");
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

test("a usage warning shows under the chat after its answer (issue #67)", async ({ page }) => {
  await logIn(page);
  await openList(page);
  await page.getByRole("button", { name: "New chat", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("New chat");
  const composer = page.getByLabel("Message").first();
  await composer.fill("near the limit");
  await composer.press("Enter");
  await expect(page.locator(".message.answer").first()).toContainText("near the limit");
  await expect(page.getByRole("status").filter({ hasText: "usage limit" })).toContainText(
    /You used 86% of your 5-hour usage limit\. It resets (at|on) /,
  );
});

test("an approval shows as a card in its chat, and Allow once answers the turn", async ({ page }) => {
  await logIn(page);
  await openList(page);
  await page.getByRole("button", { name: "New chat", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("New chat");
  const composer = page.getByLabel("Message").first();
  await composer.fill("please approve this");
  await composer.press("Enter");
  const dialog = page.getByRole("region", { name: "Eva asks for permission" });
  await expect(dialog).toContainText("gh issue create");
  // While the turn waits, its running task shows under the conversation, also on a phone.
  await expect(page.getByRole("button", { name: "1 background task running" })).toBeVisible();
  // While the turn runs, Send becomes Stop at the same place, and the working line counts the time.
  await expect(page.getByRole("button", { name: "Stop" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Send" })).toHaveCount(0);
  await expect(page.locator(".working")).toContainText(/Working · \d+ s/);
  // Eva queues a message sent during a turn, so typed text brings Send back.
  await composer.fill("one more");
  await expect(page.getByRole("button", { name: "Send" })).toBeVisible();
  await composer.fill("");
  // On a phone, the person must see which chat waits for a decision.
  const listed = page.locator(".sidebar .list-item[aria-current='true']");
  await expect(listed.locator(".status-pill")).toHaveText("Needs you");
  // The card names what it asks, with the firm face beside it on a computer.
  await expect(dialog).toContainText("Needs you");
  await expect(dialog.getByRole("heading")).toHaveText("Eva wants to run a command");
  const allow = dialog.getByRole("button", { name: "Allow once" });
  if (test.info().project.name === "phone") {
    // A bottom sheet with full-width buttons, in reach of the thumb.
    const box = await allow.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    expect(box?.width ?? 0).toBeGreaterThan(300);
    // The sheet does not cover the tab bar: the person can still go to another page.
    await page
      .getByRole("navigation", { name: "Main" })
      .getByRole("button", { name: /^Schedules/ })
      .click({ trial: true, timeout: 2_000 });
  } else {
    await expect(page.locator(".msg:has(.approval-card) .mk.e-firm")).toBeVisible();
  }
  // The request is in the chat, not in a dialog that blocks the page.
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await allow.click();
  await expect(page.locator(".message.answer").first()).toContainText("The person answered: allow");
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Stop" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Send" })).toBeDisabled();
});

test("a request of another chat gets a notice that opens it, and an answer from elsewhere closes the card", async ({
  page,
}) => {
  const title = `Waiting chat (${test.info().project.name})`;
  await logIn(page);
  const waitingId = await newChat(page);
  await page.request.post(`/api/sessions/${waitingId}/rename`, { data: { title } });
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
  const composer = page.getByLabel("Message").first();
  await composer.fill("please approve this");
  await composer.press("Enter");
  const card = page.getByRole("region", { name: "Eva asks for permission" });
  await expect(card).toContainText(title);

  // Another chat: the card goes, and a notice names the chat that waits.
  await newChat(page);
  await expect(card).toHaveCount(0);
  const notice = page.getByRole("region", { name: "Chats that wait for you" });
  await expect(notice).toContainText(`Eva needs your permission in ${title}`);
  // The notice also shows on another page.
  await page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: "Schedules" }).click();
  await notice.getByRole("button", { name: `Open ${title}` }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
  await expect(card).toContainText("gh issue create");
  // Another test can leave a request of its own chat, so only this chat must leave the notice.
  await expect(notice.getByRole("button", { name: `Open ${title}` })).toHaveCount(0);

  // Telegram or the terminal answers first: the card closes here too.
  const pending = (await (await page.request.get("/api/approvals")).json()) as {
    requestId: string;
    sessionId: string;
  }[];
  const request = pending.find((entry) => entry.sessionId === waitingId);
  expect(request).toBeDefined();
  await page.request.post(`/api/approvals/${request?.requestId ?? ""}`, { data: { answer: "deny" } });
  await expect(card).toHaveCount(0);
  await expect(page.locator(".message.answer").first()).toContainText("The person answered: deny");
});

test("Copy copies the text of an answer", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await logIn(page);
  const title = await newAnsweredChat(page, "Copy me");
  const answer = page.locator(".message.answer").first();
  await answer.getByRole("button", { name: "Copy" }).click();
  await expect(answer.getByRole("button", { name: "Copied" })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(title);
});

test("the composer's chip picks the model before the first message, and is fixed after it", async ({ page }) => {
  await logIn(page);
  await newChat(page);
  const chip = page.getByRole("button", { name: /Default model/ });
  await chip.click();
  const menu = page.getByRole("dialog", { name: "Engine and model" });
  await expect(
    menu.getByRole("group", { name: "Engine" }).getByRole("button", { name: "Claude Code" }),
  ).toHaveAttribute("aria-pressed", "true");
  await menu.getByRole("group", { name: "Model" }).getByRole("button", { name: "Haiku" }).click();
  await expect(page.locator(".main-header .badge")).toHaveText("haiku");
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);

  const composer = page.getByLabel("Message").first();
  await composer.fill("Hello Eva");
  await composer.press("Enter");
  await expect(page.locator(".message.answer").first()).toContainText(/Echo \d+: Hello Eva/);
  await page.getByRole("button", { name: /Haiku/ }).click();
  await expect(menu).toContainText("fixed after the first message");
  await expect(menu.getByRole("button")).toHaveCount(0);
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
  // The card asks in the page, not with a browser question.
  await dialog.getByRole("button", { name: "Remove schedule" }).click();
  await dialog.getByRole("button", { name: "Keep" }).click();
  await dialog.getByRole("button", { name: "Remove schedule" }).click();
  await dialog.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const listed = (await (await page.request.get("/api/schedules")).json()) as {
    schedules: { schedule: { id: string } }[];
  };
  expect(listed.schedules.map((view) => view.schedule.id)).not.toContain(id);
});

test("Project mode: search, a new clone with its branch, and a chat in it", async ({ page }) => {
  await logIn(page);
  await page.getByRole("button", { name: "Projects", exact: true }).click();
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
  const trustQuestion = page.getByRole("region", { name: "Eva asks for permission" });
  await Promise.race([answer.filter({ hasText: "Fix the bug" }).waitFor(), trustQuestion.waitFor()]);
  if (await trustQuestion.isVisible()) {
    await expect(trustQuestion).toContainText("Trust this repository");
    await trustQuestion.getByRole("button", { name: "Deny" }).click();
  }
  await expect(answer).toContainText("Fix the bug");
  // Project mode shows the same activity as Assistant mode.
  await expect(page.getByRole("button", { name: "Show 3 steps" }).first()).toHaveAttribute(
    "title",
    "1 command, 1 tool",
  );
  await expectBackgroundTasks(page);

  // Another chat's tasks stay out of view. A project chat keeps the Assistant chat list unchanged.
  await openList(page);
  await page.getByRole("group", { name: "Chats in this clone" }).getByRole("button", { name: "New chat" }).click();
  if (test.info().project.name === "desktop") {
    await expect(page.getByRole("complementary", { name: "This chat" })).toContainText(
      "Nothing runs in the background.",
    );
  }
});

test("a clone lists all its chats, and a new chat starts in a clone that has one", async ({ page }) => {
  await logIn(page);
  await page.getByRole("button", { name: "Projects", exact: true }).click();
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
  await page.getByRole("button", { name: "Projects", exact: true }).click();
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
  await page.getByRole("button", { name: "Projects", exact: true }).click();
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
  await page.getByRole("button", { name: "Projects", exact: true }).click();
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
  await page.getByRole("button", { name: "Projects", exact: true }).click();
  await openList(page);
  const project = page.getByRole("button", { name: /Broken notes/ });
  await expect(project).toContainText("1 warning");
  await project.click();
  await expect(page.getByRole("list", { name: "Warnings of Broken notes" })).toHaveText("repos must be a list of URLs");
});

test("Settings: the vault Test button checks the remote, and Log out ends the session", async ({ page }) => {
  await logIn(page);
  await openSettings(page, "Vault and sync");
  const vaultRow = page.locator(".check-row", { hasText: "Vault repository" });
  await vaultRow.getByRole("button", { name: "Test" }).click();
  await expect(vaultRow.getByRole("img", { name: "Passed" })).toBeVisible();
  // Log out sits on the Settings home page.
  await openSettings(page);
  await page.getByRole("button", { name: "Log out", exact: true }).click();
  await expect(page.getByRole("button", { name: "Log in" })).toBeVisible();
});

test("Settings: the rules for chat names save with Save and load again (issue 50)", async ({ page }) => {
  await logIn(page);
  await openSettings(page, "Personalize");
  try {
    await page.getByLabel("Rules for chat names").fill("Lead every name with an emoji.");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Saved." })).toBeVisible();
    await page.reload();
    // The address keeps the page, so the reload opens Personalize again.
    await expect(page.getByLabel("Rules for chat names")).toHaveValue("Lead every name with an emoji.");
  } finally {
    // Rules would make every later first message start a model call, so later tests start without them.
    await page.evaluate(() =>
      fetch("/api/chat-names", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rules: "" }),
      }),
    );
  }
});

test("Settings: Use Eva from any device installs Tailscale, then shares the address", async ({ page }) => {
  await logIn(page);
  await openSettings(page, "Access");
  const section = page.getByRole("region", { name: "Use Eva from any device" });
  await expect(section).toContainText("Install Tailscale on the phone or computer.");
  // The demo is shared by every browser of the run, so another one may have installed it already.
  const install = section.getByRole("button", { name: "Install Tailscale" });
  // A short click try: the button is gone once the install ends, and the page reads the status every 3 seconds.
  await install.click({ timeout: 2_000 }).catch(() => undefined);
  await expect(section.getByRole("link", { name: "https://eva.example-tailnet.ts.net" })).toBeVisible();
  await expect(section.getByRole("img", { name: "QR code of https://eva.example-tailnet.ts.net" })).toBeVisible();
  await expect(section).toContainText("owner@example.com");
  await expect(section.getByRole("button", { name: "Copy" })).toBeVisible();
});

test("Settings: Log out every device ends this login too", async ({ page }) => {
  await logIn(page);
  await openSettings(page, "Access");
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Log out every device" }).click();
  await expect(page.getByRole("button", { name: "Log in" })).toBeVisible();
});

test("Settings: a token saves write-only, shows as saved, and can be removed", async ({ page }) => {
  await logIn(page);
  // A failed earlier run must not leave a token for this one.
  await page.request.delete("/api/secrets/githubToken");
  await openSettings(page, "Connections");
  const field = page.getByLabel("GitHub token", { exact: true });
  await expect(page.getByText("No GitHub token is saved.")).toBeVisible();
  await field.fill("ghp_e2e-example-token");
  await page.getByRole("button", { name: "Save the GitHub token" }).click();
  await expect(page.getByText("A GitHub token is saved.")).toBeVisible();
  await expect(field).toHaveValue("");
  await expect(page.getByRole("status").filter({ hasText: "Restart Eva" })).toBeVisible();
  await page.reload();
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
  await openSettings(page, "AI engines");
  const claudeRow = page.locator(".check-row", { hasText: "Test the Claude Code token" });
  await claudeRow.getByRole("button", { name: "Test" }).click();
  await expect(claudeRow.getByRole("img", { name: "Passed" })).toBeVisible();
  await expect(claudeRow).toContainText("Claude Code answered:");
  const piRow = page.locator(".check-row", { hasText: "Test pi" });
  await piRow.getByRole("button", { name: "Test" }).click();
  // The demo server has only the scripted Claude Code engine.
  await expect(piRow.getByRole("img", { name: "Failed" })).toBeVisible();
  await expect(piRow).toContainText("Eva did not find pi on this machine.");
  await openSettings(page, "Connections");
  await expect(page.getByText("Telegram is not set up: save a bot token, then restart Eva.")).toBeVisible();
  await openSettings(page, "Access");
  await expect(page.getByText("Only the Tailscale account that owns this machine.")).toBeVisible();
});

test("Settings: the default model saves at once", async ({ page }) => {
  await logIn(page);
  try {
    await openSettings(page, "AI engines");
    await page.getByLabel("Claude Code model").selectOption("sonnet");
    await expect(page.getByRole("status").filter({ hasText: "Saved." })).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("Claude Code model")).toHaveValue("sonnet");
  } finally {
    // Later tests share the demo vault.
    await page.request.put("/api/settings", { data: { engines: { claudeCode: { defaultModel: "default" } } } });
  }
});

test("Settings: the vault sync state shows a conflict, its picks and the held-back files", async ({ page }) => {
  let conflictState: Record<string, unknown> = {};
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
    conflictState = status.vaultSync;
    await route.fulfill({ response, json: status });
  });
  // The demo vault has no conflict, so the browser plays the conflict list as well.
  await page.route("**/api/vault/conflicts", (route) =>
    route.fulfill({
      json: { state: conflictState, conflicts: [{ path: "Notes/plan.md", kind: "committed", picked: null }] },
    }),
  );
  await logIn(page);
  await openSettings(page, "Vault and sync");
  const sync = page.getByRole("region", { name: "Vault sync" });
  await expect(sync).toContainText("Conflict: Notes/plan.md has a conflict.");
  await expect(sync.getByRole("group", { name: "Notes/plan.md" })).toBeVisible();
  await expect(sync.getByRole("button", { name: "Keep mine: Notes/plan.md" })).toBeVisible();
  await expect(sync.getByRole("button", { name: "Keep theirs: Notes/plan.md" })).toBeVisible();
  await expect(sync.getByRole("button", { name: "Keep both: Notes/plan.md" })).toBeVisible();
  await expect(sync).toContainText("Notes/keys.md (looks like a secret)");
  await expect(sync).toContainText("Media/film.mov (larger than 50 MB)");
});

test("Settings: the theme and the density apply at once and stay in this browser", async ({ page }) => {
  await logIn(page);
  await openSettings(page, "Personalize");
  await page.getByRole("group", { name: "Theme" }).getByRole("button", { name: "Dark" }).click();
  await page.getByRole("group", { name: "Density" }).getByRole("button", { name: "Compact" }).click();
  await expect(page.getByRole("button", { name: "Dark" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "System" })).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("html")).toHaveAttribute("data-density", "compact");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("html")).toHaveAttribute("data-density", "compact");
});

test("Settings: a seed colour changes the whole palette and stays in this browser", async ({ page }) => {
  await logIn(page);
  const accent = (): Promise<string> =>
    page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--accent"));
  const before = await accent();
  await openSettings(page, "Personalize");
  const colours = page.getByRole("group", { name: "Colour" });
  await expect(colours.getByRole("button")).toHaveCount(15);
  await expect(colours.getByRole("button", { name: "EVE" })).toHaveAttribute("aria-pressed", "true");
  await colours.getByRole("button", { name: "Violet" }).click();
  await expect(colours.getByRole("button", { name: "Violet" })).toHaveAttribute("aria-pressed", "true");
  await expect(colours.getByRole("button", { name: "EVE" })).toHaveAttribute("aria-pressed", "false");
  expect(await accent()).not.toBe(before);
  await page.getByLabel("Any colour").fill("#123abc");
  await expect(page.getByText("#123ABC")).toBeVisible();
  // The address keeps the page, so the reload opens Personalize again.
  await page.reload();
  await expect(page.getByLabel("Any colour")).toHaveValue("#123abc");
});

test("the page brings its own fonts, so it needs no other server", async ({ page, baseURL }) => {
  await page.route("**/*", (route) =>
    route
      .request()
      .url()
      .startsWith(baseURL ?? "")
      ? route.continue()
      : route.abort(),
  );
  await page.goto("/");
  // `document.fonts.check` is also true when no face matches, so the test reads each face's status.
  const loaded = await page.evaluate(async () => {
    await Promise.all(
      ["500 14px Quicksand", "400 14px 'IBM Plex Mono'", "500 14px 'IBM Plex Mono'"].map((font) =>
        document.fonts.load(font),
      ),
    );
    return [...document.fonts]
      .filter((face) => face.status === "loaded")
      .map((face) => `${face.family.replaceAll('"', "")} ${face.weight}`);
  });
  expect(loaded).toEqual(expect.arrayContaining(["Quicksand 300 700", "IBM Plex Mono 400", "IBM Plex Mono 500"]));
  await expect(page.locator("html")).toHaveCSS("font-family", /^Quicksand/);
});

/**
 * The demo server has no Tailscale, so the browser plays the server's side of the device login.
 * Returns the number of requests that the page made.
 */
async function routeDeviceLogin(
  page: Page,
  request: { id: string; code: string; approvers: string[]; state?: "pending" | "denied" | "expired" },
): Promise<() => number> {
  let asked = 0;
  await page.route("**/api/login/device", (route) => {
    asked += 1;
    return route.fulfill({
      status: 201,
      json: {
        id: request.id,
        code: request.code,
        account: "owner@example.com",
        expiresAt: "2099-01-01T00:00:00.000Z",
        approvers: request.approvers,
      },
    });
  });
  if (request.state !== undefined) {
    const state = request.state;
    await page.route(`**/api/login/device/${request.id}`, (route) => route.fulfill({ json: { state } }));
  }
  return () => asked;
}

test("device login: a browser shows its code and how to allow it, then opens", async ({ page, context, baseURL }) => {
  let polls = 0;
  await routeDeviceLogin(page, { id: "request-1", code: "K7QX", approvers: ["Telegram", "terminal", "Eva page"] });
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
  await expect(page.getByRole("heading", { name: "Confirm this device" })).toBeVisible();
  await expect(page.getByText("K7QX", { exact: true })).toBeVisible();
  await expect(page.getByText("eva devices allow K7QX")).toBeVisible();
  await expect(page.getByText("Or tap Allow in your Telegram chat")).toBeVisible();
  await expect(page.getByText("Or tap Allow on an Eva page")).toBeVisible();
  await expect(page.getByRole("status")).toHaveText("Waiting. This page opens by itself.");
  await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
});

test("device login: the page lists only the ways that can allow the code", async ({ page }) => {
  await routeDeviceLogin(page, { id: "request-3", code: "T4NB", approvers: ["terminal"], state: "pending" });
  await page.goto("/");
  await expect(page.getByText("eva devices allow T4NB")).toBeVisible();
  await expect(page.getByText(/Telegram/)).toHaveCount(0);
  await expect(page.getByText(/another device/)).toHaveCount(0);
});

test("device login: Copy code puts the code on the clipboard", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await routeDeviceLogin(page, { id: "request-4", code: "H8RW", approvers: ["Telegram"], state: "pending" });
  await page.goto("/");
  await page.getByRole("button", { name: "Copy code" }).click();
  await expect(page.getByRole("button", { name: "Copied" })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("H8RW");
});

test("device login: the token form opens from a quiet link, and the code comes back", async ({ page }) => {
  const asked = await routeDeviceLogin(page, {
    id: "request-5",
    code: "W2KD",
    approvers: ["terminal"],
    state: "pending",
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Log in with the token instead" }).click();
  await expect(page.getByLabel(/Token/)).toBeVisible();
  await page.getByRole("button", { name: "Use the code instead" }).click();
  await expect(page.getByText("eva devices allow W2KD")).toBeVisible();
  // The page goes back to the same request, so the code that the person may have typed stays valid.
  expect(asked()).toBe(1);
});

test("device login: the page still opens by itself while the token form shows", async ({ page, context, baseURL }) => {
  let allowed = false;
  await routeDeviceLogin(page, { id: "request-7", code: "F6GJ", approvers: ["Telegram"] });
  await page.route("**/api/login/device/request-7", async (route) => {
    if (!allowed) {
      await route.fulfill({ json: { state: "pending" } });
      return;
    }
    await context.addCookies([{ name: "eva_token", value: token, url: baseURL ?? "" }]);
    await route.fulfill({ json: { state: "allowed" } });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Log in with the token instead" }).click();
  await expect(page.getByLabel(/Token/)).toBeVisible();
  allowed = true;
  await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
});

test("device login: with no approver, the page says why and asks for the token", async ({ page }) => {
  await page.route("**/api/login/device", (route) =>
    route.fulfill({ status: 409, json: { error: "Nothing on this machine can confirm a new device." } }),
  );
  await page.goto("/");
  await expect(page.getByRole("status")).toHaveText("Nothing on this machine can confirm a new device.");
  await expect(page.getByLabel(/Token/)).toBeVisible();
});

test("device login: a denied request looks sad, and offers to ask again", async ({ page }) => {
  await routeDeviceLogin(page, { id: "request-2", code: "M3PT", approvers: ["terminal"], state: "denied" });
  await page.goto("/");
  await expect(page.getByRole("status")).toHaveText("The request was denied.");
  await expect(page.locator(".mk")).toHaveClass(/e-sad/);
  await expect(page.getByRole("button", { name: "Ask again" })).toBeVisible();
});

test("device login: an expired request looks skeptical, and Ask again asks for a new code", async ({ page }) => {
  const asked = await routeDeviceLogin(page, {
    id: "request-6",
    code: "P9LC",
    approvers: ["terminal"],
    state: "expired",
  });
  await page.goto("/");
  await expect(page.getByRole("status")).toHaveText("The request expired. Ask again, or log in with the token.");
  await expect(page.locator(".mk")).toHaveClass(/e-skeptic/);
  await page.getByRole("button", { name: "Ask again" }).click();
  await expect.poll(asked).toBe(2);
});

test("Settings: the progress list leads to each step's page, which keeps the last Test result", async ({ page }) => {
  await logIn(page);
  // The demo has no allowed device yet, so at least that step is left.
  await expect(page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: /^Settings/ })).toContainText(
    "to set up",
  );
  await openSettings(page);
  await expect(page.getByRole("region", { name: "Setup" })).toContainText("Finish setting up Eva");
  await openSettings(page, "Setup");
  const list = page.getByRole("region", { name: "Progress list" });
  await expect(list).toContainText("Your devices");
  await list.getByRole("button", { name: /Your devices/ }).click();
  await expect(page.getByRole("region", { name: "Allow a new device" })).toContainText("eva devices allow");
  await page.getByRole("button", { name: /Step 2: Your vault/ }).click();
  await page.getByRole("button", { name: "Test Your vault" }).click();
  await expect(page.getByRole("region", { name: "Your vault" })).toContainText("Last test:");
  // Back goes up one level, to the list, which shows the result too.
  await page.goBack();
  await page.goBack();
  await expect(page.getByRole("region", { name: "Progress list" })).toContainText("Last test:");
});

test("Settings: search finds a setting and opens its page", async ({ page }) => {
  await logIn(page);
  await openSettings(page);
  await page.getByLabel("Search settings").fill("dark theme");
  const results = page.getByRole("list", { name: "Search results" });
  await expect(results.getByRole("button")).toHaveCount(1);
  await results.getByRole("button", { name: /Appearance/ }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Personalize");
  await expect(page.getByLabel("Theme")).toBeVisible();
  await page.getByLabel("Search settings").fill("banana");
  await expect(page.getByText("No setting matches “banana”.")).toBeVisible();
});

test("Settings: a token saved on a step's page shows at once in that step", async ({ page }) => {
  await logIn(page);
  await page.request.delete("/api/secrets/githubToken");
  await openSettings(page, "Setup");
  await page
    .getByRole("region", { name: "Progress list" })
    .getByRole("button", { name: /GitHub/ })
    .click();
  const header = page.getByRole("region", { name: "GitHub", exact: true }).first();
  await expect(header).not.toContainText("The token is saved.");
  await page.getByLabel("GitHub token", { exact: true }).fill("ghp_e2e-progress-token");
  await page.getByRole("button", { name: "Save the GitHub token" }).click();
  await expect(header).toContainText("The token is saved.");
  await expect(page.getByText("Eva uses the changes after a restart.")).toBeVisible();
  await page.request.delete("/api/secrets/githubToken");
});

test("Settings: no schedule form, because schedules have their own page", async ({ page }) => {
  await logIn(page);
  await openSettings(page);
  await expect(page.getByRole("region", { name: "Setup" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add schedule" })).toHaveCount(0);
});

test("Schedules page: open it from the main navigation, add a schedule, see its next run, and remove it", async ({
  page,
}, testInfo) => {
  const id = `walk-${testInfo.project.name.replace(/\W+/g, "-").toLowerCase()}`;
  await logIn(page);
  await page.getByRole("button", { name: "Schedules" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Schedules");
  await expect(page.getByRole("button", { name: "Schedules" })).toHaveAttribute("aria-current", "page");
  // No sidebar shows here, so the list button would do nothing.
  await expect(page.getByRole("button", { name: "Show the list" })).toBeHidden();
  // The form opens in a dialog, so it does not fill the page.
  await expect(page.getByLabel("Time (HH:MM)")).toHaveCount(0);
  await page.getByRole("button", { name: "Add schedule" }).click();
  const form = page.getByRole("dialog", { name: "Add schedule" });
  await form.getByLabel(/^Id/).fill(id);
  await form.getByLabel("Name").fill(`Walk ${id}`);
  await form.getByLabel("Time (HH:MM)").fill("7:30");
  await form.getByRole("button", { name: "Fri" }).click();
  await form.getByLabel("Fixed text").fill("Go for a walk.");
  await form.getByRole("button", { name: "Save schedule" }).click();
  await expect(form.getByRole("status")).toContainText("no valid time");
  await form.getByLabel("Time (HH:MM)").fill("07:30");
  await form.getByRole("button", { name: "Save schedule" }).click();
  await expect(form).toHaveCount(0);
  // No front end shows cards in the demo, so the new schedule's card waits in a dialog.
  const card = page.getByRole("dialog", { name: "Setup card" });
  await expect(card).toContainText("Fridays at 07:30");
  await card.getByRole("button", { name: "Got it" }).click();
  await expect(page.getByRole("region", { name: "Today" })).toBeVisible();
  const row = page.getByRole("listitem", { name: `Walk ${id}` });
  await expect(row).toContainText("Fridays at 07:30 · next");
  await expect(row).toContainText("Not run yet");
  // Remove asks in the page first.
  await row.getByRole("button", { name: `Remove Walk ${id}` }).click();
  await row.getByRole("button", { name: "Keep" }).click();
  await row.getByRole("button", { name: `Remove Walk ${id}` }).click();
  await row.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(row).toHaveCount(0);
});

test("the main navigation opens each destination at its own address, and the back button returns", async ({ page }) => {
  await logIn(page);
  const nav = page.getByRole("navigation", { name: "Main" });
  await expect(nav.getByRole("button", { name: "Chats" })).toHaveAttribute("aria-current", "page");
  for (const [name, address] of [
    ["Projects", "#/projects"],
    ["Schedules", "#/schedules"],
    ["Settings", "#/settings"],
    ["Chats", "#/chats"],
  ] as const) {
    await nav.getByRole("button", { name }).click();
    await expect(nav.getByRole("button", { name })).toHaveAttribute("aria-current", "page");
    await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
    expect(new URL(page.url()).hash).toBe(address);
  }
  await page.goBack();
  await expect(nav.getByRole("button", { name: "Settings" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("region", { name: "Setup" })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("heading", { name: "Schedules", level: 1 })).toBeVisible();
  // A reload keeps the destination.
  await page.reload();
  await expect(nav.getByRole("button", { name: "Schedules" })).toHaveAttribute("aria-current", "page");
  // A Settings section address opens Settings.
  await page.goto("/#/settings/appearance");
  await expect(nav.getByRole("button", { name: "Settings" })).toHaveAttribute("aria-current", "page");
});

test("the Chats badge counts the approvals that wait, and the dot says that Eva is online", async ({ page }) => {
  await page.route("**/api/approvals", (route) =>
    route.fulfill({ json: [{ requestId: "r1", sessionId: "s1", toolName: "Bash", summary: "ls" }] }),
  );
  await logIn(page);
  const nav = page.getByRole("navigation", { name: "Main" });
  await expect(nav.getByRole("button", { name: "Chats" })).toContainText("1 approval waits");
  if (test.info().project.name === "desktop") {
    await expect(nav.getByRole("img", { name: "Eva is online" })).toBeVisible();
  }
});

test("the New chat button sits in the list header, and the model menu at the bottom", async ({ page }) => {
  await logIn(page);
  await newChat(page);
  await newChat(page);
  await newChat(page);
  // A short window makes the chat list longer than the screen.
  const viewport = page.viewportSize();
  await page.setViewportSize({ width: viewport?.width ?? 1280, height: 400 });
  await openList(page);
  const sidebar = await page.getByRole("navigation", { name: "Chats" }).boundingBox();
  const model = page.getByLabel("Model for a new chat");
  const button = page.getByRole("button", { name: "New chat", exact: true });
  await expect(model).toBeInViewport();
  await expect(button).toBeInViewport();
  const modelBox = await model.boundingBox();
  const buttonBox = await button.boundingBox();
  const firstChatBox = await page.locator(".sidebar .list-item").first().boundingBox();
  if (sidebar === null || modelBox === null || buttonBox === null || firstChatBox === null) {
    throw new Error("A sidebar part is not on the screen.");
  }
  expect(buttonBox.y).toBeLessThan(firstChatBox.y);
  expect(sidebar.y + sidebar.height - (modelBox.y + modelBox.height)).toBeLessThanOrEqual(24);
  expect(firstChatBox.y).toBeLessThan(modelBox.y);
  // A long list scrolls. It never squeezes a chat until its text is cut.
  const cut = await page
    .locator(".sidebar .list-item")
    .evaluateAll((items) => items.filter((item) => item.scrollHeight > item.clientHeight).length);
  expect(cut).toBe(0);
});

test("the chat list shows each chat's time and last answer, and the search filters it", async ({ page }) => {
  const title = `A chat to find (${test.info().project.name})`;
  await logIn(page);
  await newChat(page);
  const composer = page.getByLabel("Message").first();
  await composer.fill(title);
  await composer.press("Enter");
  await expect(page.locator(".message.answer").first()).toContainText(title);
  await openList(page);
  const today = page.getByRole("region", { name: "Today" });
  const item = today.locator(".list-item[aria-current='true']");
  await expect(item.locator(".chat-item-preview")).toContainText(/Echo \d+:/);
  await expect(item.locator(".chat-item-preview")).toContainText(title);
  await expect(item.locator(".chat-item-time")).toHaveText(/^\d\d:\d\d$/);
  const search = page.getByRole("searchbox", { name: "Search chats" });
  await search.fill("no chat has this title");
  await expect(page.locator(".sidebar .list-item")).toHaveCount(0);
  await expect(page.getByText("No chat matches.")).toBeVisible();
  await search.fill("");
  await expect(page.locator(".sidebar .list-item").first()).toBeVisible();
});

test("a new chat greets with EVE and suggestions, and a tap on one starts the chat", async ({ page }) => {
  await logIn(page);
  await newChat(page);
  const greeting = page.locator(".new-chat");
  await expect(greeting.getByRole("heading", { level: 2 })).toHaveText(/^Good (morning|afternoon|evening)\.$/);
  await expect(greeting).toContainText("How can I help today?");
  await expect(greeting.locator(".mk.e-joy")).toBeVisible();
  const cards = page.getByRole("group", { name: "Suggestions" }).getByRole("button");
  const settings = (await (await page.request.get("/api/settings")).json()) as {
    config: { google: { email: string | null } };
  };
  const googleReady = settings.config.google.email !== null;
  await expect(cards.first()).toBeVisible();
  const visible = await cards.evaluateAll((buttons) => buttons.filter((button) => button.checkVisibility()).length);
  // A phone shows three suggestions. A computer shows the calendar too, when Google is set up.
  expect(visible).toBe(test.info().project.name === "phone" || !googleReady ? 3 : 4);
  await expect(cards.filter({ hasText: "What do I have this week?" })).toHaveCount(googleReady ? 1 : 0);
  // The cards keep the page within the screen, and each is a touch target.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const box = await cards.first().boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);

  await page.getByRole("button", { name: "Summarize yesterday's notes" }).click();
  await expect(page.locator(".message.user").first()).toContainText("Summarize yesterday's notes");
  await expect(page.locator(".message.answer").first()).toContainText(/Echo \d+: Summarize yesterday's notes/);
  await expect(greeting).toHaveCount(0);
});

test("a new chat shows at the top of a scrolled chat list", async ({ page }) => {
  await logIn(page);
  for (let count = 0; count < 8; count++) await newChat(page);
  // A short window makes the chat list longer than the screen.
  const viewport = page.viewportSize();
  await page.setViewportSize({ width: viewport?.width ?? 1280, height: 400 });
  await openList(page);
  await page.locator(".sidebar-list").evaluate((list) => list.scrollTo({ top: list.scrollHeight }));
  // The header stays at the top of the scrolled list, so the click needs no scroll back.
  expect(await page.locator(".sidebar-list").evaluate((list) => list.scrollTop)).toBeGreaterThan(0);
  await expect(page.getByRole("button", { name: "New chat", exact: true })).toBeInViewport();
  const chats = page.locator(".sidebar .list-item");
  const before = await chats.count();
  await page.getByRole("button", { name: "New chat", exact: true }).click();
  // Every chat is called "New chat", so the heading shows before the new chat exists.
  // Wait until the new chat is first and selected: the list scrolls and the phone drawer closes then.
  await expect(chats).toHaveCount(before + 1);
  await expect(chats.first()).toHaveAttribute("aria-current", "true");
  await openList(page);
  // The list clips its items, so the check compares with the list, not with the window.
  // A short list can cut the bottom of the chat. Its top shows that the list is not scrolled away.
  const shown = await page.locator(".sidebar-list").evaluate((list) => {
    const item = list.querySelector('.list-item[aria-current="true"]');
    if (item === null) return false;
    const listBox = list.getBoundingClientRect();
    const itemBox = item.getBoundingClientRect();
    return itemBox.top >= listBox.top && itemBox.top < listBox.bottom;
  });
  expect(shown).toBe(true);
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
  await page.routeWebSocket(/\/api\/events(\?devices)?$/, (socket) => {
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

test("an answer folds its steps into one line, and a tap lists them", async ({ page }) => {
  await logIn(page);
  await newChat(page);
  const composer = page.getByLabel("Message").first();
  await composer.fill("Hello Eva");
  await composer.press("Enter");
  const answer = page.locator(".message.answer").first();
  // The live answer shows its steps open until the turn ends, so wait for the stored one and its Retry button.
  await expect(answer.getByRole("button", { name: "Retry" })).toBeVisible();
  await expect(answer.locator(".answer-body")).toContainText(/Echo \d+: Hello Eva/);
  // The demo turn runs a task, a tool and a command before its one message. The line shows the last one.
  const toggle = answer.getByRole("button", { name: "Show 3 steps" });
  await expect(toggle).toContainText("3 steps");
  await expect(toggle.locator(".steps-last")).toHaveText("ls");
  if (test.info().project.name === "phone") {
    // A finger needs a target of 44 px or more.
    const box = await toggle.boundingBox();
    expect(Math.min(box?.width ?? 0, box?.height ?? 0)).toBeGreaterThanOrEqual(44);
  }
  await toggle.click();
  const steps = answer.getByRole("list", { name: "Steps" });
  await expect(steps.getByRole("listitem")).toHaveText([
    /Task\s+Search the notes/,
    /Tool\s+Grep notes/,
    /Command\s+ls/,
  ]);
  await answer.getByRole("button", { name: "Hide 3 steps" }).click();
  await expect(steps).toHaveCount(0);
});

test("the chat panel shows the context ring, the engine and the model, and a phone opens it from Chat info", async ({
  page,
}) => {
  await logIn(page);
  await newChat(page);
  const composer = page.getByLabel("Message").first();
  await composer.fill("Hello Eva");
  await composer.press("Enter");
  await expect(page.locator(".message.answer").first()).toContainText(/Echo \d+: Hello Eva/);
  if (test.info().project.name === "desktop") {
    const panel = page.getByRole("complementary", { name: "This chat" });
    await expect(panel).toContainText("Claude Code");
    // The engine names its window, so the ring shows a share.
    await expect(panel).toContainText("15 of 200k tokens");
    await expect(panel.getByRole("img", { name: "0% of the context window in use" })).toBeVisible();
    // getByRole skips hidden elements, so count the button by its class.
    await expect(page.locator(".chat-info-button")).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Chat info" })).toBeHidden();
    await panel.getByRole("button", { name: "Fork this chat" }).click();
    await expect(panel).toContainText("1, with 1 fork");
    return;
  }
  await page.getByRole("button", { name: "Chat info" }).click();
  const sheet = page.getByRole("dialog", { name: "This chat" });
  await expect(sheet).toContainText("Assistant");
  await expect(sheet).toContainText("15 of 200k tokens");
  await expect(sheet.getByRole("button", { name: "Close" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
  // A tap on the scrim above the sheet closes it too.
  await page.getByRole("button", { name: "Chat info" }).click();
  await expect(sheet).toBeVisible();
  await page.mouse.click(20, 20);
  await expect(sheet).toHaveCount(0);
});

test("a new message of a running turn replaces the shown one, and the older one becomes a step", async ({ page }) => {
  const sockets = await routeEvents(page);
  await logIn(page);
  const sessionId = await newChat(page);
  const body = page.locator(".message.answer .answer-body");
  sockets.at(-1)?.send(textEvent(sessionId, "first thought"));
  await expect(body).toHaveText("first thought");
  sockets.at(-1)?.send(textEvent(sessionId, "second thought"));
  await expect(body).toHaveText("second thought");
  // A running turn shows its steps open.
  await expect(page.getByRole("list", { name: "Steps" }).getByRole("listitem")).toHaveText([/Message\s+first thought/]);
  // A step keeps a short text, so the whole answer is one tap away.
  await page.getByRole("button", { name: "Show the whole answer" }).click();
  await expect(body).toContainText("first thought");
  await expect(body).toContainText("second thought");
});

test("an approval and a task from while the connection was down still show after the reconnect", async ({ page }) => {
  const sockets: WebSocketRoute[] = [];
  await page.routeWebSocket(/\/api\/events(\?devices)?$/, (socket) => {
    const server = socket.connectToServer();
    // The first connection loses the approval and task events, as a phone does while it sleeps.
    if (sockets.length === 0) {
      server.onMessage((message) => {
        const text = String(message);
        if (!text.includes('"approval_needed"') && !text.includes('"task_changed"')) socket.send(message);
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
  const dialog = page.getByRole("region", { name: "Eva asks for permission" });
  await expect(dialog).toHaveCount(0);
  const runningTask = page.getByRole("button", { name: "1 background task running" });
  await expect(runningTask).toHaveCount(0);

  await sockets[0]?.close();
  await expect(dialog).toContainText("gh issue create");
  await expect(runningTask).toBeVisible();
  await dialog.getByRole("button", { name: "Allow once" }).click();
  await expect(page.locator(".message.answer").first()).toContainText("The person answered: allow");
  // The task ends with its turn.
  await expect(runningTask).toHaveCount(0);
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

test("Settings: Restart Eva in the header names the running chats, then restarts and waits for Eva", async ({
  page,
}) => {
  const restarts: string[] = [];
  await page.route("**/api/restart", async (route) => {
    restarts.push(route.request().method());
    await route.fulfill({ status: 202, json: { restarting: true } });
  });
  await logIn(page);
  const created = (await (await page.request.post("/api/sessions", { data: { mode: "assistant" } })).json()) as {
    id: string;
  };
  await page.request.post(`/api/sessions/${created.id}/rename`, { data: { title: "Plan the trip" } });
  // The demo engine answers at once, so the page sees this chat as running only through a changed status.
  await page.route("**/api/status", async (route) => {
    const response = await route.fetch();
    const status = (await response.json()) as Record<string, unknown>;
    await route.fulfill({ response, json: { ...status, busySessionIds: [created.id] } });
  });
  await openSettings(page, "Updates");
  await page.getByRole("button", { name: "Restart Eva" }).click();
  const question = page.getByRole("alertdialog", { name: "Restart Eva" });
  await expect(question).toContainText('"Plan the trip" is running. A restart stops it. Restart Eva now?');
  await question.getByRole("button", { name: "Cancel" }).click();
  await expect(question).toHaveCount(0);
  expect(restarts).toEqual([]);
  await page.getByRole("button", { name: "Restart Eva" }).click();
  await page.getByRole("alertdialog", { name: "Restart Eva" }).getByRole("button", { name: "Yes, restart" }).click();
  await expect(page.getByText("Eva restarted.")).toBeVisible({ timeout: 10_000 });
  expect(restarts).toEqual(["POST"]);
  await page.request.delete(`/api/sessions/${created.id}`);
});

test("Settings: the setup ring counts the done steps, and a failed test has its own mark", async ({ page }) => {
  await page.route("**/api/settings/setup", async (route) => {
    const response = await route.fetch();
    const setup = (await response.json()) as { progress: { state: string; lastCheck: unknown }[] };
    const progress = setup.progress.map((step, index) =>
      index === 0
        ? { ...step, state: "done", lastCheck: { ok: false, detail: "The token expired.", at: "2026-01-01T00:00:00Z" } }
        : step,
    );
    await route.fulfill({ response, json: { ...setup, progress } });
  });
  await logIn(page);
  await openSettings(page, "Setup");
  const list = page.getByRole("region", { name: "Progress list" });
  await expect(list.getByRole("img", { name: /^\d+ of \d+ steps done$/ })).toBeVisible();
  await expect(list).toContainText(/Setup: \d+ steps? left/);
  const first = list.getByRole("button").filter({ hasText: "Step 1" });
  await expect(first.locator(".status-icon")).toHaveAttribute("aria-label", "Failed");
  await expect(first).toContainText("Last test: The token expired.");
  // A failed step needs the person, so it keeps the main action, and its page says why.
  await expect(first).toContainText("Set up");
  await first.click();
  await expect(page.getByRole("region", { name: "An AI engine" })).toContainText("The last test failed.");
});

test("Settings: the vault step lists the repositories and clones the picked one, with no terminal", async ({
  page,
}) => {
  await page.route("**/api/settings/setup", async (route) => {
    const response = await route.fetch();
    const setup = (await response.json()) as { progress: { key: string }[] };
    const progress = setup.progress.map((step) =>
      step.key === "vault" ? { ...step, state: "missing", detail: "No vault yet." } : step,
    );
    await route.fulfill({ response, json: { ...setup, progress } });
  });
  await page.route("**/api/settings", async (route) => {
    const response = await route.fetch();
    const settings = (await response.json()) as { secretsSet: Record<string, boolean> };
    await route.fulfill({ response, json: { ...settings, secretsSet: { ...settings.secretsSet, githubToken: true } } });
  });
  await page.route("**/api/vault/repositories", (route) =>
    route.fulfill({
      json: [
        { fullName: "you/vault", cloneUrl: "https://github.com/you/vault.git", private: true },
        { fullName: "you/example-app", cloneUrl: "https://github.com/you/example-app.git", private: false },
      ],
    }),
  );
  const cloned: unknown[] = [];
  await page.route("**/api/vault/clone", async (route) => {
    cloned.push(route.request().postDataJSON());
    await route.fulfill({
      json: { folder: "/eva-home/vault", repository: "https://github.com/you/vault.git", problem: null },
    });
  });
  await logIn(page);
  await openSettings(page, "Setup");
  await page
    .getByRole("region", { name: "Progress list" })
    .getByRole("button", { name: /Your vault/ })
    .click();
  const clone = page.getByRole("button", { name: "Clone this vault" });
  await expect(clone).toBeDisabled();
  await page.getByLabel("Your vault's repository").selectOption({ label: "you/vault (private)" });
  await clone.click();
  await expect(page.getByText("Cloned the vault into /eva-home/vault.")).toBeVisible();
  expect(cloned).toEqual([{ repository: "https://github.com/you/vault.git" }]);
  await expect(page.getByRole("button", { name: "Create a new vault" })).toBeVisible();
});

test("Settings: a token saved in the vault step lists the repositories at once", async ({ page }) => {
  await page.route("**/api/settings/setup", async (route) => {
    const response = await route.fetch();
    const setup = (await response.json()) as { progress: { key: string }[] };
    const progress = setup.progress.map((step) =>
      step.key === "vault" ? { ...step, state: "missing", detail: "No vault yet." } : step,
    );
    await route.fulfill({ response, json: { ...setup, progress } });
  });
  await page.route("**/api/vault/repositories", (route) =>
    route.fulfill({ json: [{ fullName: "you/vault", cloneUrl: "https://github.com/you/vault.git", private: true }] }),
  );
  await logIn(page);
  await openSettings(page, "Setup");
  await page
    .getByRole("region", { name: "Progress list" })
    .getByRole("button", { name: /Your vault/ })
    .click();
  await expect(page.getByRole("button", { name: "Open the GitHub step" })).toBeVisible();
  await page.getByLabel("GitHub token", { exact: true }).fill("ghp_e2e-vault-step-token");
  await page.getByRole("button", { name: "Save the GitHub token" }).click();
  await expect(page.getByLabel("Your vault's repository")).toBeVisible();
  await expect(page.getByLabel("Name of the new private repository")).toHaveValue("vault");
  await page.request.delete("/api/secrets/githubToken");
});

test("Settings: a vault step that cannot list the repositories leads to the GitHub step", async ({ page }) => {
  await page.route("**/api/settings/setup", async (route) => {
    const response = await route.fetch();
    const setup = (await response.json()) as { progress: { key: string }[] };
    const progress = setup.progress.map((step) =>
      step.key === "vault" ? { ...step, state: "missing", detail: "No vault yet." } : step,
    );
    await route.fulfill({ response, json: { ...setup, progress } });
  });
  await page.route("**/api/settings", async (route) => {
    const response = await route.fetch();
    const settings = (await response.json()) as { secretsSet: Record<string, boolean> };
    await route.fulfill({ response, json: { ...settings, secretsSet: { ...settings.secretsSet, githubToken: true } } });
  });
  await page.route("**/api/vault/repositories", (route) =>
    route.fulfill({
      status: 409,
      json: { error: "GitHub refused the request (HTTP 401): Bad credentials", code: "github_failed" },
    }),
  );
  await logIn(page);
  await openSettings(page, "Setup");
  await page
    .getByRole("region", { name: "Progress list" })
    .getByRole("button", { name: /Your vault/ })
    .click();
  await expect(page.getByText("Bad credentials")).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  await page.getByRole("button", { name: "Open the GitHub step" }).click();
  await expect(page.getByRole("region", { name: "GitHub", exact: true }).first()).toBeVisible();
});

test("Settings: Update to a version shows each newer release, warns on a major one, and installs it", async ({
  page,
}) => {
  const status = {
    kind: "executable",
    frequency: "daily",
    install: "minor",
    phase: "idle",
    current: "0.2.0",
    latest: "1.0.0",
    available: true,
    target: "0.3.0",
    heldBack: "1.0.0",
    releases: [
      {
        version: "1.0.0",
        notes: "",
        level: "major",
        summary: "Breaking changes:\n• feat!: rename the keys (1.0.0)\n\nNew features:\n• feat: voice notes (0.3.0)",
      },
      { version: "0.3.0", notes: "", level: "minor", summary: "New features:\n• feat: voice notes (0.3.0)" },
    ],
    lastCheckAt: null,
    lastError: null,
    failedStep: null,
  };
  const installs: unknown[] = [];
  await page.route("**/api/update/check", async (route) => {
    await route.fulfill({ json: status });
  });
  await page.route("**/api/update", async (route) => {
    if (route.request().method() === "POST") installs.push(route.request().postDataJSON());
    await route.fulfill({ json: status });
  });
  await logIn(page);
  await openSettings(page, "Updates");
  await expect(page.getByText("1.0.0 is held back by the update policy (minor)")).toBeVisible();
  await page.getByRole("button", { name: "Update to a version…" }).click();
  const dialog = page.getByRole("dialog", { name: "Update to a version" });
  await dialog.getByRole("combobox").press("Escape");
  await expect(dialog).toHaveCount(0);
  await page.getByRole("button", { name: "Update to a version…" }).click();
  await expect(dialog.getByRole("alert")).toContainText("It can break things");
  await expect(dialog.getByText("feat!: rename the keys (1.0.0)")).toBeVisible();
  await dialog.getByRole("combobox").selectOption("0.3.0");
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await dialog.getByRole("button", { name: "Install 0.3.0" }).click();
  await expect.poll(() => installs).toEqual([{ version: "0.3.0" }]);
  await expect(dialog).toHaveCount(0);
});

test("Settings: the major update policy shows a warning", async ({ page }) => {
  await logIn(page);
  await openSettings(page, "Updates");
  await expect(page.getByText("With this choice, Eva installs it by herself.")).toHaveCount(0);
  await page.getByLabel("Eva installs by herself").selectOption("major");
  await expect(page.getByText("With this choice, Eva installs it by herself.")).toBeVisible();
  await page.getByLabel("Eva installs by herself").selectOption("minor");
});

test("Settings: Check and install waits until the new Eva answers, not the old one", async ({ page }) => {
  const base = {
    kind: "executable",
    frequency: "daily",
    install: "minor",
    current: "0.1.0",
    latest: "0.2.0",
    target: "0.2.0",
    heldBack: null,
    releases: [],
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
  await openSettings(page, "Updates");
  await page.getByRole("button", { name: "Check and install" }).click();
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
  await openSettings(page, "Updates");
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
  await openSettings(page, "Updates");
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
    const iconBox = await page.getByRole("button", { name: "Show the list" }).boundingBox();
    expect(iconBox?.width ?? 0).toBeGreaterThanOrEqual(44);
    await page.getByRole("button", { name: "Close the list" }).click({ position: { x: 360, y: 200 } });
    await expect(sidebar).toBeHidden();
  });

  test("the tab bar sits at the bottom, with a label under each icon, and needs no drawer", async ({ page }) => {
    await logIn(page);
    const tabs = page.getByRole("navigation", { name: "Main" });
    const box = await tabs.boundingBox();
    expect((box?.y ?? 0) + (box?.height ?? 0)).toBe(page.viewportSize()?.height);
    await expect(tabs.getByText("Schedules", { exact: true })).toBeVisible();
    await tabs.getByRole("button", { name: "Settings" }).click();
    await expect(page.getByRole("button", { name: "Show the list" })).toBeHidden();
    await expect(page.getByRole("region", { name: "Setup" })).toBeVisible();
    await tabs.getByRole("button", { name: "Projects", exact: true }).click();
    // The project list stays one tap away in its drawer. Wait for the menu button: openList only
    // checks it once, and the Projects page may not have drawn it yet.
    const menu = page.getByRole("button", { name: "Show the list" });
    await expect(menu).toBeVisible();
    await menu.click();
    await expect(page.getByRole("navigation", { name: "Projects" })).toBeVisible();
  });

  test("on Settings too, every button is at least 44 px tall and nothing is wider than the screen", async ({
    page,
  }) => {
    await logIn(page);
    await openSettings(page);
    // The side list is for a wide screen: a phone opens each section from its card, and goes back with Back.
    await expect(page.getByRole("navigation", { name: "Settings sections" })).toBeHidden();
    const pages = [
      "#/settings",
      "#/settings/setup",
      "#/settings/setup/engine",
      "#/settings/setup/remoteAccess",
      "#/settings/engines",
      "#/settings/vault",
      "#/settings/connections",
      "#/settings/access",
      "#/settings/personalize",
      "#/settings/updates",
    ];
    for (const hash of pages) {
      await page.evaluate((next) => (window.location.hash = next), hash);
      await expect(page.locator(".settings-page .card").first()).toBeVisible();
      const heights = await page
        .locator("button:visible, select:visible, .link-list a:visible, a.button-link:visible")
        .evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().height));
      expect(Math.min(...heights), hash).toBeGreaterThanOrEqual(44);
      expect(await page.evaluate(() => document.documentElement.scrollWidth), hash).toBeLessThanOrEqual(375);
    }
    await page.getByRole("button", { name: "Back" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Settings");
  });

  test("the composer sits at the bottom of the screen, just above the tab bar", async ({ page }) => {
    await logIn(page);
    await newChat(page);
    // The whole composer card, not only its text box: the chips and the Send button sit under the text.
    const box = await page.locator(".composer-box").first().boundingBox();
    const tabs = await page.getByRole("navigation", { name: "Main" }).boundingBox();
    expect((box?.y ?? 0) + (box?.height ?? 0)).toBeGreaterThan((tabs?.y ?? 0) - 40);
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

test("Project details: change, clear and save the fields, then the whole AGENTS.md", async ({ page }) => {
  const run = test.info().project.name;
  await logIn(page);
  await page.getByRole("button", { name: "Projects", exact: true }).click();
  await openList(page);
  await page.getByLabel("Status").selectOption("");
  await page.getByRole("button", { name: new RegExp(`Draft ${run}`) }).click();
  await page.getByRole("button", { name: "Project details" }).click();
  await expect(page.getByRole("heading", { name: `Draft ${run} · Details` })).toBeVisible();
  await expect(page.getByText("Created 2025-05-01T08:00")).toBeVisible();

  await page.getByLabel("Title").fill(`Renamed ${run}`);
  await page.getByLabel("Project status").selectOption("active");
  await page.getByLabel("Add a tag").fill("ideas");
  await page.getByRole("button", { name: "Add the tag" }).click();
  await page.getByLabel("Add a repository").fill("https://github.com/example-owner/draft");
  await page.getByRole("button", { name: "Save details" }).click();
  await expect(page.getByRole("status")).toHaveText("Saved.");
  const file = page.getByLabel("AGENTS.md");
  await expect(file).toHaveValue(/status: active # idea, active, paused or closed/);
  await expect(file).toHaveValue(/# Renamed/);

  if (run === "phone") {
    const heights = await page
      .locator("main button:visible, main select:visible, main input:visible")
      .evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().height));
    expect(Math.min(...heights)).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  }

  // The whole file waits while the form has a change, so a save cannot drop that change.
  await page.getByLabel("Title").fill(`Renamed ${run} again`);
  await expect(page.getByRole("button", { name: "Save the file" })).toBeDisabled();
  await expect(page.getByLabel("AGENTS.md")).toBeDisabled();
  await page.getByLabel("Title").fill(`Renamed ${run}`);
  await expect(page.getByRole("button", { name: "Save the file" })).toBeEnabled();

  await page.getByRole("button", { name: "Remove the tag ideas" }).click();
  await page.getByRole("button", { name: "Save details" }).click();
  await expect(page.getByRole("status")).toHaveText("Saved.");
  await expect(file).not.toHaveValue(/ideas/);

  // The whole file waits while the form has a change, and the form waits for the whole file.
  await file.fill(`${await file.inputValue()}\nDraft line.\n`);
  await expect(page.getByRole("button", { name: "Save details" })).toBeDisabled();
  await page.getByRole("button", { name: "Load again" }).click();
  await expect(file).not.toHaveValue(/Draft line/);

  // Another device saves meanwhile: this page's save is refused, and says so.
  const projectId = `2025-05-01-0800-${run}-draft`;
  await page.evaluate(async (id) => {
    const path = `/api/projects/${id}/file`;
    const { text, version } = (await (await fetch(path)).json()) as { text: string; version: string };
    await fetch(path, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ version, text: `${text}\nFrom another device.\n` }),
    });
  }, projectId);
  await page.getByLabel("Title").fill(`Clash ${run}`);
  await page.getByRole("button", { name: "Save details" }).click();
  await expect(page.getByRole("alert")).toContainText("The file changed since you opened it");
  await page.getByRole("button", { name: "Load again" }).click();
  await expect(file).toHaveValue(/From another device/);
  await expect(page.getByLabel("Title")).toHaveValue(`Renamed ${run}`);

  await file.fill(`${await file.inputValue()}\nMore notes.\n`);
  await page.getByRole("button", { name: "Save the file" }).click();
  await expect(page.getByRole("status")).toHaveText("Saved.");
  await openList(page);
  await expect(page.getByRole("button", { name: new RegExp(`Renamed ${run}`) })).toBeVisible();
});

test("Settings: Google sets up from the page, with a pasted login and a Test", async ({ page }) => {
  await logIn(page);
  await openSettings(page, "Connections");
  await expect(page.getByRole("link", { name: "Google Calendar API" })).toBeVisible();
  for (const [label, value] of [
    ["Google client id", "client-id.apps.googleusercontent.com"],
    ["Google client secret", "GOCSPX-e2e-client-secret-value"],
  ] as const) {
    await page.getByLabel(label, { exact: true }).fill(value);
    await page.getByRole("button", { name: `Save the ${label}` }).click();
    await expect(page.getByText(`A ${label} is saved.`)).toBeVisible();
  }
  await page.getByRole("button", { name: "Start the Google login" }).click();
  const consent = (await page.getByRole("link", { name: "Open Google's page" }).getAttribute("href")) ?? "";
  // The fake Google allows at once: the browser lands on the address that does not load.
  const state = new URL(consent).searchParams.get("state") ?? "";
  await page
    .getByLabel("The address after the Google login")
    .fill(`http://127.0.0.1/eva-google-login?state=${state}&code=e2e-code&scope=openid`);
  await page.getByRole("button", { name: "Finish" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Logged in to Google as person@example.com." }),
  ).toBeVisible();
  await expect(page.getByText("Account: person@example.com")).toBeVisible();
  const googleRow = page.locator(".check-row", { hasText: "Test Google" });
  await googleRow.getByRole("button", { name: "Test" }).click();
  await expect(googleRow.getByRole("img", { name: "Passed" })).toBeVisible();
  await expect(googleRow).toContainText("Eva can read Calendar, Drive, Contacts and Tasks of person@example.com.");
});

// Emoji and symbol marks look different on each system and ignore the theme colours (#164).
const symbolMark = /[\p{Extended_Pictographic}\u2190-\u21ff\u2300-\u23ff\u2460-\u27bf\u2b00-\u2bff]/u;

async function expectNoSymbolMarks(page: Page): Promise<void> {
  expect(await page.locator("body").innerText()).not.toMatch(symbolMark);
}

test("each page shows line icons, never an emoji or a symbol mark", async ({ page }) => {
  await logIn(page);
  await openList(page);
  await expect(page.getByRole("button", { name: "Schedules" }).locator("svg.icon")).toBeVisible();
  await expectNoSymbolMarks(page);
  await page.getByRole("button", { name: "Schedules" }).click();
  await expect(page.getByRole("heading", { name: "Schedules", level: 1 })).toBeVisible();
  await expectNoSymbolMarks(page);
  await page.getByRole("button", { name: "Projects", exact: true }).click();
  await expect(page.getByRole("button", { name: "Projects", exact: true })).toHaveAttribute("aria-current", "page");
  await expectNoSymbolMarks(page);
  await openSettings(page, "Setup");
  await expect(page.getByRole("region", { name: "Progress list" })).toBeVisible();
  await expectNoSymbolMarks(page);
  await openSettings(page, "Vault and sync");
  const vaultRow = page.locator(".check-row", { hasText: "Vault repository" });
  await vaultRow.getByRole("button", { name: "Test" }).click();
  await expect(vaultRow.getByRole("img", { name: "Passed" })).toBeVisible();
  await expectNoSymbolMarks(page);
});

test("device login: an open page shows a new device's code, and Allow answers it", async ({ page }) => {
  const answers: unknown[] = [];
  // The demo server has no Tailscale, so the browser plays the server's side of the request.
  await page.route("**/api/devices/requests", (route) =>
    route.fulfill({
      json: [{ id: "request-3", code: "R4WZ", account: "owner@example.com", expiresAt: "2099-01-01T00:00:00.000Z" }],
    }),
  );
  await page.route("**/api/devices/requests/request-3", async (route) => {
    answers.push(route.request().postDataJSON());
    await route.fulfill({ status: 204 });
  });
  await logIn(page);
  const dialog = page.getByRole("dialog", { name: "New device" });
  await expect(dialog).toContainText("A new device wants to get in. Allow it?");
  await expect(dialog).toContainText("R4WZ");
  await dialog.getByRole("button", { name: "Allow" }).click();
  await expect(dialog).toHaveCount(0);
  expect(answers).toEqual([{ answer: "allow" }]);
});

test("Settings: the device list marks this device, and Remove logs out another one", async ({ page }) => {
  let devices = [
    {
      id: "aaaaaaaaaaaaaaaa",
      label: "owner@example.com, a phone",
      createdAt: "2026-10-17T10:00:00.000Z",
      current: false,
    },
    {
      id: "bbbbbbbbbbbbbbbb",
      label: "owner@example.com, a laptop",
      createdAt: "2026-10-17T11:00:00.000Z",
      current: true,
    },
  ];
  const removed: string[] = [];
  await page.route("**/api/devices", (route) => route.fulfill({ json: devices }));
  await page.route("**/api/devices/aaaaaaaaaaaaaaaa", async (route) => {
    removed.push(route.request().method());
    devices = devices.filter((device) => device.id !== "aaaaaaaaaaaaaaaa");
    await route.fulfill({ status: 204 });
  });
  await logIn(page);
  await openSettings(page, "Access");
  const list = page.getByRole("list", { name: "Devices" });
  await expect(list.getByRole("listitem")).toHaveCount(2);
  await expect(list.getByRole("listitem").nth(1)).toContainText("This device");
  page.once("dialog", (dialog) => void dialog.accept());
  await list.getByRole("listitem").first().getByRole("button", { name: "Remove" }).click();
  await expect(list.getByRole("listitem")).toHaveCount(1);
  expect(removed).toEqual(["DELETE"]);
});

test("a page whose login ended shows the login view when its socket drops", async ({ page }) => {
  let events: WebSocketRoute | null = null;
  let ended = false;
  await page.routeWebSocket("**/api/events*", (route) => {
    // A removed device can never open the socket again.
    if (ended) {
      void route.close();
      return;
    }
    route.connectToServer();
    events = route;
  });
  await logIn(page);
  await expect.poll(() => events !== null).toBe(true);
  // Another device removed this one: the server closes the socket, and each call gets 401.
  ended = true;
  await page.route("**/api/sessions", (route) =>
    route.fulfill({ status: 401, json: { error: "A valid token is required." } }),
  );
  await (events as WebSocketRoute | null)?.close();
  await expect(page.getByRole("button", { name: "Log in" })).toBeVisible();
});

test("Settings: removing this device logs this browser out", async ({ page }) => {
  await page.route("**/api/devices", (route) =>
    route.fulfill({
      json: [
        {
          id: "cccccccccccccccc",
          label: "owner@example.com, this browser",
          createdAt: "2026-10-17T10:00:00.000Z",
          current: true,
        },
      ],
    }),
  );
  await page.route("**/api/devices/cccccccccccccccc", (route) => route.fulfill({ status: 204 }));
  await logIn(page);
  await openSettings(page, "Access");
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("list", { name: "Devices" }).getByRole("button", { name: "Remove" }).click();
  await expect(page.getByRole("button", { name: "Log in" })).toBeVisible();
});

test("Settings: Claude Code logs in from the page, with a pasted code", async ({ page }) => {
  const codes: string[] = [];
  let refuse = true;
  await page.route("**/api/engines/claude-code/login", (route) =>
    route.fulfill({ json: { url: "https://claude.com/cai/oauth/authorize?code=true&state=e2e-state" } }),
  );
  await page.route("**/api/engines/claude-code/login/finish", async (route) => {
    codes.push((route.request().postDataJSON() as { code: string }).code);
    if (refuse) {
      refuse = false;
      await route.fulfill({
        status: 409,
        json: {
          error: 'Claude did not accept the code. Press "Log in to Claude" to try again.',
          code: "claude_login_failed",
        },
      });
      return;
    }
    await route.fulfill({ json: { restartNeeded: true } });
  });
  await logIn(page);
  await openSettings(page, "AI engines");
  await page.getByRole("button", { name: "Log in to Claude" }).click();
  await expect(page.getByRole("link", { name: "Open Claude's page" })).toHaveAttribute(
    "href",
    "https://claude.com/cai/oauth/authorize?code=true&state=e2e-state",
  );
  const code = page.getByLabel("The code from Claude's page");
  await code.fill("wrong-code");
  await page.getByRole("button", { name: "Finish" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Claude did not accept the code." })).toBeVisible();
  // The refused code ended the login, so its link goes, and a new login starts.
  await expect(page.getByRole("link", { name: "Open Claude's page" })).toBeHidden();
  await page.getByRole("button", { name: "Log in to Claude" }).click();
  await expect(page.getByRole("link", { name: "Open Claude's page" })).toBeVisible();
  await code.fill("two words");
  await expect(page.getByRole("button", { name: "Finish" })).toBeDisabled();
  await code.fill("e2e-code#e2e-state");
  await page.getByRole("button", { name: "Finish" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Logged in to Claude." })).toBeVisible();
  expect(codes).toEqual(["wrong-code", "e2e-code#e2e-state"]);
  // The token stays the way that needs a terminal, one tap away.
  await page.getByRole("button", { name: "Get a token in a terminal instead" }).click();
  await expect(page.getByText("claude setup-token").first()).toBeVisible();
  await expect(page.getByText("The pi login needs a terminal on Eva's computer")).toBeVisible();
});
