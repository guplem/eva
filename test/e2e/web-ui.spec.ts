import { expect, test, type Locator, type Page, type WebSocketRoute } from "@playwright/test";

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

/** Opens the page of the Example app project in Project mode. */
async function openExampleApp(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Project" }).click();
  await openList(page);
  await page.getByLabel("Search projects").fill("example");
  await page.getByRole("button", { name: /Example app/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Example app" })).toBeVisible();
}

/** Clones the project's repository with "New clone", and gives the card of the new clone. */
async function newCloneCard(page: Page): Promise<Locator> {
  const cards = page.locator(".clone-card");
  // The clones load after the page opens, so wait for the cards or for the empty text first.
  await expect(cards.first().or(page.locator("main").getByText(/^No clones yet\./))).toBeVisible();
  const before = await cards.count();
  await page.getByRole("button", { name: "New clone" }).click();
  await expect(cards).toHaveCount(before + 1);
  // The clones sort by number, so the new one is the last.
  return cards.last();
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
  await expect(dialog).toContainText("ended");
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
  await page.getByRole("button", { name: "Assistant" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(second);
  expect(new URL(page.url()).hash).toBe("");
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
  const chatId = await chatIdNamed(page, await newAnsweredChat(page, "A chat that goes"));
  await waitUntilIdle(page, chatId);
  expect((await page.request.delete(`/api/sessions/${chatId}`)).status()).toBe(200);
  await page.goto(`/#/chat/${chatId}`);
  await expect(page.getByRole("alert")).toContainText("That chat no longer exists.");
  expect(new URL(page.url()).hash).toBe("");
});

test("the address #/chat/<id> opens a Project chat in its clone", async ({ page }) => {
  const title = `Linked project work (${test.info().project.name})`;
  await logIn(page);
  await openExampleApp(page);
  await (await newCloneCard(page)).getByRole("button", { name: "New chat here" }).click();
  const composer = page.getByLabel("Message").first();
  await composer.fill(title);
  await composer.press("Enter");
  // Only the first chat in a new clone asks for trust; both screen sizes share one demo server.
  const answer = page.locator(".message.answer").first();
  const trustQuestion = page.getByRole("dialog", { name: "Approval" });
  await Promise.race([answer.waitFor(), trustQuestion.waitFor()]);
  if (await trustQuestion.isVisible()) await trustQuestion.getByRole("button", { name: "Deny" }).click();
  await expect(answer).toContainText(title);
  const chatId = await chatIdNamed(page, title);

  await page.goto("/");
  await expect(page.getByRole("button", { name: "Assistant" })).toHaveAttribute("aria-pressed", "true");
  await page.goto(`/#/chat/${chatId}`);
  await expect(page.getByRole("button", { name: "Project" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".message.user").first()).toContainText(title);
  await expect(page.getByText("Project mode")).toBeVisible();
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
  await openExampleApp(page);
  await expect(page.getByText("Projects/2025-03-02-1015-example-app")).toBeVisible();
  await expect(page.getByText("A web app for the client portal.")).toBeVisible();
  const card = await newCloneCard(page);
  const cloneName = ((await card.getAttribute("aria-label")) ?? "").replace("Clone ", "");
  await expect(card).toContainText("main");
  await expect(card.locator(".pill", { hasText: "Clean" })).toBeVisible();
  await card.getByRole("button", { name: "New chat here" }).click();
  await expect(page.locator(".main-header .sub")).toHaveText(`Example app › ${cloneName} · main`);
  await expect(page.getByText("Project mode")).toBeVisible();
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
  await page.getByRole("button", { name: "Example app", exact: true }).click();
  await page
    .getByRole("region", { name: `Clone ${cloneName}` })
    .getByRole("button", { name: "New chat here" })
    .click();
  await expect(page.getByText("Project mode")).toBeVisible();
  if (test.info().project.name === "desktop") {
    await expect(page.getByRole("complementary", { name: "This chat" })).toContainText(
      "Nothing runs in the background.",
    );
  }
});

test("a clone card lists all its chats, and a new chat starts in a clone that has one", async ({ page }) => {
  await logIn(page);
  await openExampleApp(page);
  const card = await newCloneCard(page);
  const cloneName = ((await card.getAttribute("aria-label")) ?? "").replace("Clone ", "");
  await card.getByRole("button", { name: "New chat here" }).click();
  await expect(page.getByText("Project mode")).toBeVisible();
  await page.getByRole("button", { name: "Example app", exact: true }).click();
  const sameCard = page.getByRole("region", { name: `Clone ${cloneName}` });
  await expect(sameCard.locator(".clone-chat")).toHaveCount(1);
  await sameCard.getByRole("button", { name: "New chat here" }).click();
  await page.getByRole("button", { name: "Example app", exact: true }).click();
  await expect(sameCard.locator(".clone-chat")).toHaveCount(2);
  await sameCard.locator(".clone-chat").last().click();
  await expect(page.locator(".main-header .sub")).toContainText(cloneName);
});

test("Project mode: the repository setup shows each item's light and copies its fix", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await logIn(page);
  await openExampleApp(page);
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
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Example app" })).toBeVisible();
});

test("the status chips hide a closed project until a tap clears the filter", async ({ page }) => {
  await logIn(page);
  await page.getByRole("button", { name: "Project" }).click();
  await openList(page);
  const active = page.getByRole("group", { name: "Status" }).getByRole("button", { name: "Active" });
  await expect(active).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: /Old tool/ })).toHaveCount(0);
  await active.click();
  await expect(active).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("button", { name: /Old tool/ })).toBeVisible();
  await page.getByRole("group", { name: "Status" }).getByRole("button", { name: "Closed" }).click();
  await expect(page.getByRole("button", { name: /Old tool/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Example app/ })).toHaveCount(0);
  // A status word typed in the search wins over the chip.
  await active.click();
  await page.getByLabel("Search projects").fill("status:closed");
  await expect(page.getByRole("button", { name: /Old tool/ })).toBeVisible();
});

test("the tag chips show only the projects with that tag", async ({ page }) => {
  await logIn(page);
  await page.getByRole("button", { name: "Project" }).click();
  await openList(page);
  await page.getByRole("group", { name: "Status" }).getByRole("button", { name: "Active" }).click();
  await expect(page.getByRole("button", { name: /Old tool/ })).toBeVisible();
  const web = page.getByRole("group", { name: "Tag" }).getByRole("button", { name: "#web" });
  await web.click();
  await expect(page.getByRole("button", { name: /Example app/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Old tool/ })).toHaveCount(0);
  await web.click();
  await expect(page.getByRole("button", { name: /Old tool/ })).toBeVisible();
  // A tag word typed in the search wins over the chip.
  await web.click();
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

test("on a phone, the project list is the page, and Back to the list returns to it", async ({ page }) => {
  test.skip(test.info().project.name !== "phone", "This check is for the phone size only.");
  await logIn(page);
  await page.getByRole("button", { name: "Project" }).click();
  // No tap on the menu: with no project open, the list is already on the screen.
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Example app/ })).toBeVisible();
  const heights = await page
    .locator("button:visible")
    .evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().height));
  expect(Math.min(...heights)).toBeGreaterThanOrEqual(44);
  await page.getByRole("button", { name: /Example app/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Example app" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  await page.getByRole("button", { name: "Back to the list" }).click();
  await expect(page.getByRole("button", { name: /Example app/ })).toBeVisible();
});

test("Settings: the vault Test button checks the remote, and Log out ends the session", async ({ page }) => {
  await logIn(page);
  await page.getByRole("button", { name: "Settings" }).click();
  const vaultRow = page.locator(".check-row", { hasText: "Vault repository" });
  await vaultRow.getByRole("button", { name: "Test" }).click();
  await expect(vaultRow.getByRole("img", { name: "Passed" })).toBeVisible();
  await page.getByRole("button", { name: "Log out", exact: true }).click();
  await expect(page.getByRole("button", { name: "Log in" })).toBeVisible();
});

test("Settings: the rules for chat names save with Save and load again (issue 50)", async ({ page }) => {
  await logIn(page);
  await page.getByRole("button", { name: "Settings" }).click();
  try {
    await page.getByLabel("Rules for chat names").fill("Lead every name with an emoji.");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Saved." })).toBeVisible();
    await page.reload();
    await page.getByRole("button", { name: "Settings" }).click();
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
  await page.getByRole("button", { name: "Settings" }).click();
  const section = page.getByRole("group", { name: "Use Eva from any device" });
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
  await page.getByRole("button", { name: "Settings" }).click();
  page.once("dialog", (dialog) => void dialog.accept());
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
  await expect(claudeRow.getByRole("img", { name: "Passed" })).toBeVisible();
  await expect(claudeRow).toContainText("Claude Code answered:");
  const piRow = page.locator(".check-row", { hasText: "Test pi" });
  await piRow.getByRole("button", { name: "Test" }).click();
  // The demo server has only the scripted Claude Code engine.
  await expect(piRow.getByRole("img", { name: "Failed" })).toBeVisible();
  await expect(piRow).toContainText("Eva did not find pi on this machine.");
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
  await page.getByRole("button", { name: "Settings" }).click();
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
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByLabel("Theme").selectOption("dark");
  await page.getByLabel("Density").selectOption("compact");
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
  await page.getByRole("button", { name: "Settings" }).click();
  const colours = page.getByRole("group", { name: "Colour" });
  await expect(colours.getByRole("button")).toHaveCount(15);
  await expect(colours.getByRole("button", { name: "EVE" })).toHaveAttribute("aria-pressed", "true");
  await colours.getByRole("button", { name: "Violet" }).click();
  await expect(colours.getByRole("button", { name: "Violet" })).toHaveAttribute("aria-pressed", "true");
  await expect(colours.getByRole("button", { name: "EVE" })).toHaveAttribute("aria-pressed", "false");
  expect(await accent()).not.toBe(before);
  await page.getByLabel("Any colour").fill("#123abc");
  await expect(page.getByText("#123ABC")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("group", { name: "Mode" })).toBeVisible();
  await page.getByRole("button", { name: "Settings" }).click();
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

test("device login: a browser shows its code and how to allow it, then opens", async ({ page, context, baseURL }) => {
  let polls = 0;
  // The demo server has no Tailscale, so the browser plays the server's side of the device login.
  await page.route("**/api/login/device", (route) =>
    route.fulfill({
      status: 201,
      json: {
        id: "request-1",
        code: "K7QX",
        account: "owner@example.com",
        expiresAt: "2099-01-01T00:00:00.000Z",
        approvers: ["Telegram", "terminal", "Eva page"],
      },
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
  await expect(page.getByText("Confirm this device")).toBeVisible();
  await expect(page.getByText("eva devices allow K7QX")).toBeVisible();
  await expect(page.getByText("Or tap Allow in your Telegram chat")).toBeVisible();
  await expect(page.getByText("Or tap Allow on an Eva page")).toBeVisible();
  await expect(page.getByRole("group", { name: "Mode" })).toBeVisible();
});

test("device login: with no approver, the page says why and asks for the token", async ({ page }) => {
  await page.route("**/api/login/device", (route) =>
    route.fulfill({ status: 409, json: { error: "Nothing on this machine can confirm a new device." } }),
  );
  await page.goto("/");
  await expect(page.getByRole("status")).toHaveText("Nothing on this machine can confirm a new device.");
  await expect(page.getByLabel(/Token/)).toBeVisible();
});

test("device login: a denied request offers to ask again", async ({ page }) => {
  await page.route("**/api/login/device", (route) =>
    route.fulfill({
      status: 201,
      json: {
        id: "request-2",
        code: "M3PT",
        account: "owner@example.com",
        expiresAt: "2099-01-01T00:00:00.000Z",
        approvers: ["terminal"],
      },
    }),
  );
  await page.route("**/api/login/device/request-2", (route) => route.fulfill({ json: { state: "denied" } }));
  await page.goto("/");
  await expect(page.getByRole("status")).toHaveText("The request was denied.");
  await expect(page.getByRole("button", { name: "Ask again" })).toBeVisible();
});

test("Settings: the progress list shows each step, and keeps the last Test result", async ({ page }) => {
  await logIn(page);
  // The demo has no allowed device yet, so at least that step is left.
  await expect(page.getByRole("button", { name: /Settings/ })).toContainText("to set up");
  await page.getByRole("button", { name: "Settings" }).click();
  const list = page.getByRole("group", { name: "Progress list" });
  await expect(list).toContainText("Your devices");
  await expect(list).toContainText("eva devices allow");
  await list.getByRole("button", { name: "Test Your vault" }).click();
  await expect(list).toContainText("Last test:");
});

test("Settings: a token saved on the page shows at once in the progress list", async ({ page }) => {
  await logIn(page);
  await page.request.delete("/api/secrets/githubToken");
  await page.getByRole("button", { name: "Settings" }).click();
  const list = page.getByRole("group", { name: "Progress list" });
  await expect(list).not.toContainText("The token is saved.");
  await page.getByLabel("GitHub token", { exact: true }).fill("ghp_e2e-progress-token");
  await page.getByRole("button", { name: "Save the GitHub token" }).click();
  await expect(list).toContainText("The token is saved.");
  await expect(list).toContainText("Eva uses the new tokens after a restart.");
  await page.request.delete("/api/secrets/githubToken");
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

test("the model menu and the New chat button sit at the bottom of the chat list, apart", async ({ page }) => {
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
  expect(sidebar.y + sidebar.height - (buttonBox.y + buttonBox.height)).toBeLessThanOrEqual(24);
  // The footer gap is 16 px. The margin of 1 px allows for a rounded layout.
  expect(buttonBox.y - (modelBox.y + modelBox.height)).toBeGreaterThanOrEqual(15);
  expect(firstChatBox.y).toBeLessThan(modelBox.y);
  // A long list scrolls. It never squeezes a chat until its text is cut.
  const cut = await page
    .locator(".sidebar .list-item")
    .evaluateAll((items) => items.filter((item) => item.scrollHeight > item.clientHeight).length);
  expect(cut).toBe(0);
});

test("a new chat shows at the top of a scrolled chat list", async ({ page }) => {
  await logIn(page);
  for (let count = 0; count < 8; count++) await newChat(page);
  // A short window makes the chat list longer than the screen.
  const viewport = page.viewportSize();
  await page.setViewportSize({ width: viewport?.width ?? 1280, height: 400 });
  await openList(page);
  await page.locator(".sidebar-list").evaluate((list) => list.scrollTo({ top: list.scrollHeight }));
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

test("an answer shows its steps as badges with a hover text, and a tap lists them", async ({ page }) => {
  await logIn(page);
  await newChat(page);
  const composer = page.getByLabel("Message").first();
  await composer.fill("Hello Eva");
  await composer.press("Enter");
  const answer = page.locator(".message.answer").first();
  // The live answer has the same badges until the turn ends, so wait for the stored one and its Retry button.
  await expect(answer.getByRole("button", { name: "Retry" })).toBeVisible();
  await expect(answer.locator(".answer-body")).toContainText(/Echo \d+: Hello Eva/);
  // The demo turn runs a task, a tool and a command before its one message.
  const toggle = answer.getByRole("button", { name: "Show 3 steps" });
  await expect(answer.locator(".step-badge")).toHaveCount(3);
  await expect(answer.locator('.step-badge[title="Command: ls"]')).toBeVisible();
  if (test.info().project.name === "phone") {
    // A finger needs a target of 44 px or more, also for a row of one small badge.
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

test("the chat panel shows the model, engine and context, and a phone opens it from Chat info", async ({ page }) => {
  await logIn(page);
  await newChat(page);
  const composer = page.getByLabel("Message").first();
  await composer.fill("Hello Eva");
  await composer.press("Enter");
  await expect(page.locator(".message.answer").first()).toContainText(/Echo \d+: Hello Eva/);
  if (test.info().project.name === "desktop") {
    const panel = page.getByRole("complementary", { name: "This chat" });
    await expect(panel).toContainText("claude-code");
    await expect(panel).toContainText("15 tokens");
    // getByRole skips hidden elements, so count the button by its class.
    await expect(page.locator(".chat-info-button")).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Chat info" })).toBeHidden();
    return;
  }
  await page.getByRole("button", { name: "Chat info" }).click();
  const dialog = page.getByRole("dialog", { name: "This chat" });
  await expect(dialog).toContainText("assistant");
  await expect(dialog).toContainText("15 tokens");
  await expect(dialog.getByRole("button", { name: "Close" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});

test("a new message of a running turn replaces the shown one, and the older one becomes a badge", async ({ page }) => {
  const sockets = await routeEvents(page);
  await logIn(page);
  const sessionId = await newChat(page);
  sockets.at(-1)?.send(textEvent(sessionId, "first thought"));
  await expect(page.getByText("first thought")).toBeVisible();
  sockets.at(-1)?.send(textEvent(sessionId, "second thought"));
  await expect(page.getByText("second thought")).toBeVisible();
  await expect(page.getByText("first thought")).toHaveCount(0);
  await expect(page.locator('.step-badge[title="Message: first thought"]')).toHaveCount(1);
  // A badge keeps a short text, so the whole answer is one tap away.
  await page.getByRole("button", { name: "Show the whole answer" }).click();
  await expect(page.getByText("first thought")).toBeVisible();
  await expect(page.getByText("second thought")).toBeVisible();
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
  const dialog = page.getByRole("dialog", { name: "Approval" });
  await expect(dialog).toHaveCount(0);
  const runningTask = page.getByRole("button", { name: "1 background task running" });
  await expect(runningTask).toHaveCount(0);

  await sockets[0]?.close();
  await expect(dialog).toContainText("gh issue create");
  await expect(runningTask).toBeVisible();
  await dialog.getByRole("button", { name: "Allow" }).click();
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
  await page.getByRole("button", { name: "Settings" }).click();
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
  await page.getByRole("button", { name: "Settings" }).click();
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
  await page.getByRole("button", { name: "Settings" }).click();
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
      .locator("button:visible, select:visible, .link-list a:visible, a.button-link:visible")
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

test("Project details: change, clear and save the fields, then the whole AGENTS.md", async ({ page }) => {
  const run = test.info().project.name;
  await logIn(page);
  await page.getByRole("button", { name: "Project" }).click();
  await openList(page);
  await page.getByRole("group", { name: "Status" }).getByRole("button", { name: "Active" }).click();
  await page.getByRole("button", { name: new RegExp(`Draft ${run}`) }).click();
  await page.getByRole("button", { name: "Details", exact: true }).click();
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
  await page.getByRole("button", { name: "Settings" }).click();
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
  await expect(page.getByRole("button", { name: "Open schedules" }).locator("svg.icon")).toBeVisible();
  await expectNoSymbolMarks(page);
  await page.getByRole("button", { name: "Open schedules" }).click();
  await expect(page.getByRole("heading", { name: "Schedules", level: 1 })).toBeVisible();
  await expectNoSymbolMarks(page);
  await page.getByRole("button", { name: "Project" }).click();
  await expect(page.getByRole("button", { name: "Project" })).toHaveAttribute("aria-pressed", "true");
  await expectNoSymbolMarks(page);
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("group", { name: "Progress list" })).toBeVisible();
  await expectNoSymbolMarks(page);
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
  await page.getByRole("button", { name: "Settings" }).click();
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
  await page.getByRole("button", { name: "Settings" }).click();
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("list", { name: "Devices" }).getByRole("button", { name: "Remove" }).click();
  await expect(page.getByRole("button", { name: "Log in" })).toBeVisible();
});
