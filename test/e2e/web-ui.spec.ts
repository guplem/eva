import { expect, test, type Locator, type Page, type WebSocketRoute } from "@playwright/test";

const token = "e2e-demo-token";

// A route handler can still run as its test ends, and its error then fails the next test.
test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

/** A day with no special day, so the greeting and the faces are the usual ones. */
const ordinaryDay = new Date("2026-07-15T12:00:00");

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

/**
 * Starts a new Assistant chat, and returns its id once the page shows it. Until then the page
 * shows the chat before it, which can be an empty chat also named "New chat". Text typed then
 * goes into that chat, and is lost when the new one opens.
 */
async function clickNewChat(page: Page): Promise<string> {
  await openList(page);
  const items = page.locator(".sidebar .list-item");
  const before = await items.count();
  const created = page.waitForResponse(
    (response) => response.url().endsWith("/api/sessions") && response.request().method() === "POST",
  );
  await page.getByRole("navigation", { name: "Chats" }).getByRole("button", { name: "New chat", exact: true }).click();
  const id = ((await (await created).json()) as { id: string }).id;
  // A new chat goes first in the list, and the page selects it.
  await expect(items).toHaveCount(before + 1);
  await expect(items.first()).toHaveAttribute("aria-current", "true");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("New chat");
  return id;
}

/**
 * Opens Projects and waits for its list. With no project open, the list shows with no menu tap on
 * both sizes. openList would race: the menu button of the page before can still show for a moment.
 */
async function openProjects(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Projects", exact: true }).click();
  await expect(page.getByRole("navigation", { name: "Projects" })).toBeVisible();
}

/**
 * Waits for the answer to a first message in a new clone, and denies the trust question if it comes.
 * Only the first chat in a clone asks; both screen sizes share one demo server. The live answer card
 * shows at once, so wait for the text of the answer, not for its card: an open question stops the turn.
 */
async function answerInNewClone(page: Page, text: string): Promise<void> {
  const answer = page.locator(".message.answer").filter({ hasText: text }).first();
  const trustQuestion = page.getByRole("region", { name: "Eva asks for permission" });
  await expect(answer.or(trustQuestion)).toBeVisible();
  if (await trustQuestion.isVisible()) {
    await expect(trustQuestion).toContainText("Trust this repository");
    await trustQuestion.getByRole("button", { name: "Deny" }).click();
  }
  await expect(answer).toBeVisible();
}

/** Opens the page of the Example app project in Project mode. */
async function openExampleApp(page: Page): Promise<void> {
  await openProjects(page);
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
  const created = page.waitForResponse(
    (response) => response.url().endsWith("/clones") && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "New clone" }).click();
  const name = ((await (await created).json()) as { name: string }).name;
  await expect(cards).toHaveCount(before + 1);
  // Not the last card: a new clone takes the first free number, which a deleted clone leaves.
  return page.getByRole("region", { name: `Clone ${name}` });
}

/**
 * Right-clicks an element after it scrolls into view. A scroll event comes a frame later, and a scroll
 * closes an open context menu, so the click waits for that frame.
 */
async function rightClickInView(locator: Locator): Promise<void> {
  await locator.scrollIntoViewIfNeeded();
  await locator.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  );
  await locator.click({ button: "right" });
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

/** The browser resolves a token to the same form as a computed style, so the two compare as text. */
async function tokenColour(page: Page, name: string): Promise<string> {
  return page.evaluate((each) => {
    const probe = document.createElement("i");
    probe.style.color = `var(${each})`;
    document.body.append(probe);
    const colour = getComputedStyle(probe).color;
    probe.remove();
    return colour;
  }, name);
}

async function style(
  locator: Locator,
  property: "backgroundColor" | "backgroundImage" | "borderTopColor" | "borderTopWidth" | "borderLeftWidth",
): Promise<string> {
  return locator.evaluate((element, each) => getComputedStyle(element)[each], property);
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

test("a Tailscale account that this Eva does not let in sees why, instead of a page that waits (#322)", async ({
  page,
}) => {
  const reason = "This Eva does not let in the Tailscale account partner@example.com. Run `eva setup`.";
  await page.route("**/api/**", (route) =>
    route.fulfill({ status: 403, json: { error: reason, code: "tailscale_account_refused" } }),
  );
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "This account cannot open this Eva" })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveText(reason);
});

test("a wrong token is refused, and the page asks again", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel(/Token/).fill("wrong");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("alert")).toHaveText("This token is not valid.");
});

test("Assistant mode: a chat, its answer, a retry branch and the background tasks", async ({ page }) => {
  await logIn(page);
  await clickNewChat(page);
  await expect(page.locator(".main-header .sub")).toHaveText("Claude Code · Assistant");
  const composer = page.getByLabel("Message").first();
  await composer.fill("Hello Eva");
  await composer.press("Enter");
  await expect(page.locator(".message.answer").first()).toContainText(/Echo \d+: Hello Eva/);
  await expect(page.getByRole("button", { name: "Show 3 steps" }).first()).toHaveAttribute(
    "data-tooltip",
    "1 command, 1 tool",
  );
  await expectBackgroundTasks(page);

  await page.getByRole("button", { name: "Retry" }).first().click();
  await expect(page.locator(".branch")).toHaveCount(2);
  await expect(page.getByText(/Branch after answer/)).toBeVisible();
});

test("a new chat with no engine says what is missing, locks the box, and unlocks with no reload", async ({ page }) => {
  // The demo engine has a login, so the browser plays a machine without one.
  let blocker: string | null = "engine";
  await page.route("**/api/status", async (route) => {
    const response = await route.fetch();
    const status = (await response.json()) as Record<string, unknown>;
    await route.fulfill({ response, json: { ...status, chatBlocker: blocker } });
  });
  await logIn(page);
  await openList(page);
  await page.getByRole("button", { name: "New chat", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("New chat");
  await expect(page.getByText("Eva needs an AI engine before she can answer.")).toBeVisible();
  await expect(page.getByRole("group", { name: "Suggestions" })).toHaveCount(0);
  await expect(page.getByLabel("Message").first()).toBeDisabled();
  await expect(page.getByText("Set up an AI engine to send a message.")).toBeVisible();

  await page.getByRole("button", { name: "Set up an AI engine" }).click();
  await expect(page).toHaveURL(/#\/settings\/setup\/engine$/);
  await page.goBack();
  await expect(page.getByText("Eva needs an AI engine before she can answer.")).toBeVisible();

  // The step is done elsewhere: the next status read unlocks the chat.
  blocker = null;
  await expect(page.getByRole("group", { name: "Suggestions" })).toBeVisible();
  await expect(page.getByLabel("Message").first()).toBeEnabled();
  await expect(page.getByText("Set up an AI engine to send a message.")).toHaveCount(0);
});

/** Plays a machine with no chat yet, until the page makes one. Returns the number of chats it made. */
async function hideOldChats(page: Page): Promise<() => number> {
  let made = 0;
  await page.route("**/api/sessions", async (route) => {
    if (route.request().method() === "POST") {
      made += 1;
      await route.continue();
      return;
    }
    const response = await route.fetch();
    // A refused read must stay refused, or the page skips the login.
    if (made > 0 || !response.ok()) {
      await route.fulfill({ response });
      return;
    }
    await route.fulfill({ response, json: [] });
  });
  return () => made;
}

test("with no chat yet, the page greets the person, and the first message makes the chat", async ({ page }) => {
  const made = await hideOldChats(page);
  await logIn(page);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("New chat");
  await expect(page.getByRole("group", { name: "Suggestions" })).toBeVisible();
  await expect(page.getByText("No chats yet.")).toHaveCount(0);
  // An open page makes no empty chat.
  expect(made()).toBe(0);

  const text = `The first message (${test.info().project.name})`;
  const composer = page.getByLabel("Message").first();
  await composer.fill(text);
  await composer.press("Enter");
  await expect(page.locator(".message.answer").first()).toContainText(text);
  expect(made()).toBe(1);
  await openList(page);
  await expect(page.locator(".sidebar .list-item").first()).toHaveAttribute("aria-current", "true");
});

test("with no chat yet, the first message shows while Eva works on it", async ({ page }) => {
  await hideOldChats(page);
  await logIn(page);
  const text = `The first message, please approve (${test.info().project.name})`;
  const composer = page.getByLabel("Message").first();
  await composer.fill(text);
  await composer.press("Enter");
  // The approval holds the turn, so the page shows the chat before it has a stored turn.
  const dialog = page.getByRole("region", { name: "Eva asks for permission" });
  await expect(dialog).toContainText("gh issue create");
  await expect(page.locator(".message.user")).toContainText(text);
  await expect(page.getByRole("group", { name: "Suggestions" })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Allow once" }).click();
  await expect(page.locator(".message.answer").first()).toContainText("The person answered");
});

test("with no chat yet and a missing setup step, the page says what is missing", async ({ page }) => {
  await hideOldChats(page);
  await page.route("**/api/status", async (route) => {
    const response = await route.fetch();
    const status = (await response.json()) as Record<string, unknown>;
    await route.fulfill({ response, json: { ...status, chatBlocker: "vault" } });
  });
  await logIn(page);
  await expect(page.getByRole("heading", { name: "Not ready yet" })).toBeVisible();
  await expect(page.getByText("Eva needs your vault before she can answer.")).toBeVisible();
  await expect(page.getByLabel("Message").first()).toBeDisabled();
  await page.getByRole("button", { name: "Set up your vault" }).click();
  await expect(page).toHaveURL(/#\/settings\/setup\/vault$/);
});

test("Delete chat asks first, then removes the chat from the list", async ({ page }) => {
  // Both screen sizes share one demo server, so each size names its own chats.
  const title = `A chat to delete (${test.info().project.name})`;
  await logIn(page);
  await clickNewChat(page);
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

  const question = page.getByRole("group", { name: `Delete “${title}”?` });
  await chooseFromMore(page, "Delete chat");
  await question.getByRole("button", { name: "Keep" }).click();
  await expect(question).toHaveCount(0);
  await expect(listed).toHaveCount(1);
  expect(deletes).toEqual([]);

  await chooseFromMore(page, "Delete chat");
  await question.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(listed).toHaveCount(0);
  expect(deletes).toHaveLength(1);
});

/** Opens the "More actions" menu of the chat header and picks an item. */
async function chooseFromMore(page: Page, item: string): Promise<void> {
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menu", { name: "Chat actions" }).getByRole("menuitem", { name: item }).click();
}

test("the More actions menu works from the keyboard, and the focus never gets lost", async ({ page }) => {
  await logIn(page);
  await newChat(page);
  const more = page.getByRole("button", { name: "More actions" });
  const menu = page.getByRole("menu", { name: "Chat actions" });
  await more.click();
  await expect(menu.getByRole("menuitem", { name: "Rename" })).toBeFocused();
  await page.keyboard.press("End");
  await expect(menu.getByRole("menuitem", { name: "Delete chat" })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(menu.getByRole("menuitem", { name: "Rename" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(more).toBeFocused();

  await more.click();
  await page.keyboard.press("Tab");
  await expect(menu).toHaveCount(0);
  expect(await page.evaluate(() => document.activeElement !== document.body)).toBe(true);

  await chooseFromMore(page, "Rename");
  await page.getByLabel("Chat title").press("Escape");
  await expect(more).toBeFocused();

  await chooseFromMore(page, "Delete chat");
  const keep = page.getByRole("group", { name: "Delete “New chat”?" }).getByRole("button", { name: "Keep" });
  await expect(keep).toBeFocused();
  await keep.click();
  await expect(more).toBeFocused();
});

test("a right click on a chat in the list shows its actions instead of the browser's menu", async ({ page }) => {
  const title = `A chat renamed from its menu (${test.info().project.name})`;
  await logIn(page);
  await newChat(page);
  await openList(page);
  // A new chat goes first in the list.
  const item = page.locator(".sidebar .chat-item").first();
  const menu = page.getByRole("menu", { name: /^Actions of / });

  const blocked = await item.evaluate((element) => {
    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 20, clientY: 20 });
    element.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(blocked).toBe(true);
  await expect(menu.getByRole("menuitem", { name: "Open" })).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(menu.getByRole("menuitem", { name: "Delete chat" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(item).toBeFocused();

  await item.click({ button: "right" });
  await menu.getByRole("menuitem", { name: "Rename" }).click();
  const field = page.getByLabel("Chat title");
  await expect(field).toBeFocused();
  await field.fill(title);
  await field.press("Enter");
  await expect(page.locator(".sidebar .chat-item", { hasText: title })).toHaveCount(1);
});

test("a long press on a chat in the list shows its actions, and the press opens nothing", async ({ page }) => {
  await logIn(page);
  await newChat(page);
  await newChat(page);
  await openList(page);
  // The second chat, so a click that gets through would choose it.
  const item = page.locator(".sidebar .chat-item").nth(1);
  const box = await item.boundingBox();
  const at = { clientX: (box?.x ?? 0) + 20, clientY: (box?.y ?? 0) + 10, pointerType: "touch", bubbles: true };
  await item.dispatchEvent("pointerdown", at);
  const menu = page.getByRole("menu", { name: /^Actions of / });
  await expect(menu).toBeVisible();
  // The press ends in a click. That click must not choose the chat under the finger.
  await item.dispatchEvent("pointerup", at);
  await item.dispatchEvent("click", at);
  await expect(item).toHaveAttribute("aria-current", "false");
  await expect(menu).toBeVisible();

  await page.keyboard.press("Escape");
  await item.dispatchEvent("pointerdown", at);
  // A finger that moves scrolls the list, so no menu opens.
  await item.dispatchEvent("pointermove", { ...at, clientY: at.clientY + 40 });
  await page.waitForTimeout(800);
  await expect(menu).toHaveCount(0);
});

test("a right click on a project opens its pages from the menu", async ({ page }) => {
  await logIn(page);
  await openProjects(page);
  await page.getByRole("button", { name: /Example app/ }).click({ button: "right" });
  const menu = page.getByRole("menu", { name: /^Actions of / });
  await menu.getByRole("menuitem", { name: "Details" }).click();
  await expect(page.getByRole("heading", { name: /· Details$/ })).toBeVisible();
  await expect(menu).toHaveCount(0);
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
  await clickNewChat(page);
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
  await openSettings(page, "Access");
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Log out of this browser" }).click();

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
  await openExampleApp(page);
  await (await newCloneCard(page)).getByRole("button", { name: "New chat here" }).click();
  const composer = page.getByLabel("Message").first();
  await composer.fill(title);
  await composer.press("Enter");
  await answerInNewClone(page, title);
  const chatId = await chatIdNamed(page, title);

  await page.goto("/");
  await expect(page.getByRole("button", { name: "Chats" })).toHaveAttribute("aria-current", "page");
  await page.goto(`/#/chat/${chatId}`);
  await expect(page.getByRole("button", { name: "Projects", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.locator(".message.user").first()).toContainText(title);
  await expect(page.getByText("Project mode")).toBeVisible();
});

test("a chat gets a new title in the header and the list, and Escape keeps the old one (issue 46)", async ({
  page,
}) => {
  await logIn(page);
  await clickNewChat(page);

  await chooseFromMore(page, "Rename");
  await page.getByLabel("Chat title").fill("Draft");
  await page.getByLabel("Chat title").press("Escape");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("New chat");

  await chooseFromMore(page, "Rename");
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

test("a chat that answers while another chat is open shows as unread until the person opens it (issue 381)", async ({
  page,
}) => {
  await logIn(page);
  await clickNewChat(page);
  // Both screen sizes share one demo server, so each size has its own chat.
  const message = `a slow answer on the ${test.info().project.name}`;
  const composer = page.getByLabel("Message").first();
  await composer.fill(message);
  await composer.press("Enter");
  await expect(page.getByRole("button", { name: "Stop" })).toBeVisible();
  await clickNewChat(page);
  // A phone hides the list behind its button, so the button tells that a chat waits.
  if (test.info().project.name === "phone") {
    await expect(page.getByRole("button", { name: "Show the list (unread)" })).toBeVisible();
  }
  await openList(page);
  const slow = page.locator(".sidebar .list-item", { hasText: message });
  await expect(slow.locator(".status-pill")).toHaveText("Unread");
  const marked = page.waitForResponse((response) => response.url().endsWith("/seen") && response.ok());
  await slow.click();
  await expect(page.locator(".message.answer").first()).toContainText(message);
  await marked;
  // The open chat hides its own mark at once. Another open chat shows what the core stored.
  await openList(page);
  await page.locator(".sidebar .list-item", { hasNotText: message }).first().click();
  await openList(page);
  await expect(slow).toBeVisible();
  await expect(slow.locator(".status-pill")).toHaveCount(0);
});

test("an answer keeps its line breaks, lists and paragraphs", async ({ page }) => {
  await logIn(page);
  await clickNewChat(page);
  const composer = page.getByLabel("Message").first();
  await composer.fill("show me a list");
  await composer.press("Enter");
  const answer = page.locator(".message.answer").first();
  await expect(answer.locator("li")).toHaveText(["first", "second"]);
  await expect(answer.locator("p")).toHaveText(["Two steps:", "Done."]);
});

test("a usage warning shows under the chat after its answer (issue #67)", async ({ page }) => {
  await logIn(page);
  await clickNewChat(page);
  const composer = page.getByLabel("Message").first();
  await composer.fill("near the limit");
  await composer.press("Enter");
  await expect(page.locator(".message.answer").first()).toContainText("near the limit");
  await expect(page.getByRole("status").filter({ hasText: "usage limit" })).toContainText(
    /You used 86% of your 5-hour usage limit\. It resets (at|on) /,
  );
});

test("the answer shows its words while the engine writes them, then the whole text (issue 117)", async ({ page }) => {
  await logIn(page);
  await clickNewChat(page);
  const composer = page.getByLabel("Message").first();
  await composer.fill("stream it");
  await composer.press("Enter");
  const answer = page.locator(".msg:has(.working)");
  await expect(answer).toContainText("Streaming the words of this answer");
  await expect(answer).not.toContainText("to end it.");
  await page
    .getByRole("region", { name: "Eva asks for permission" })
    .getByRole("button", { name: "Allow once" })
    .click();
  await expect(page.locator(".msg", { hasText: "More words to end it." })).toBeVisible();
  await expect(answer).toHaveCount(0);
});

test("an approval shows as a card in its chat, and Allow once answers the turn", async ({ page }) => {
  await logIn(page);
  await clickNewChat(page);
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
  // The demo machine has no voice notes, so the empty box offers to set them up in place of Send.
  await expect(page.getByRole("button", { name: "Send" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Set up voice notes" })).toBeVisible();
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
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  // The chip is the one place that shows the model.
  await expect(page.locator(".chip-picker").getByRole("button", { name: /Haiku/ })).toBeVisible();

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

test("the day line shows the time of a run and of now on hover", async ({ page }, info) => {
  // The day line places "now" by the server's time. Near midnight the mark sits at an edge of a
  // phone screen, so the hover misses it. Noon keeps it in the middle of the line.
  await page.route("**/api/schedules", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    const response = await route.fetch();
    const body = (await response.json()) as { now: string };
    return route.fulfill({ response, json: { ...body, now: `${body.now.slice(0, 11)}12:00${body.now.slice(16)}` } });
  });
  await logIn(page);
  const id = `hover-${info.project.name}`;
  await page.request.post("/api/schedules", {
    data: { id, name: `Hover ${info.project.name}`, at: "00:00", text: "Hi." },
  });
  await page.getByRole("dialog", { name: "Setup card" }).getByRole("button", { name: "Got it" }).click();
  await page.goto("/#/schedules");
  const line = page.locator(".day-line");
  await expect(line.locator(".day-line-mark")).toHaveCount(0);
  await line.locator(".day-line-run").first().hover();
  await expect(line.locator(".day-line-mark").first()).toBeAttached();
  await line.locator(".day-line-now-hit").hover();
  await expect(page.getByRole("tooltip")).toHaveText(/^Now \(\d\d:\d\d\)$/);
  await page.request.delete(`/api/schedules/${id}`);
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
  await answerInNewClone(page, "Fix the bug");
  // Project mode shows the same activity as Assistant mode.
  await expect(page.getByRole("button", { name: "Show 3 steps" }).first()).toHaveAttribute(
    "data-tooltip",
    "1 command, 1 tool",
  );
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

test("a right click on a clone deletes it, after a strong warning about its chats", async ({ page }) => {
  await logIn(page);
  await openExampleApp(page);
  const card = await newCloneCard(page);
  const cloneName = ((await card.getAttribute("aria-label")) ?? "").replace("Clone ", "");
  await card.getByRole("button", { name: "New chat here" }).click();
  await expect(page.getByText("Project mode")).toBeVisible();
  await page.getByRole("button", { name: "Example app", exact: true }).click();
  const sameCard = page.getByRole("region", { name: `Clone ${cloneName}` });
  await expect(sameCard.locator(".clone-chat")).toHaveCount(1);

  await rightClickInView(sameCard.locator(".clone-head"));
  await page.getByRole("menuitem", { name: "Delete clone" }).click();
  const dialog = page.getByRole("dialog", { name: `Delete the clone ${cloneName}` });
  await expect(dialog.locator(".callout.danger")).toContainText("1 chat");
  const remove = dialog.getByRole("button", { name: "Delete the clone and its chats" });
  await expect(remove).toBeDisabled();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(sameCard).toBeVisible();

  await rightClickInView(sameCard.locator(".clone-head"));
  await page.getByRole("menuitem", { name: "Delete clone" }).click();
  await dialog.getByLabel(/I understand/).check();
  await remove.click();
  await expect(dialog).toBeHidden();
  await expect(sameCard).toBeHidden();
});

test("a deleted project chat shows its project page again", async ({ page }) => {
  await logIn(page);
  await openExampleApp(page);
  await (await newCloneCard(page)).getByRole("button", { name: "New chat here" }).click();
  await expect(page.getByText("Project mode")).toBeVisible();
  if (test.info().project.name === "phone") {
    // The crumbs and the mode chip leave the title room to read, on one row.
    const title = await page.getByRole("heading", { level: 1 }).boundingBox();
    const more = await page.getByRole("button", { name: "More actions" }).boundingBox();
    expect(title?.width ?? 0).toBeGreaterThanOrEqual(120);
    expect(Math.abs((title?.y ?? 0) - (more?.y ?? 0))).toBeLessThan(44);
  }
  await chooseFromMore(page, "Delete chat");
  await page
    .getByRole("group", { name: /^Delete “/ })
    .getByRole("button", { name: "Delete", exact: true })
    .click();
  await expect(page.getByRole("heading", { level: 1, name: "Example app" })).toBeVisible();
});

test("the project list shows its shape while it reads, not that no project matches", async ({ page }) => {
  let answer = (): void => undefined;
  const answered = new Promise<void>((resolve) => {
    answer = resolve;
  });
  await page.route("**/api/projects?*", async (route) => {
    await answered;
    await route.continue();
  });
  await logIn(page);
  await openProjects(page);
  const list = page.getByRole("navigation", { name: "Projects" });
  await expect(list.getByText("Loading the projects…")).toBeAttached();
  await expect(list.locator(".skeleton-item").first()).toBeVisible();
  await expect(list.getByText("No project matches.")).toHaveCount(0);
  answer();
  await expect(list.getByRole("button", { name: /Example app/ })).toBeVisible();
  await expect(list.locator(".skeleton")).toHaveCount(0);
});

test("a failed first read of the projects says so, and Try again reads them", async ({ page }) => {
  let failing = true;
  await page.route("**/api/projects?*", async (route) => {
    if (failing) await route.fulfill({ status: 500, json: { error: "The vault is busy." } });
    else await route.continue();
  });
  await logIn(page);
  await openProjects(page);
  const list = page.getByRole("navigation", { name: "Projects" });
  await expect(list.getByText("Eva could not read the projects.")).toBeVisible();
  await expect(list.getByText("No project matches.")).toHaveCount(0);
  failing = false;
  await list.getByRole("button", { name: "Try again" }).click();
  await expect(list.getByRole("button", { name: /Example app/ })).toBeVisible();
});

test("New project: the form creates a project and opens its page", async ({ page }, testInfo) => {
  const name = `Form app ${testInfo.project.name}`;
  await logIn(page);
  await openProjects(page);
  await page.getByRole("button", { name: "New project" }).click();
  const form = page.getByRole("dialog", { name: "New project" });
  // The demo has no GitHub login, so the form says what to set up instead of a send that fails.
  await expect(form.getByLabel(/Create a private GitHub repository/)).toBeDisabled();
  await expect(form).toContainText("Log in to GitHub");
  await form.getByLabel("Name").fill(name);
  await form.getByLabel("Description").fill("Made from the form.");
  await form.getByLabel("Status").selectOption("idea");
  await form.getByLabel(/^Tags/).fill("demo form");
  await form.getByRole("button", { name: "Create project" }).click();
  await expect(form).toHaveCount(0);
  await expect(page.locator("main").getByRole("heading", { level: 1 })).toHaveText(name);
  await expect(page.locator("main")).toContainText("Made from the form.");
});

test("New project: a failed read of the settings turns the steps off and says so", async ({ page }) => {
  await logIn(page);
  await openProjects(page);
  await page.route("**/api/settings", (route) => route.fulfill({ status: 500, json: { error: "Busy." } }));
  await page.getByRole("button", { name: "New project" }).click();
  const form = page.getByRole("dialog", { name: "New project" });
  await expect(form.getByLabel(/Create a Google Drive folder/)).toBeDisabled();
  await expect(form).toContainText("Eva could not read the settings.");
  await page.keyboard.press("Escape");
  await expect(form).toHaveCount(0);
});

test("New project: a failed step keeps the project and says why", async ({ page }) => {
  await page.route("**/api/projects", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    return route.fulfill({
      status: 201,
      json: { projectId: "2025-03-02-1015-example-app", github: { problem: "name already exists" }, drive: null },
    });
  });
  await logIn(page);
  await openProjects(page);
  await page.getByRole("button", { name: "New project" }).click();
  const form = page.getByRole("dialog", { name: "New project" });
  await form.getByLabel("Name").fill("Example app");
  await form.getByRole("button", { name: "Create project" }).click();
  await expect(form.getByRole("status")).toHaveText("Eva could not create the GitHub repository: name already exists");
  await form.getByRole("button", { name: "Open the project" }).click();
  await expect(form).toHaveCount(0);
  await expect(page.locator("main").getByRole("heading", { level: 1 })).toHaveText("Example app");
});

test("the project page says that the clones load, not that there are none", async ({ page }) => {
  await logIn(page);
  let release = (): void => undefined;
  const answered = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/projects/*/clones", async (route) => {
    await answered;
    await route.continue();
  });
  await openProjects(page);
  await page.getByLabel("Search projects").fill("example");
  await page.getByRole("button", { name: /Example app/ }).click();
  await expect(page.getByText("Loading the clones…")).toBeVisible();
  await expect(page.locator("main").getByText(/^No clones yet\./)).toHaveCount(0);
  release();
  await expect(page.getByText("Loading the clones…")).toHaveCount(0);
});

test("the address of a fork of a project chat opens that fork in its clone", async ({ page }) => {
  const title = `Forked project work (${test.info().project.name})`;
  await logIn(page);
  await openExampleApp(page);
  await (await newCloneCard(page)).getByRole("button", { name: "New chat here" }).click();
  const composer = page.getByLabel("Message").first();
  await composer.fill(title);
  await composer.press("Enter");
  await answerInNewClone(page, title);
  const chatId = await chatIdNamed(page, title);
  await waitUntilIdle(page, chatId);
  await page.getByRole("button", { name: "Retry" }).first().click();
  await expect(page.locator(".branch")).toHaveCount(2);
  let forkId: string | undefined;
  await expect
    .poll(async () => {
      const sessions = (await (await page.request.get("/api/sessions")).json()) as { id: string; parentId: string }[];
      forkId = sessions.find((session) => session.parentId === chatId)?.id;
      return forkId;
    })
    .toBeDefined();

  await page.goto("/");
  await page.goto(`/#/chat/${forkId ?? ""}`);
  await expect(page.getByText("Project mode")).toBeVisible();
  await expect(page.locator(".message.user").first()).toContainText(title);
});

test("Project mode: the repository setup shows each item's light and copies its fix", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await logIn(page);
  await openExampleApp(page);
  await page.getByRole("button", { name: "Repository setup" }).click();
  await expect(page.getByRole("heading", { name: "Example app · Repository setup" })).toBeVisible();
  // The local remote is not on GitHub, so its report only says why.
  await expect(page.getByText("Only a repository on GitHub has a setup report.")).toBeVisible();
  const report = page.getByRole("region", { name: "example-owner/example-app" });
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
  await openProjects(page);
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
  await openProjects(page);
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
  await openProjects(page);
  const project = page.getByRole("button", { name: /Broken notes/ });
  await expect(project).toContainText("1 warning");
  await project.click();
  await expect(page.getByRole("list", { name: "Warnings of Broken notes" })).toHaveText("repos must be a list of URLs");
});

test("on a phone, the project list is the page, and Back to the list returns to it", async ({ page }) => {
  test.skip(test.info().project.name !== "phone", "This check is for the phone size only.");
  await logIn(page);
  await page.getByRole("button", { name: "Projects", exact: true }).click();
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

test("on a short phone, a long project list scrolls, and no card cuts its text", async ({ page }) => {
  test.skip(test.info().project.name !== "phone", "This check is for the phone size only.");
  // A screen shorter than the list makes the flex column squeeze each card to the 44 px of a button.
  await page.setViewportSize({ width: 375, height: 360 });
  await logIn(page);
  await page.getByRole("button", { name: "Projects", exact: true }).click();
  await expect(page.getByRole("button", { name: /Example app/ })).toBeVisible();
  const cut = await page
    .locator(".project-card")
    .evaluateAll((cards) => cards.filter((card) => card.scrollHeight > card.clientHeight + 1).length);
  expect(cut).toBe(0);
});

test("Settings: the vault Test button checks the remote, and Log out ends the session", async ({ page }) => {
  // The check waits until the test lets it go, so the test sees the wait.
  let release = (): void => undefined;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/checks/*", async (route) => {
    await released;
    await route.continue();
  });
  await logIn(page);
  await openSettings(page, "Vault and sync");
  const vaultRow = page.locator(".check-row", { hasText: "Vault repository" });
  await vaultRow.getByRole("button", { name: "Test" }).click();
  await expect(vaultRow.getByRole("progressbar", { name: "Testing the vault repository…" })).toBeVisible();
  release();
  await expect(vaultRow.getByRole("img", { name: "Passed" })).toBeVisible();
  await expect(vaultRow.getByRole("progressbar")).toHaveCount(0);
  // Log out sits on the Devices card, because it ends only this browser's login.
  await openSettings(page, "Access");
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Log out of this browser" }).click();
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

test("Settings: Eva's rules show formatted, save from the plain text, and restore the default after a backup", async ({
  page,
}) => {
  await logIn(page);
  await openSettings(page, "Personalize");
  const card = page.getByRole("region", { name: "Eva's rules" });
  await expect(card.getByRole("heading", { name: "You are Eva" })).toBeVisible();
  await expect(card).toContainText("A project chat never uses them");
  // The person's rules and the built-in rules each have their own frame, so the person sees where each ends.
  const own = card.getByRole("region", { name: "Your rules" });
  await expect(own.getByRole("heading", { name: "You are Eva" })).toBeVisible();
  await expect(own).not.toContainText("Eva's built-in rules");
  await expect(card.locator("details.rules-box")).toContainText("Eva's built-in rules");
  try {
    await card.getByRole("button", { name: "Edit" }).click();
    await card.getByLabel("Rules in Markdown").fill("# Be brief\n\nAnswer in one sentence.\n");
    await card.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "New chats with Eva use the new rules." })).toBeVisible();
    await expect(card.getByRole("heading", { name: "Be brief" })).toBeVisible();

    await card.getByRole("button", { name: "Restore the default" }).click();
    const dialog = page.getByRole("dialog", { name: "Restore the default rules" });
    await expect(dialog.getByRole("checkbox")).toBeChecked();
    await dialog.getByRole("button", { name: "Save a backup and restore" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Your old rules are in .eva/assistant.backup-" }),
    ).toBeVisible();
    await expect(card.getByRole("heading", { name: "Learning" })).toBeVisible();
  } finally {
    // Later tests expect the demo vault's own rules.
    await page.evaluate(async () => {
      const current = (await (await fetch("/api/assistant-rules")).json()) as { version: string };
      await fetch("/api/assistant-rules", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ version: current.version, text: "# You are Eva\n" }),
      });
    });
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
  // A saved token is a done login: the card says so, and hides the steps and the field.
  const loggedIn = page.getByRole("group", { name: "GitHub login" });
  await expect(loggedIn).toContainText("You are logged in to GitHub.");
  await expect(field).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Log in with GitHub" })).toHaveCount(0);
  const notice = page.getByRole("status").filter({ hasText: "Restart Eva" });
  await expect(notice).toBeVisible();
  // The note asks for a restart, so one tap on it opens the restart question.
  await notice.getByRole("button", { name: "Restart Eva" }).click();
  const question = page.getByRole("alertdialog", { name: "Restart Eva" });
  await expect(question).toBeVisible();
  await question.getByRole("button", { name: "Cancel" }).click();
  await page.reload();
  await expect(loggedIn).toContainText("You are logged in to GitHub.");
  expect(await page.content()).not.toContain("e2e-example-token");
  // Log in again shows the steps and the field, and Keep the current login hides them again.
  await loggedIn.getByRole("button", { name: "Log in again" }).click();
  await expect(page.getByText("A GitHub token is saved.")).toBeVisible();
  await page.getByRole("button", { name: "Keep the current login" }).click();
  // A new pasted token is a new login too, so the card shows as logged in again.
  await loggedIn.getByRole("button", { name: "Log in again" }).click();
  await field.fill("ghp_e2e-example-token");
  await page.getByRole("button", { name: "Save the GitHub token" }).click();
  await expect(loggedIn).toBeVisible();
  // Log out asks first, with a warning, and Cancel keeps the login.
  await loggedIn.getByRole("button", { name: "Log out of GitHub" }).click();
  const logOut = page.getByRole("dialog", { name: "Log out of GitHub" });
  await expect(logOut).toContainText("Eva removes the GitHub token from this machine.");
  await logOut.getByRole("button", { name: "Cancel" }).click();
  await expect(logOut).toHaveCount(0);
  await expect(loggedIn).toBeVisible();
  await loggedIn.getByRole("button", { name: "Log out of GitHub" }).click();
  await logOut.getByRole("button", { name: "Log out", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Logged out of GitHub." })).toBeVisible();
  await expect(page.getByText("No GitHub token is saved.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Log in with GitHub" })).toBeVisible();
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

const planConflict = {
  path: "Notes/plan.md",
  kind: "committed",
  picked: null,
  mine: "- [ ] Review pull request #42\n- [ ] Thursday demo at 9\n",
  theirs: "- [ ] Review pull request #42\n- [ ] Buy coffee\n",
};

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
      json: { state: conflictState, conflicts: [planConflict] },
    }),
  );
  await logIn(page);
  await openSettings(page, "Vault and sync");
  const sync = page.getByRole("region", { name: "Vault sync" });
  await expect(sync).toContainText("Conflict: Notes/plan.md has a conflict.");
  const card = sync.getByRole("region", { name: "Conflict: Notes/plan.md" });
  await expect(card).toContainText("plan.md changed here and on the remote");
  await expect(card.locator(".diff .a")).toHaveText(["- [ ] Thursday demo at 9", "- [ ] Buy coffee"]);
  await expect(sync.getByRole("group", { name: "Notes/plan.md" })).toBeVisible();
  await expect(sync.getByRole("button", { name: "Keep mine: Notes/plan.md" })).toBeVisible();
  await expect(sync.getByRole("button", { name: "Keep theirs: Notes/plan.md" })).toBeVisible();
  await expect(sync.getByRole("button", { name: "Keep both: Notes/plan.md" })).toBeVisible();
  await expect(sync).toContainText("Notes/keys.md (looks like a secret)");
  await expect(sync).toContainText("Media/film.mov (larger than 50 MB)");
});

test("Settings: a vault sync error is red, and a conflict that waits for the person is amber (issue #208)", async ({
  page,
}) => {
  let status: "error" | "conflict" = "error";
  await page.route("**/api/status", async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as { vaultSync: Record<string, unknown> };
    body.vaultSync = { ...body.vaultSync, status, lastError: "The push failed." };
    await route.fulfill({ response, json: body });
  });
  await page.route("**/api/vault/conflicts", (route) => route.fulfill({ json: { state: null, conflicts: [] } }));
  await logIn(page);
  await openSettings(page, "Vault and sync");
  const pill = page.getByRole("region", { name: "Vault sync" }).locator(".pill");
  await expect(pill).toHaveText("Error");
  expect(await style(pill, "backgroundColor")).toBe(await tokenColour(page, "--bad-bg"));
  status = "conflict";
  await page.reload();
  await expect(pill).toHaveText("Conflict");
  expect(await style(pill, "backgroundColor")).toBe(await tokenColour(page, "--warn-bg"));
});

test("Settings: with the automatic sync off, the sync card says so, and that Sync now sends the notes (#215)", async ({
  page,
}) => {
  let autoSync = false;
  await page.route("**/api/status", async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as Record<string, unknown>;
    await route.fulfill({ response, json: { ...body, vaultAutoSync: autoSync } });
  });
  await logIn(page);
  await openSettings(page, "Vault and sync");
  const sync = page.getByRole("region", { name: "Vault sync" });
  await expect(sync).toContainText("Automatic sync is off. Press Sync now to send your notes.");
  autoSync = true;
  await page.reload();
  await expect(sync.locator(".pill")).toBeVisible();
  await expect(sync).not.toContainText("Automatic sync is off");
});

test("Settings: the theme and the density apply at once and stay in this browser", async ({ page }) => {
  await logIn(page);
  await openSettings(page, "Personalize");
  await page.getByRole("group", { name: "Theme" }).getByRole("button", { name: "Dark" }).click();
  await page.getByRole("group", { name: "Density" }).getByRole("button", { name: "Compact" }).click();
  await expect(page.getByRole("button", { name: "Dark" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "System" })).toHaveAttribute("aria-pressed", "false");
  // A tick marks the choice, so a chosen chip does not look like a button.
  await expect(page.getByRole("button", { name: "Dark" }).locator(".choice-tick")).toBeVisible();
  await expect(page.getByRole("button", { name: "System" }).locator(".choice-tick")).toHaveCount(0);
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
  await expect(colours.getByRole("button", { name: "EVE blue" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("Selected: EVE blue")).toBeVisible();
  await colours.getByRole("button", { name: "Violet" }).click();
  await expect(colours.getByRole("button", { name: "Violet" })).toHaveAttribute("aria-pressed", "true");
  await expect(colours.getByRole("button", { name: "EVE blue" })).toHaveAttribute("aria-pressed", "false");
  expect(await accent()).not.toBe(before);
  // The free colour is the last swatch of the row, so it sits inside the same group.
  await colours.getByLabel("Any colour").fill("#123abc");
  await expect(page.getByText("Selected: #123ABC")).toBeVisible();
  await expect(colours.getByRole("button", { name: "Violet" })).toHaveAttribute("aria-pressed", "false");
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
  await list.getByRole("button", { name: /Step \d+ Your devices/ }).click();
  await expect(page.getByRole("region", { name: "Allow a new device" })).toContainText("eva devices allow");
  await page.getByRole("button", { name: /Step \d+: Your vault/ }).click();
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

test("Settings: Development links to a GitHub report and opens the design reference", async ({ page }) => {
  await logIn(page);
  await openSettings(page, "Development");
  const report = page.getByRole("link", { name: "Report a bug" });
  await expect(report).toHaveAttribute("href", /^https:\/\/github\.com\/guplem\/eva\/issues\/new\?/);
  // The status loads after the settings, so the version reaches the link a moment later.
  await expect
    .poll(async () => new URL((await report.getAttribute("href")) ?? "").searchParams.get("body"))
    .toMatch(/Eva version: \d/);
  await page.getByRole("button", { name: "Open the design reference" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Design reference");
  await expect(page.getByRole("region", { name: "Colours" })).toContainText("--accent");
  await expect(page.getByRole("region", { name: "Components" })).toContainText(".pill");
  await expect(page.getByRole("list", { name: "Layers" })).toContainText("src/core");
  // The theme switch on the page changes the colours of every sample.
  await page.getByRole("group", { name: "Theme" }).getByRole("button", { name: "Dark" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Development");
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
  // Off needs no setup card, and the row says that it is off.
  const toggle = row.getByRole("switch", { name: `Run Walk ${id}` });
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await expect(row).toContainText("Fridays at 07:30 · off");
  await expect(row.locator(".status-pill")).toHaveText("Off");
  await expect(page.getByRole("dialog", { name: "Setup card" })).toHaveCount(0);
  // On again needs a new setup card (lesson 67).
  await toggle.click();
  await expect(card).toContainText(`Schedule turned on: Walk ${id}`);
  await card.getByRole("button", { name: "Got it" }).click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  // Remove asks in the page first.
  await row.getByRole("button", { name: `Remove Walk ${id}` }).click();
  await row.getByRole("button", { name: "Keep" }).click();
  await row.getByRole("button", { name: `Remove Walk ${id}` }).click();
  await row.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(row).toHaveCount(0);
});

test("Schedules page: add a schedule that repeats every few days", async ({ page }, testInfo) => {
  const id = `water-${testInfo.project.name.replace(/\W+/g, "-").toLowerCase()}`;
  await logIn(page);
  await page.getByRole("button", { name: "Schedules" }).click();
  await page.getByRole("button", { name: "Add schedule" }).click();
  const form = page.getByRole("dialog", { name: "Add schedule" });
  await form.getByLabel(/^Id/).fill(id);
  await form.getByLabel("Name").fill(`Water ${id}`);
  await form.getByRole("button", { name: "At an interval" }).click();
  await expect(form.getByLabel("Time (HH:MM)")).toHaveCount(0);
  await form.getByLabel("Every").fill("3");
  await form.getByLabel("Unit").selectOption("d");
  await form.getByLabel("First run").fill("2030-01-02T07:30");
  await form.getByLabel("Fixed text").fill("Water the plants.");
  await form.getByRole("button", { name: "Save schedule" }).click();
  await expect(form).toHaveCount(0);
  const card = page.getByRole("dialog", { name: "Setup card" });
  await expect(card).toContainText("Every 3 days at 07:30, from Wed 2 Jan, 07:30");
  await card.getByRole("button", { name: "Got it" }).click();
  const row = page.getByRole("listitem", { name: `Water ${id}` });
  await expect(row).toContainText("Every 3 days at 07:30 · next 2 Jan 07:30");
  await page.request.delete(`/api/schedules/${id}`);
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

test("the Chats badge counts the approvals that wait, and Settings sits at the foot of the rail", async ({ page }) => {
  await page.route("**/api/approvals", (route) =>
    route.fulfill({ json: [{ requestId: "r1", sessionId: "s1", toolName: "Bash", summary: "ls" }] }),
  );
  await logIn(page);
  const nav = page.getByRole("navigation", { name: "Main" });
  await expect(nav.getByRole("button", { name: "Chats" })).toContainText("1 approval waits");
  // Settings stays the last destination, so the phone tab bar keeps its order.
  await expect(nav.getByRole("button").last()).toHaveAccessibleName(/^Settings/);
  if (test.info().project.name === "desktop") {
    const rail = await nav.boundingBox();
    const settings = await nav.getByRole("button", { name: /^Settings/ }).boundingBox();
    const schedules = await nav.getByRole("button", { name: "Schedules" }).boundingBox();
    if (rail === null || settings === null || schedules === null) throw new Error("The rail did not show.");
    // A gap splits Settings from the other destinations, and the rail ends with it.
    expect(settings.y - (schedules.y + schedules.height)).toBeGreaterThan(schedules.height);
    expect(rail.y + rail.height - (settings.y + settings.height)).toBeLessThan(40);
  }
});

test("the nav visor names the approval that waits, and a tap plays a face that ends", async ({ page }) => {
  // A phone hides the visor: its bottom bar has no room for it.
  test.skip(test.info().project.name !== "desktop", "Only a computer shows the nav visor.");
  await page.route("**/api/approvals", (route) =>
    route.fulfill({ json: [{ requestId: "r1", sessionId: "s1", toolName: "Bash", summary: "ls" }] }),
  );
  await logIn(page);
  const visorButton = page
    .getByRole("navigation", { name: "Main" })
    .getByRole("button", { name: "1 approval waits for you" });
  const visor = visorButton.locator(".mk");
  await expect(visor).toHaveClass(/e-firm/);
  await visorButton.hover();
  await expect(page.getByRole("tooltip")).toHaveText("1 approval waits for you");
  await visorButton.click();
  await expect(visor).not.toHaveClass(/e-firm/);
  await expect(visor).toHaveClass(/e-firm/, { timeout: 5000 });
});

test("the Settings home page shows Eva's status", async ({ page }) => {
  await logIn(page);
  await openSettings(page);
  const card = page.getByRole("region", { name: "Status" });
  for (const label of ["Version", "This machine", "Chats", "Vault sync", "Phone access", "Problems"]) {
    await expect(card.getByRole("term").filter({ hasText: label })).toBeVisible();
  }
});

test("the Settings home page lists where each setting lives, and a row opens its card (issue 310)", async ({
  page,
}) => {
  await logIn(page);
  await openSettings(page);
  await page.getByRole("button", { name: "See where each setting lives" }).click();
  const dialog = page.getByRole("dialog", { name: "Where each setting lives" });
  for (const heading of ["In your vault", "On this machine only", "In this browser only"]) {
    await expect(dialog.getByRole("heading", { name: new RegExp(heading) })).toBeVisible();
  }
  // A setting with no page is a row of text that says how to change it, not a button.
  await expect(dialog.getByText("eva settings set voice.language")).toBeVisible();
  await expect(dialog.getByRole("button", { name: /Voice note language/ })).toHaveCount(0);
  await dialog.getByRole("button", { name: /Appearance/ }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Personalize");
  expect(new URL(page.url()).hash).toBe("#/settings/personalize/appearance");
});

test("the New chat button sits in the list header, and the list has no model menu", async ({ page }) => {
  await logIn(page);
  await newChat(page);
  await newChat(page);
  await newChat(page);
  // A short window makes the chat list longer than the screen.
  const viewport = page.viewportSize();
  await page.setViewportSize({ width: viewport?.width ?? 1280, height: 400 });
  await openList(page);
  const button = page.getByRole("navigation", { name: "Chats" }).getByRole("button", { name: "New chat", exact: true });
  await expect(button).toBeInViewport();
  // The composer chip is the one place to pick the model.
  await expect(page.getByRole("navigation", { name: "Chats" }).getByRole("combobox")).toHaveCount(0);
  const buttonBox = await button.boundingBox();
  const firstChatBox = await page.locator(".sidebar .list-item").first().boundingBox();
  if (buttonBox === null || firstChatBox === null) throw new Error("A sidebar part is not on the screen.");
  expect(buttonBox.y).toBeLessThan(firstChatBox.y);
  // A long list scrolls. It never squeezes a chat until its text is cut.
  const cut = await page
    .locator(".sidebar .list-item")
    .evaluateAll((items) => items.filter((item) => item.scrollHeight > item.clientHeight).length);
  expect(cut).toBe(0);
});

test("the chat list header does not cover the search field", async ({ page }) => {
  await logIn(page);
  await openList(page);
  const header = await page.locator(".chat-list-header").boundingBox();
  const search = await page.locator(".chat-search").boundingBox();
  if (header === null || search === null) throw new Error("A sidebar part is not on the screen.");
  expect(header.y + header.height).toBeLessThanOrEqual(search.y);
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
  // An ordinary day: a special day shows festive eyes and greeting instead.
  await page.clock.setFixedTime(ordinaryDay);
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
  await expect(
    page.getByRole("navigation", { name: "Chats" }).getByRole("button", { name: "New chat", exact: true }),
  ).toBeInViewport();
  const chats = page.locator(".sidebar .list-item");
  const before = await chats.count();
  await page.getByRole("navigation", { name: "Chats" }).getByRole("button", { name: "New chat", exact: true }).click();
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
  return clickNewChat(page);
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

test("a dropped connection says Eva does not answer, and the reconnect clears a stale answer", async ({ page }) => {
  const sockets = await routeEvents(page);
  await logIn(page);
  const sessionId = await newChat(page);
  sockets.at(-1)?.send(textEvent(sessionId, "half an answer"));
  await expect(page.getByText("half an answer")).toBeVisible();

  await sockets.at(-1)?.close();
  await expect(page.getByText("Eva does not answer.")).toBeVisible();
  await expect(page.getByText("Your message stays in the box")).toBeVisible();
  await expect(page.getByText("Eva does not answer.")).toBeHidden();
  await expect(page.getByText("half an answer")).toHaveCount(0);
});

test("Try now connects at once, before the next timed try", async ({ page }) => {
  let refuse = false;
  const sockets: WebSocketRoute[] = [];
  await page.routeWebSocket(/\/api\/events(\?devices)?$/, (socket) => {
    sockets.push(socket);
    if (refuse) void socket.close();
    else socket.connectToServer();
  });
  await logIn(page);
  refuse = true;
  await sockets.at(-1)?.close();
  const banner = page.getByRole("status").filter({ hasText: "Eva does not answer." });
  await expect(banner).toBeVisible();
  // A timed try just failed, so the next one is 2 seconds away: only Try now can connect sooner.
  const dropped = sockets.length;
  await expect.poll(() => sockets.length).toBeGreaterThan(dropped);
  refuse = false;
  await banner.getByRole("button", { name: "Try now" }).click();
  await expect(banner).toBeHidden({ timeout: 1_000 });
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

test("the chat panel shows the context ring, the engine and the model, and a phone opens it from the title or the menu", async ({
  page,
}) => {
  await logIn(page);
  await newChat(page);
  const composer = page.getByLabel("Message").first();
  await composer.fill("Hello Eva");
  await composer.press("Enter");
  await expect(page.locator(".message.answer").first()).toContainText(/Echo \d+: Hello Eva/);
  if (test.info().project.name === "desktop") {
    // The title and its subtitle share one row, so the header stays low.
    const header = await page.locator(".main-header").first().boundingBox();
    expect(header?.height ?? 0).toBeLessThan(56);
    const panel = page.getByRole("complementary", { name: "This chat" });
    await expect(panel).toContainText("Claude Code");
    // The engine names its window, so the ring shows a share.
    await expect(panel).toContainText("15 of 200k tokens");
    await expect(panel.getByRole("img", { name: "0% of the context window in use" })).toBeVisible();
    // The inspector shows the details, so the menu does not offer them, and the title is no button.
    await page.getByRole("button", { name: "More actions" }).click();
    await expect(page.getByRole("menuitem", { name: "Rename" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Chat info" })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("heading", { level: 1 }).getByRole("button")).toHaveCount(0);
    await panel.getByRole("button", { name: "Fork this chat" }).click();
    await expect(panel).toContainText("1, with 1 fork");
    return;
  }
  // One row: the list button, the title with its subtitle, and the more button.
  const header = page.locator(".main-header").first();
  const rows = await header.locator(":scope > *").evaluateAll((parts) => {
    const boxes = parts.map((part) => part.getBoundingClientRect());
    return {
      count: boxes.length,
      lowestTop: Math.max(...boxes.map((box) => box.top)),
      highestBottom: Math.min(...boxes.map((box) => box.bottom)),
    };
  });
  expect(rows.count).toBe(3);
  expect(rows.lowestTop).toBeLessThan(rows.highestBottom);
  await page.getByRole("heading", { level: 1 }).getByRole("button").click();
  const sheet = page.getByRole("dialog", { name: "This chat" });
  await expect(sheet).toContainText("Assistant");
  await expect(sheet).toContainText("15 of 200k tokens");
  await expect(sheet.getByRole("button", { name: "Close" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
  // The focus goes back to what opened the sheet.
  await expect(page.getByRole("heading", { level: 1 }).getByRole("button")).toBeFocused();
  // A tap on the scrim above the sheet closes it too.
  await chooseFromMore(page, "Chat info");
  await expect(sheet).toBeVisible();
  await page.mouse.click(20, 20);
  await expect(sheet).toHaveCount(0);
  await expect(page.getByRole("button", { name: "More actions" })).toBeFocused();
});

test("a computer hides the chat details for more room, and the browser keeps the choice", async ({ page }) => {
  test.skip(test.info().project.name !== "desktop", "A phone shows the details in a sheet, never in a column.");
  await logIn(page);
  const chatId = await newChat(page);
  const panel = page.getByRole("complementary", { name: "This chat" });
  await expect(panel).toBeVisible();
  await page.getByRole("button", { name: "Hide the chat details" }).click();
  await expect(panel).toHaveCount(0);
  await page.goto(`/#/chat/${chatId}`);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("New chat");
  await expect(panel).toHaveCount(0);
  const show = page.getByRole("button", { name: "Show the chat details" });
  await expect(show).toHaveAttribute("aria-expanded", "false");
  await show.click();
  await expect(panel).toBeVisible();
  await expect(page.getByRole("button", { name: "Hide the chat details" })).toBeFocused();
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

test("a voice note sends what Eva heard, and its message can play the recording", async ({ page }) => {
  // A tone stands in for the microphone, so no browser flag and no real device is needed.
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () => {
      const context = new AudioContext();
      const tone = context.createOscillator();
      const output = context.createMediaStreamDestination();
      tone.connect(output);
      tone.start();
      return Promise.resolve(output.stream);
    };
  });
  await page.route("**/api/status", async (route) => {
    const response = await route.fetch();
    const status = (await response.json()) as Record<string, unknown>;
    await route.fulfill({ response, json: { ...status, voiceNotes: true } });
  });
  let audioType = "";
  await page.route("**/api/transcribe", async (route) => {
    audioType = (await route.request().headerValue("content-type")) ?? "";
    await route.fulfill({ json: { text: "Hello from my voice" } });
  });
  await logIn(page);
  await newChat(page);
  await page.getByRole("button", { name: "Record a voice note" }).first().click();
  await expect(page.getByRole("status").filter({ hasText: /Recording \d:\d\d/ })).toBeVisible();
  await page.getByRole("button", { name: "Send the voice note" }).click();

  // The switch hides the text, so the message is found by its switch.
  const message = page.locator(".message.user", { has: page.getByRole("group", { name: "Voice note" }) });
  await expect(message).toContainText("Hello from my voice");
  expect(audioType).toMatch(/^audio\//);
  await expect(page.locator(".message.answer").first()).toContainText("Hello from my voice");
  await message.getByRole("button", { name: "Recording" }).click();
  await expect(message.locator("audio")).toBeVisible();
  await expect(message).not.toContainText("Hello from my voice");
  await message.getByRole("button", { name: "Heard" }).click();
  await expect(message).toContainText("Hello from my voice");
});

test("without voice notes, the microphone leads to the button that installs them", async ({ page }) => {
  let installs = 0;
  await page.route("**/api/voice-notes/install", async (route) => {
    installs += 1;
    await route.fulfill({ json: { ok: true, message: "Installed voice notes. Press Restart Eva to turn them on." } });
  });
  await logIn(page);
  await newChat(page);
  await page.getByRole("button", { name: "Set up voice notes" }).first().click();
  await expect(page).toHaveURL(/#\/settings\/updates\/versions$/);
  const row = page.locator("dd", { hasText: "Off, needs" });
  await expect(row).toContainText("speech model");
  await row.getByRole("button", { name: "Install" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Installed voice notes" })).toBeVisible();
  expect(installs).toBe(1);
});

/** Plays the status with these open problems, and with the sync state changed as given. */
async function routeProblems(
  page: Page,
  problems: readonly { key: string; level: "warn" | "error"; message: string }[],
  vaultSync: Record<string, unknown> = {},
): Promise<void> {
  await page.route("**/api/status", async (route) => {
    const response = await route.fetch();
    const status = (await response.json()) as Record<string, unknown> & { vaultSync: Record<string, unknown> };
    await route.fulfill({
      response,
      json: {
        ...status,
        vaultSync: { ...status.vaultSync, ...vaultSync },
        problems: problems.map((problem) => problem.message),
        problemDetails: problems,
      },
    });
  });
}

test("open problems show in a banner at the top, each with the button that fixes it", async ({ page }) => {
  await routeProblems(page, [
    { key: "update", level: "error", message: "The update install failed." },
    { key: "schedule:lunch", level: "warn", message: "The schedule Lunch failed." },
  ]);
  await logIn(page);
  const banner = page.getByRole("region", { name: "Problems" });
  await expect(banner).toContainText("The update install failed.");
  await banner.getByRole("button", { name: "Open schedules" }).click();
  await expect(page.getByRole("heading", { name: "Schedules" })).toBeVisible();
  await page.getByRole("region", { name: "Problems" }).getByRole("button", { name: "Open Settings" }).click();
  await expect(
    page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: /^Settings/ }),
  ).toHaveAttribute("aria-current", "page");
  // A status read can still be in the route when the page closes.
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("a note conflict opens from its banner, and the last pick closes it", async ({ page }) => {
  await routeProblems(page, [{ key: "vault_sync", level: "error", message: "Notes/plan.md has a conflict." }], {
    status: "conflict",
  });
  await page.route("**/api/vault/conflicts", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ json: { state: { status: "conflict" }, conflicts: [planConflict] } });
      return;
    }
    await page.unroute("**/api/status");
    await route.fulfill({
      json: {
        found: true,
        conflicts: [],
        state: { status: "ok", lastCommitAt: null, lastPushAt: null, lastError: null, withheldFiles: [] },
      },
    });
  });
  await logIn(page);
  await page.getByRole("region", { name: "Problems" }).getByRole("button", { name: "Pick a version" }).click();
  const dialog = page.getByRole("dialog", { name: "Note conflicts" });
  await expect(dialog).toContainText("Eva kept both. Pick the one to keep.");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await page.getByRole("region", { name: "Problems" }).getByRole("button", { name: "Pick a version" }).click();
  await expect(dialog.getByText("- [ ] Buy coffee")).toBeVisible();
  await dialog.getByRole("button", { name: "Keep mine: Notes/plan.md" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Problems" })).toHaveCount(0);
  // A status read can still be in the route when the page closes.
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("a failure that Settings fixes offers the way there", async ({ page }) => {
  await logIn(page);
  await openList(page);
  await page.route("**/api/sessions", (route) =>
    route.request().method() === "POST"
      ? route.fulfill({
          status: 500,
          json: { error: "The engine claude-code is not available.", code: "engine_failed" },
        })
      : route.continue(),
  );
  await page.getByRole("navigation", { name: "Chats" }).getByRole("button", { name: "New chat", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("The engine claude-code is not available.");
  await page.getByRole("alert").getByRole("button", { name: "Open Settings" }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(
    page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: /^Settings/ }),
  ).toHaveAttribute("aria-current", "page");
});

test("a chat without a vault offers the vault step, not a terminal command", async ({ page }) => {
  await logIn(page);
  await openList(page);
  await page.route("**/api/sessions", (route) =>
    route.request().method() === "POST"
      ? route.fulfill({
          status: 404,
          json: {
            error: "Eva needs your vault. Finish the setup in Settings, on Eva's page.",
            code: "vault_not_found",
          },
        })
      : route.continue(),
  );
  await page.getByRole("navigation", { name: "Chats" }).getByRole("button", { name: "New chat", exact: true }).click();
  await page.getByRole("alert").getByRole("button", { name: "Set up your vault" }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page).toHaveURL(/#\/settings\/setup\/vault$/);
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
    const setup = (await response.json()) as { progress: { key: string; state: string; lastCheck: unknown }[] };
    const progress = setup.progress.map((step) =>
      step.key === "engine"
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
  const step = page.getByRole("region", { name: "An AI engine" });
  await expect(step).toContainText("The last test failed.");
  // The test waits until this test lets it go, so this test sees the progress bar of the wait.
  let release = (): void => undefined;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/checks/*", async (route) => {
    await released;
    await route.fulfill({ json: { ok: false, detail: "The token expired." } });
  });
  await step.getByRole("button", { name: "Test An AI engine" }).click();
  await expect(step.getByRole("progressbar", { name: "Testing An AI engine…" })).toBeVisible();
  release();
  await expect(step.getByRole("progressbar")).toHaveCount(0);
});

test("Settings: a step left is amber, and only a failed step is red (issue #208)", async ({ page }) => {
  await page.route("**/api/settings/setup", async (route) => {
    const response = await route.fetch();
    const setup = (await response.json()) as { progress: { key: string; state: string; lastCheck: unknown }[] };
    const progress = setup.progress.map((step) =>
      step.key === "engine"
        ? { ...step, state: "done", lastCheck: { ok: false, detail: "The token expired.", at: "2026-01-01T00:00:00Z" } }
        : step.key === "vault"
          ? { ...step, state: "missing", lastCheck: null }
          : step,
    );
    await route.fulfill({ response, json: { ...setup, progress } });
  });
  const token = (name: string): Promise<string> => tokenColour(page, name);
  await logIn(page);
  await openSettings(page);
  const bad = await token("--bad");
  const badBackground = await token("--bad-bg");
  const hero = page.getByRole("region", { name: "Setup" });
  await expect(hero).toContainText("Finish setting up Eva");
  expect(await style(hero, "borderTopColor")).not.toBe(bad);
  expect(await style(hero, "backgroundImage")).toBe("none");
  const count = (section: string): Locator =>
    page.locator(".section-card", { hasText: section }).getByLabel(/to set up/);
  expect(await style(count("Vault and sync"), "backgroundColor")).toBe(await token("--warn"));
  // The engine step failed its test, so its section's count is red, as the step is.
  await expect(count("AI engines")).toHaveAttribute("aria-label", "1 to set up, 1 failed");
  expect(await style(count("AI engines"), "backgroundColor")).toBe(bad);

  await openSettings(page, "Setup");
  const list = page.getByRole("region", { name: "Progress list" });
  const failed = list.getByRole("button").filter({ hasText: "Step 1" });
  const left = list.getByRole("button").filter({ hasText: "Your vault" });
  expect(await style(failed.locator(".status-icon"), "backgroundColor")).toBe(bad);
  await expect(left.locator(".status-icon")).toHaveAttribute("aria-label", "Needs you");
  expect(await style(left.locator(".status-icon"), "backgroundColor")).toBe(await token("--warn-bg"));
  expect(await style(left, "backgroundColor")).not.toBe(badBackground);
  // The status icon shows the state. A coloured stripe on one edge looks dated.
  expect(await style(left, "borderLeftWidth")).toBe("0px");
  await left.click();
  const header = page.locator(".step-header");
  expect(await style(header, "borderTopWidth")).toBe("0px");
  expect(await style(header.locator(".callout"), "backgroundColor")).toBe(await token("--warn-bg"));
  expect(await style(header.locator(".pill"), "backgroundColor")).toBe(await token("--warn-bg"));
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
    .getByRole("button", { name: /Step \d+ Your vault/ })
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
    .getByRole("button", { name: /Step \d+ Your vault/ })
    .click();
  await expect(page.getByRole("button", { name: "Log in with GitHub" })).toBeVisible();
  await page.getByRole("button", { name: "Paste a token instead" }).click();
  await expect(page.getByRole("button", { name: "Open the GitHub step" })).toBeVisible();
  await page.getByLabel("GitHub token", { exact: true }).fill("ghp_e2e-vault-step-token");
  await page.getByRole("button", { name: "Save the GitHub token" }).click();
  await expect(page.getByLabel("Your vault's repository")).toBeVisible();
  await expect(page.getByLabel("Name of the new private repository")).toHaveValue("vault");
  await page.request.delete("/api/secrets/githubToken");
});

test("Settings: the GitHub step logs in with a code, with no token to make (#243)", async ({ page }) => {
  let finishes = 0;
  await page.route("**/api/github/login", (route) =>
    route.fulfill({ json: { code: "WXYZ-1234", url: "https://github.com/login/device" } }),
  );
  // GitHub answers after the person types the code: the page shows the code while it waits.
  let allow: () => void = () => undefined;
  const allowed = new Promise<void>((resolve) => {
    allow = resolve;
  });
  await page.route("**/api/github/login/finish", async (route) => {
    finishes += 1;
    // A phone cuts the first long request when the browser goes to the background.
    if (finishes === 1) return route.abort("connectionreset");
    await allowed;
    await route.fulfill({ json: { restartNeeded: true } });
  });
  await logIn(page);
  await openSettings(page, "Setup");
  await page
    .getByRole("region", { name: "Progress list" })
    .getByRole("button", { name: /GitHub/ })
    .click();
  await expect(page.getByText("read and write all your GitHub repositories")).toBeVisible();
  // The hand-made token waits behind a link, and the login comes first.
  await expect(page.getByRole("link", { name: "GitHub's new token page" })).toHaveCount(0);
  await page.getByRole("button", { name: "Log in with GitHub" }).click();
  await expect(page.getByText("WXYZ-1234")).toBeVisible();
  await expect(page.getByRole("link", { name: "Open GitHub's page" })).toHaveAttribute(
    "href",
    "https://github.com/login/device",
  );
  await expect(page.getByRole("status").filter({ hasText: "Eva waits for GitHub" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Log in with GitHub" })).toBeDisabled();
  // The page asks again after the lost answer, and keeps the code meanwhile.
  await expect.poll(() => finishes).toBe(2);
  await expect(page.getByText("WXYZ-1234")).toBeVisible();
  allow();
  await expect(page.getByRole("status").filter({ hasText: "Logged in to GitHub" })).toBeVisible();
  await expect(page.getByText("WXYZ-1234")).toHaveCount(0);
  expect(finishes).toBe(2);
  await page.getByRole("button", { name: "Paste a token instead" }).click();
  await expect(page.getByRole("link", { name: "GitHub's new token page" })).toBeVisible();
});

test("Settings: a GitHub token without the agents' login needs the person (#244)", async ({ page }) => {
  await page.route("**/api/settings/setup", async (route) => {
    const response = await route.fetch();
    const setup = (await response.json()) as { progress: { key: string }[] };
    const progress = setup.progress.map((step) =>
      step.key === "github"
        ? {
            ...step,
            state: "missing",
            detail: "The token is saved, but your agents cannot push their work yet. Press Log in with GitHub again.",
          }
        : step,
    );
    await route.fulfill({ response, json: { ...setup, progress } });
  });
  await logIn(page);
  await openSettings(page, "Connections");
  const card = page.getByRole("region", { name: "GitHub", exact: true });
  await expect(card.getByText("Needs you", { exact: true })).toBeVisible();
  // The step page hides the step detail of a step to do, so the card says what to do.
  await expect(card).toContainText("Your agents cannot push their work yet. Press Log in with GitHub.");
  await expect(card).toContainText("The agents use it to push their work");
});

test("Settings: a GitHub login that fails says why, and the button works again", async ({ page }) => {
  await page.route("**/api/github/login", (route) =>
    route.fulfill({ json: { code: "WXYZ-1234", url: "https://github.com/login/device" } }),
  );
  await page.route("**/api/github/login/finish", (route) =>
    route.fulfill({ status: 409, json: { error: "The GitHub login code expired.", code: "github_failed" } }),
  );
  await logIn(page);
  await openSettings(page, "Connections");
  await page.getByRole("button", { name: "Log in with GitHub" }).click();
  await expect(page.getByText("The GitHub login code expired.")).toBeVisible();
  await expect(page.getByText("WXYZ-1234")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Log in with GitHub" })).toBeEnabled();
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
    .getByRole("button", { name: /Step \d+ Your vault/ })
    .click();
  await expect(page.getByText("Bad credentials")).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  await page.getByRole("button", { name: "Open the GitHub step" }).click();
  await expect(page.getByRole("region", { name: "GitHub", exact: true }).first()).toBeVisible();
});

test("Settings: Update to a version lists each version in a row, warns on a major one, and installs it", async ({
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
        headline: "Rename the keys.",
        // The browser uses the time zone of the test machine, so the day is the 12th or the 13th.
        publishedAt: "2025-10-12T12:00:00Z",
      },
      {
        version: "0.3.0",
        notes: "",
        level: "minor",
        summary: "New features:\n• feat: voice notes (0.3.0)",
        headline: "Voice notes.",
        publishedAt: null,
      },
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
  const card = page.getByRole("region", { name: "Eva updates" });
  await expect(card.getByText("1.0.0 is held back by the update policy (minor)")).toBeVisible();
  // A version waits, so EVE looks surprised.
  await expect(card.locator(".mk.e-surprise")).toHaveCount(1);
  await card.getByRole("button", { name: "Update to a version…" }).click();
  const dialog = page.getByRole("dialog", { name: "Update to a version" });
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  // Focus goes back to the button that opened the dialog.
  await expect(card.getByRole("button", { name: "Update to a version…" })).toBeFocused();
  await card.getByRole("button", { name: "Update to a version…" }).click();
  const versions = dialog.getByRole("radiogroup", { name: "Version" });
  await expect(versions.getByRole("radio")).toHaveCount(2);
  // Focus starts on the picked version.
  await expect(versions.getByRole("radio", { checked: true })).toBeFocused();
  await expect(versions).toContainText("v1.0.0");
  await expect(versions).toContainText(/1[23] Oct 2025/);
  await expect(versions).toContainText("Rename the keys.");
  await expect(versions).toContainText("Voice notes.");
  await expect(dialog.locator(".version-row.installed")).toContainText("v0.2.0");
  await expect(dialog.locator(".version-row.installed")).toContainText("Installed");
  await expect(versions.getByText("New", { exact: true })).toHaveCount(2);
  await expect(dialog.getByRole("alert")).toContainText("It can break things");
  await dialog.getByText("Every change up to v1.0.0").click();
  await expect(dialog.getByText("feat!: rename the keys (1.0.0)")).toBeVisible();
  await expect(dialog).toContainText("Your chats stay as they are.");
  if (test.info().project.name === "phone") {
    // A phone shows the dialog as a bottom sheet, with its buttons at full width.
    const box = await dialog.boundingBox();
    expect(Math.abs((box?.y ?? 0) + (box?.height ?? 0) - (page.viewportSize()?.height ?? 0))).toBeLessThanOrEqual(1);
    const heights = await dialog
      .locator("button, summary")
      .evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().height));
    expect(Math.min(...heights)).toBeGreaterThanOrEqual(44);
  }
  // The arrow keys move the pick, as in any radio group.
  await versions.getByRole("radio", { checked: true }).focus();
  await page.keyboard.press("ArrowDown");
  await expect(versions.getByRole("radio", { checked: true })).toHaveValue("0.3.0");
  await versions.getByRole("radio", { name: /v1\.0\.0/ }).check();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await versions.getByRole("radio", { name: /v0\.3\.0/ }).check();
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await dialog.getByRole("button", { name: "Update to v0.3.0 and restart" }).click();
  await expect.poll(() => installs).toEqual([{ version: "0.3.0" }]);
  await expect(dialog).toHaveCount(0);
});

test("Settings: the Versions card names a newer Eva, and its Update button opens the version dialog", async ({
  page,
}) => {
  const status = {
    kind: "executable",
    frequency: "daily",
    install: "minor",
    phase: "idle",
    current: "0.2.0",
    latest: "0.3.0",
    available: true,
    target: "0.3.0",
    heldBack: null,
    releases: [
      {
        version: "0.3.0",
        notes: "",
        level: "minor",
        summary: "New features:\n• feat: voice notes (0.3.0)",
        headline: "Voice notes.",
        publishedAt: null,
      },
    ],
    lastCheckAt: null,
    lastError: null,
    failedStep: null,
  };
  await page.route("**/api/update/check", async (route) => {
    await route.fulfill({ json: status });
  });
  await page.route("**/api/update", async (route) => {
    await route.fulfill({ json: status });
  });
  await logIn(page);
  await openSettings(page, "Updates");
  const card = page.getByRole("region", { name: "Versions" });
  await expect(card).toContainText("(0.3.0 available)");
  const update = card.getByRole("button", { name: "Update" }).first();
  await update.click();
  const dialog = page.getByRole("dialog", { name: "Update to a version" });
  await expect(dialog.getByRole("radio", { name: /v0\.3\.0/ })).toBeChecked();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  // Focus goes back to the button that opened the dialog.
  await expect(update).toBeFocused();
});

test("Settings: the changelog lists each release with its own changes", async ({ page }) => {
  await page.route("**/api/update/changelog", async (route) => {
    await route.fulfill({
      json: [
        {
          version: "0.3.0",
          publishedAt: null,
          headline: "Voice notes.",
          changes: "New features:\n• feat: voice notes (#7)",
          installed: false,
        },
        { version: "0.2.0", publishedAt: null, headline: null, changes: "No listed changes.", installed: true },
      ],
    });
  });
  await logIn(page);
  await openSettings(page, "Updates");
  const card = page.getByRole("region", { name: "Eva updates" });
  await card.getByRole("button", { name: "Changelog" }).click();
  const dialog = page.getByRole("dialog", { name: "Changelog" });
  await expect(dialog).toContainText("v0.3.0");
  await expect(dialog).toContainText("Voice notes.");
  await expect(dialog.locator(".version-row", { hasText: "v0.2.0" })).toContainText("Installed");
  await dialog.getByText("Every change in v0.3.0").click();
  await expect(dialog.getByText("feat: voice notes (#7)")).toBeVisible();
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(card.getByRole("button", { name: "Changelog" })).toBeFocused();
});

test("Settings: the changelog says why it cannot read the releases", async ({ page }) => {
  await page.route("**/api/update/changelog", async (route) => {
    await route.fulfill({
      status: 502,
      json: { error: "GitHub answered 403 for the list of releases.", code: "update_failed" },
    });
  });
  await logIn(page);
  await openSettings(page, "Updates");
  await page.getByRole("region", { name: "Eva updates" }).getByRole("button", { name: "Changelog" }).click();
  await expect(page.getByRole("dialog", { name: "Changelog" }).getByRole("status")).toContainText(
    "GitHub answered 403 for the list of releases.",
  );
});

test("Settings: the update choices are chips, and the major update policy shows a warning", async ({ page }) => {
  await logIn(page);
  await openSettings(page, "Updates");
  const policy = page.getByRole("group", { name: "Eva installs by herself" });
  await expect(page.getByText("With this choice, Eva installs it by herself.")).toHaveCount(0);
  await policy.getByRole("button", { name: "Every release, even major ones" }).click();
  await expect(page.getByRole("region", { name: "Eva updates" }).getByRole("alert")).toContainText("A major update");
  await expect(policy.getByRole("button", { name: "Every release, even major ones" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByText("With this choice, Eva installs it by herself.")).toBeVisible();
  await policy.getByRole("button", { name: "Fixes and new features" }).click();
  await expect(page.getByText("With this choice, Eva installs it by herself.")).toHaveCount(0);
  const frequency = page.getByRole("group", { name: "Install updates automatically" });
  await expect(frequency.getByRole("button")).toHaveCount(4);
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
  // The install worked, so EVE looks happy.
  await expect(page.getByRole("region", { name: "Eva updates" }).locator(".mk.e-joy")).toHaveCount(1);
});

test("Settings: an install shows a bar that fills with the download", async ({ page }) => {
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
    download: null,
  };
  let installing = false;
  let finish = (): void => undefined;
  const finished = new Promise<void>((resolve) => {
    finish = resolve;
  });
  await page.route("**/api/update", async (route) => {
    if (route.request().method() === "POST") {
      installing = true;
      // The request ends only after the download, as in Eva.
      await finished;
      installing = false;
      await route.fulfill({ json: { ...base, phase: "idle", current: "0.2.0", available: false } });
      return;
    }
    await route.fulfill({
      json: installing
        ? { ...base, phase: "updating", download: { receivedBytes: 42, totalBytes: 100 } }
        : { ...base, phase: "idle" },
    });
  });
  await logIn(page);
  await openSettings(page, "Updates");
  const card = page.getByRole("region", { name: "Eva updates" });
  await card.getByRole("button", { name: "Check and install" }).click();
  const bar = card.getByRole("progressbar", { name: "Installing 0.2.0…" });
  await expect(bar).toHaveAttribute("aria-valuenow", "42");
  await expect(card.getByText("42%", { exact: true })).toBeVisible();
  finish();
  await expect(card.getByRole("progressbar")).toHaveCount(0);
});

test("Settings: an install goes on when a proxy drops the request", async ({ page }) => {
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
    download: null,
  };
  let reads = 0;
  let posted = false;
  await page.route("**/api/update", async (route) => {
    if (route.request().method() === "POST") {
      posted = true;
      // `tailscale serve` gave up on the long request. The download goes on.
      await route.fulfill({ status: 502, body: "Bad Gateway" });
      return;
    }
    if (!posted) {
      await route.fulfill({ json: { ...base, phase: "idle" } });
      return;
    }
    reads += 1;
    // The download goes on for a moment, then the new Eva answers. Two loops read, so the
    // page may never see "restarting": the new version alone must say that the install worked.
    await route.fulfill({
      json:
        reads <= 2 ? { ...base, phase: "updating" } : { ...base, phase: "idle", current: "0.2.0", available: false },
    });
  });
  await logIn(page);
  await openSettings(page, "Updates");
  const card = page.getByRole("region", { name: "Eva updates" });
  await card.getByRole("button", { name: "Check and install" }).click();
  await expect(card.getByText("Eva restarted with the new version.")).toBeVisible({ timeout: 30_000 });
  await expect(card.getByText(/Bad Gateway/)).toHaveCount(0);
});

test("Settings: an error of Eva herself during an install shows its reason", async ({ page }) => {
  await page.route("**/api/update", async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({ status: 500, json: { error: "The release list is broken." } });
      return;
    }
    await route.fulfill({
      json: {
        kind: "executable",
        frequency: "daily",
        install: "minor",
        phase: "idle",
        current: "0.1.0",
        latest: "0.2.0",
        target: "0.2.0",
        heldBack: null,
        releases: [],
        available: true,
        lastCheckAt: null,
        lastError: null,
        failedStep: null,
        download: null,
      },
    });
  });
  await logIn(page);
  await openSettings(page, "Updates");
  const card = page.getByRole("region", { name: "Eva updates" });
  await card.getByRole("button", { name: "Check and install" }).click();
  await expect(card.getByText("The release list is broken.")).toBeVisible();
  await expect(card.getByRole("progressbar")).toHaveCount(0);
});

test("Settings: the Versions card shows the shape of its list while it reads", async ({ page }) => {
  let answer = (): void => undefined;
  const answered = new Promise<void>((resolve) => {
    answer = resolve;
  });
  await page.route("**/api/versions", async (route) => {
    await answered;
    await route.continue();
  });
  await logIn(page);
  await openSettings(page, "Updates");
  const card = page.getByRole("region", { name: "Versions" });
  await expect(card.getByRole("status")).toHaveText("Reading the versions…");
  await expect(card.locator(".skeleton-fact").first()).toBeVisible();
  const skeletonRows = card.locator(".skeleton-fact");
  const skeletonPitch = await rowPitch(skeletonRows.nth(0), skeletonRows.nth(1));
  answer();
  await expect(card.locator("dl.facts")).toBeVisible();
  await expect(card.locator(".skeleton")).toHaveCount(0);
  // Eva and git have no button, so their rows have the plain height of a fact.
  const names = card.locator("dl.facts dt");
  expect(skeletonPitch).toBeCloseTo(await rowPitch(names.nth(0), names.nth(1)), 0);
});

/** The distance from the top of one row to the top of the next. */
async function rowPitch(first: Locator, second: Locator): Promise<number> {
  const [a, b] = await Promise.all([first.boundingBox(), second.boundingBox()]);
  if (a === null || b === null) throw new Error("A row has no box.");
  return b.y - a.y;
}

test("Settings: the Versions card installs a missing tool and shows the new version", async ({ page }) => {
  let installed = false;
  const posts: unknown[] = [];
  await page.route("**/api/versions/latest", async (route) => {
    await route.fulfill({ json: [{ program: "uv", latest: "0.9.0" }] });
  });
  await page.route("**/api/versions", async (route) => {
    const tool = (program: string, version: string | null, installable: boolean, tooOld = false): object => ({
      program,
      feature: "a test",
      version,
      installable,
      tooOld,
    });
    await route.fulfill({
      json: {
        eva: "1.0.0",
        tools: [
          tool("git", "2.50.0", false),
          tool("claude", "2.1.300", true),
          tool("uv", "0.9.0", true),
          tool("gh", installed ? "2.62.0" : "2.4.0", true, !installed),
        ],
        voiceNotes: { missing: [], on: true },
      },
    });
  });
  await page.route("**/api/tools/install", async (route) => {
    posts.push(route.request().postDataJSON());
    installed = true;
    await route.fulfill({ json: { ok: true, message: "Installed gh." } });
  });
  await logIn(page);
  await openSettings(page, "Updates");
  const card = page.getByRole("region", { name: "Versions" });
  await expect(card.getByText("2.4.0, too old")).toBeVisible();
  // git has no installer in Eva, uv is the latest, and Eva cannot tell for claude.
  await expect(card.getByRole("button")).toHaveText(["Update", "Update"]);
  await card.getByRole("button").nth(1).click();
  await expect(card.getByText("Installed gh.")).toBeVisible();
  await expect(card.getByText("2.62.0")).toBeVisible();
  expect(posts).toEqual([{ program: "gh" }]);
});

/** Versions with claude, pi and gh installed, for the tests of the latest versions. */
async function routeToolVersions(page: Page, claude: () => string): Promise<void> {
  await page.route("**/api/versions", async (route) => {
    const tool = (program: string, version: string): object => ({
      program,
      feature: "a test",
      version,
      installable: true,
      tooOld: false,
    });
    await route.fulfill({
      json: {
        eva: "1.0.0",
        tools: [tool("claude", claude()), tool("pi", "1.3.0"), tool("gh", "2.62.0")],
        voiceNotes: { missing: [], on: true },
      },
    });
  });
}

test("Settings: the Versions card shows Update only for a tool with a newer version", async ({ page }) => {
  let answer = (): void => undefined;
  const answered = new Promise<void>((resolve) => {
    answer = resolve;
  });
  await routeToolVersions(page, () => "2.1.300");
  await page.route("**/api/versions/latest", async (route) => {
    await answered;
    await route.fulfill({
      json: [
        { program: "claude", latest: "2.1.300" },
        { program: "pi", latest: "1.4.0" },
        { program: "gh", latest: null },
      ],
    });
  });
  await logIn(page);
  await openSettings(page, "Updates");
  const card = page.getByRole("region", { name: "Versions" });
  // Until the latest versions answer, no Update button can start an install of a tool that is up to date.
  await expect(card.getByRole("button", { name: "Update" })).toHaveCount(3);
  for (const button of await card.getByRole("button", { name: "Update" }).all()) await expect(button).toBeDisabled();
  answer();
  await expect(card.getByText("1.3.0 (1.4.0 available)")).toBeVisible();
  // claude is the latest; Eva cannot tell for gh, so its button stays.
  await expect(card.getByRole("button")).toHaveText(["Update", "Update"]);
  await expect(card.getByRole("button").first()).toHaveClass(/primary/);
  await expect(card.getByRole("button").nth(1)).toHaveClass(/ghost/);
  await expect(page.getByRole("region", { name: "Claude Code update" })).toHaveCount(0);
});

test("Settings: the claude Update button runs claude update and shows its result", async ({ page }) => {
  const posts: string[] = [];
  let finished = false;
  await routeToolVersions(page, () => (finished ? "2.2.0" : "2.1.0"));
  await page.route("**/api/versions/latest", async (route) => {
    await route.fulfill({ json: [{ program: "claude", latest: "2.2.0" }] });
  });
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
  const card = page.getByRole("region", { name: "Versions" });
  await expect(card.getByText("2.1.0 (2.2.0 available)")).toBeVisible();
  finished = true;
  await card.getByRole("button", { name: "Update" }).first().click();
  await expect(card.getByText("Claude Code: updated from 2.1.0 to 2.2.0; the next turn uses it")).toBeVisible({
    timeout: 10_000,
  });
  // The row reads the new version, which is the latest, so its button goes.
  await expect(card.getByText("2.2.0", { exact: true })).toBeVisible();
  expect(posts).toEqual(["POST"]);
});

test("Settings: a page opened during the engine update follows it, past a failed read", async ({ page }) => {
  let reads = 0;
  await routeToolVersions(page, () => "2.1.0");
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
  const card = page.getByRole("region", { name: "Versions" });
  await expect(
    card.getByText("Claude Code: the update starts when the running chats and Eva's own update end"),
  ).toBeVisible();
  await expect(card.getByRole("button", { name: "Updating…" })).toBeDisabled();
  // No other tool installs while claude updates.
  await expect(card.getByRole("button", { name: "Update", exact: true })).toHaveCount(2);
  for (const button of await card.getByRole("button", { name: "Update", exact: true }).all())
    await expect(button).toBeDisabled();
  await expect(card.getByText("Claude Code: 2.1.0 is the latest")).toBeVisible({ timeout: 15_000 });
  await expect(card.getByRole("button").first()).toHaveText("Update");
  await expect(card.getByRole("button").first()).toBeEnabled();
});

test("a new chat that cannot reach Eva says so, and the message closes", async ({ page }) => {
  await logIn(page);
  await openList(page);
  await page.route("**/api/sessions", (route) =>
    route.request().method() === "POST" ? route.abort() : route.continue(),
  );
  await page.getByRole("navigation", { name: "Chats" }).getByRole("button", { name: "New chat", exact: true }).click();
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
    // With no project open, the project list is the page.
    await expect(page.getByRole("navigation", { name: "Projects" })).toBeVisible();
    // With a chat open, the list stays one tap away in its drawer.
    await openExampleApp(page);
    await (await newCloneCard(page)).getByRole("button", { name: "New chat here" }).click();
    await expect(page.getByRole("navigation", { name: "Projects" })).toBeHidden();
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
      "#/settings/developer/design",
      "#/settings/developer",
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
  await openProjects(page);
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
  const saveDetails = page.getByRole("button", { name: "Save details" });
  await saveDetails.click();
  await expect(page.getByRole("status")).toHaveText("Saved.");
  // The button itself confirms the save with a check, then goes back to its label.
  await expect(saveDetails).toHaveClass(/\bdone\b/);
  await expect(saveDetails.getByText("Saved", { exact: true })).toBeVisible();
  await expect(saveDetails).not.toHaveClass(/\bdone\b/, { timeout: 5000 });
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
  // Back goes to the project page; on a phone, the list is one more step back.
  await page.getByRole("button", { name: "Back", exact: true }).click();
  if (run === "phone") await page.getByRole("button", { name: "Back to the list" }).click();
  await expect(page.getByRole("button", { name: new RegExp(`Renamed ${run}`) })).toBeVisible();
});

test("Settings: Google sets up from the page, with a pasted login and a Test", async ({ page }) => {
  await logIn(page);
  await openSettings(page, "Connections");
  await openGoogleSteps(page);
  await expect(page.getByRole("link", { name: "Google Calendar API" })).toBeVisible();
  for (const [label, value] of [
    ["Google client id", "123456789012-clientid.apps.googleusercontent.com"],
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
  // A done login hides its steps: the card shows the account instead.
  await expect(page.getByRole("group", { name: "Google login" })).toContainText("person@example.com");
  const googleRow = page.locator(".check-row", { hasText: "Test Google" });
  await googleRow.getByRole("button", { name: "Test" }).click();
  await expect(googleRow.getByRole("img", { name: "Passed" })).toBeVisible();
  await expect(googleRow).toContainText("Eva can read Calendar, Drive, Contacts and Tasks of person@example.com.");
});

/** An earlier test may leave a Google login, which hides the setup steps behind Log in again. */
async function openGoogleSteps(page: Page): Promise<void> {
  await expect(page.locator(".check-row", { hasText: "Test Google" })).toBeVisible();
  const again = page.getByRole("group", { name: "Google login" }).getByRole("button", { name: "Log in again" });
  if (await again.isVisible()) await again.click();
}

test("Settings: Google access takes a preset, or a level for each service", async ({ page }) => {
  await logIn(page);
  await openSettings(page, "Connections");
  await openGoogleSteps(page);
  const access = page.getByRole("combobox", { name: /^Google access/ });
  await expect(access).toHaveValue("read");
  await expect(page.getByRole("combobox", { name: /^Contacts/ })).toHaveCount(0);
  await access.selectOption("custom");
  const contacts = page.getByRole("combobox", { name: /^Contacts/ });
  await expect(contacts).toHaveValue("readonly");
  // Gmail is off in the demo, so it has no select.
  await expect(page.getByRole("combobox", { name: /^Gmail/ })).toHaveCount(0);
  await contacts.selectOption("full");
  await expect(page.getByRole("status").filter({ hasText: "Log in to Google again" })).toBeVisible();
  await page.reload();
  await openGoogleSteps(page);
  // The levels match no preset, so the page shows "Custom" after a reload too.
  await expect(access).toHaveValue("custom");
  await expect(contacts).toHaveValue("full");
  await access.selectOption("lists");
  await expect(page.getByRole("combobox", { name: /^Contacts/ })).toHaveCount(0);
  // The next tests log in with read-only access.
  await access.selectOption("read");
  await expect(access).toHaveValue("read");
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
  const sockets = await routeEvents(page);
  // The demo server has no Tailscale, so the browser plays the server's side of the request.
  await page.route("**/api/devices/requests", (route) =>
    route.fulfill({
      json: [{ id: "request-3", code: "R4WZ", account: "owner@example.com", expiresAt: "2099-01-01T00:00:00.000Z" }],
    }),
  );
  await page.route("**/api/devices/requests/request-3", async (route) => {
    answers.push(route.request().postDataJSON());
    // The server tells every page that the request settled before it answers this page.
    sockets.at(-1)?.send(JSON.stringify({ kind: "device_login_settled", id: "request-3", answer: "allow" }));
    // Give the page time to handle the event: the notice must stay, with its buttons off.
    await page.waitForTimeout(300);
    await expect(
      page.getByRole("dialog", { name: "New device" }).getByRole("button", { name: "Allow" }),
    ).toBeDisabled();
    await route.fulfill({ status: 204 });
  });
  await logIn(page);
  const dialog = page.getByRole("dialog", { name: "New device" });
  await expect(dialog).toContainText("A new device wants to get in. Allow it?");
  await expect(dialog).toContainText("R4WZ");
  await dialog.getByRole("button", { name: "Allow" }).click();
  // EVE shows her delighted face a moment, then the notice closes.
  await expect(dialog).toContainText("Allowed. The new device opens Eva now.");
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
  await expect(list.getByRole("listitem").nth(1)).toContainText("This one");
  await expect(
    list
      .getByRole("listitem")
      .nth(1)
      .getByRole("button", { name: /Remove/ }),
  ).toHaveCount(0);
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

test("Settings: the device list names each device from its browser", async ({ page }) => {
  await page.route("**/api/devices", (route) =>
    route.fulfill({
      json: [
        {
          id: "cccccccccccccccc",
          label:
            "owner@example.com, Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0",
          createdAt: "2026-10-17T10:00:00.000Z",
          current: false,
        },
      ],
    }),
  );
  await logIn(page);
  await openSettings(page, "Access");
  const row = page.getByRole("list", { name: "Devices" }).getByRole("listitem");
  await expect(row).toContainText("Windows computer");
  await expect(row).toContainText("Chrome · owner@example.com · allowed");
  await expect(row.getByRole("button", { name: /^Remove Windows computer/ })).toBeVisible();
});

test("device login: a failed Allow never says Allowed, and shows why", async ({ page }) => {
  await page.route("**/api/devices/requests", (route) =>
    route.fulfill({
      json: [{ id: "request-5", code: "W2PX", account: "owner@example.com", expiresAt: "2099-01-01T00:00:00.000Z" }],
    }),
  );
  await page.route("**/api/devices/requests/request-5", (route) =>
    route.fulfill({ status: 404, json: { error: "That request expired." } }),
  );
  await logIn(page);
  const dialog = page.getByRole("dialog", { name: "New device" });
  await dialog.getByRole("button", { name: "Allow" }).click();
  await expect(page.getByRole("alert")).toContainText("That request expired.");
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText("Allowed. The new device opens Eva now.")).toHaveCount(0);
});

test("device login: Deny answers the new device, and the notice closes at once", async ({ page }) => {
  const answers: unknown[] = [];
  await page.route("**/api/devices/requests", (route) =>
    route.fulfill({
      json: [{ id: "request-4", code: "T7KM", account: "owner@example.com", expiresAt: "2099-01-01T00:00:00.000Z" }],
    }),
  );
  await page.route("**/api/devices/requests/request-4", async (route) => {
    answers.push(route.request().postDataJSON());
    await route.fulfill({ status: 204 });
  });
  await logIn(page);
  const dialog = page.getByRole("dialog", { name: "New device" });
  await expect(dialog).toContainText("T7KM");
  if (test.info().project.name === "phone") {
    // A phone shows the notice as a bottom sheet, with buttons a finger can hit.
    const box = await dialog.boundingBox();
    const viewport = page.viewportSize();
    expect((box?.y ?? 0) + (box?.height ?? 0)).toBeCloseTo(viewport?.height ?? 0, 0);
    const deny = await dialog.getByRole("button", { name: "Deny" }).boundingBox();
    expect(deny?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
  await dialog.getByRole("button", { name: "Deny" }).click();
  await expect(dialog).toHaveCount(0);
  expect(answers).toEqual([{ answer: "deny" }]);
});

test("Settings: Claude Code logs in from the page, with a pasted code", async ({ page }) => {
  const codes: string[] = [];
  let refuse = true;
  let answer: () => void = () => undefined;
  const answered = new Promise<void>((resolve) => {
    answer = resolve;
  });
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
          error: 'Claude did not accept the code. Press "Start the login" to try again.',
          code: "claude_login_failed",
        },
      });
      return;
    }
    // The real login takes seconds, and the page shows that it works meanwhile.
    await answered;
    await route.fulfill({ json: { restartNeeded: true } });
  });
  await logIn(page);
  await openSettings(page, "AI engines");
  // Each step has its own button: Claude's page waits for the link of step 1.
  await expect(page.getByRole("button", { name: "Open Claude's page" })).toBeDisabled();
  await page.getByRole("button", { name: "Start the login" }).click();
  await expect(page.getByRole("link", { name: "Open Claude's page" })).toHaveAttribute(
    "href",
    "https://claude.com/cai/oauth/authorize?code=true&state=e2e-state",
  );
  await expect(page.getByRole("button", { name: "Start again" })).toBeVisible();
  const code = page.getByLabel("The code from Claude's page");
  await code.fill("wrong-code");
  await page.getByRole("button", { name: "Finish" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Claude did not accept the code." })).toBeVisible();
  // The refused code ended the login, so its link goes, and a new login starts.
  await expect(page.getByRole("link", { name: "Open Claude's page" })).toBeHidden();
  await page.getByRole("button", { name: "Start the login" }).click();
  await expect(page.getByRole("link", { name: "Open Claude's page" })).toBeVisible();
  await code.fill("two words");
  await expect(page.getByRole("button", { name: "Finish" })).toBeDisabled();
  await code.fill("e2e-code#e2e-state");
  await page.getByRole("button", { name: "Finish" }).click();
  await expect(page.getByRole("button", { name: "Checking the code…" })).toBeDisabled();
  await expect(page.getByRole("status").filter({ hasText: "waits for the token" })).toBeVisible();
  answer();
  await expect(page.getByRole("status").filter({ hasText: "Logged in to Claude." })).toBeVisible();
  expect(codes).toEqual(["wrong-code", "e2e-code#e2e-state"]);
  // The token stays the way that needs a terminal, one tap away.
  await page.getByRole("button", { name: "Get a token in a terminal instead" }).click();
  await expect(page.getByText("claude setup-token").first()).toBeVisible();
  await expect(page.getByText("The pi login needs a terminal on Eva's computer")).toBeVisible();
});

test("Settings: a done Claude Code login shows as logged in, and logs out after a warning", async ({ page }) => {
  let saved = true;
  await page.route("**/api/settings", async (route) => {
    const response = await route.fetch();
    const settings = (await response.json()) as { secretsSet: Record<string, boolean> };
    await route.fulfill({
      response,
      json: { ...settings, secretsSet: { ...settings.secretsSet, claudeOauthToken: saved } },
    });
  });
  const removed: string[] = [];
  await page.route("**/api/secrets/claudeOauthToken", async (route) => {
    removed.push(route.request().method());
    saved = false;
    await route.fulfill({ json: { restartNeeded: true } });
  });
  await logIn(page);
  await openSettings(page, "AI engines");
  const loggedIn = page.getByRole("group", { name: "Claude Code login" });
  await expect(loggedIn).toContainText("You are logged in to Claude Code.");
  await expect(page.getByRole("button", { name: "Start the login" })).toHaveCount(0);
  await expect(page.locator(".check-row", { hasText: "Test the Claude Code token" })).toBeVisible();
  await loggedIn.getByRole("button", { name: "Log in again" }).click();
  await expect(page.getByRole("button", { name: "Start the login" })).toBeVisible();
  await page.getByRole("button", { name: "Keep the current login" }).click();
  await loggedIn.getByRole("button", { name: "Log out of Claude Code" }).click();
  const question = page.getByRole("dialog", { name: "Log out of Claude Code" });
  await expect(question).toContainText("Chats with Claude Code stop until you log in again.");
  await question.getByRole("button", { name: "Log out", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Logged out of Claude Code." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start the login" })).toBeVisible();
  expect(removed).toEqual(["DELETE"]);
});

test("Settings: a saved GitHub token whose last test failed keeps the login steps", async ({ page }) => {
  await page.route("**/api/settings", async (route) => {
    const response = await route.fetch();
    const settings = (await response.json()) as { secretsSet: Record<string, boolean> };
    await route.fulfill({ response, json: { ...settings, secretsSet: { ...settings.secretsSet, githubToken: true } } });
  });
  await page.route("**/api/settings/setup", async (route) => {
    const response = await route.fetch();
    const setup = (await response.json()) as { progress: { key: string; state: string; lastCheck: unknown }[] };
    const progress = setup.progress.map((step) =>
      step.key === "github"
        ? { ...step, state: "done", lastCheck: { ok: false, detail: "Bad credentials.", at: "2026-01-01T00:00:00Z" } }
        : step,
    );
    await route.fulfill({ response, json: { ...setup, progress } });
  });
  await logIn(page);
  await openSettings(page, "Connections");
  const card = page.getByRole("region", { name: "GitHub", exact: true });
  // A revoked token is no done login: the fix is a new login, so its button stays in sight.
  await expect(card).toContainText("The last test of the GitHub token failed.");
  await expect(card.getByRole("button", { name: "Log in with GitHub" })).toBeVisible();
  await expect(card.getByRole("group", { name: "GitHub login" })).toHaveCount(0);
});

test("Settings: a Google login shows its account, and logs out after a warning", async ({ page }) => {
  let email: string | null = "person@example.com";
  await page.route("**/api/settings", async (route) => {
    const response = await route.fetch();
    const settings = (await response.json()) as { config: { google: Record<string, unknown> } };
    await route.fulfill({
      response,
      json: { ...settings, config: { ...settings.config, google: { ...settings.config.google, email } } },
    });
  });
  const logOuts: string[] = [];
  await page.route("**/api/google/login", async (route) => {
    if (route.request().method() !== "DELETE") return route.fallback();
    logOuts.push("DELETE");
    email = null;
    await route.fulfill({ json: { restartNeeded: true } });
  });
  await logIn(page);
  await openSettings(page, "Connections");
  const card = page.getByRole("region", { name: "Google", exact: true });
  const loggedIn = card.getByRole("group", { name: "Google login" });
  await expect(loggedIn).toContainText("You are logged in to Google as person@example.com.");
  // The setup steps wait behind Log in again, which also holds the access choice.
  await expect(card.getByRole("button", { name: "Start the Google login" })).toHaveCount(0);
  await loggedIn.getByRole("button", { name: "Log in again" }).click();
  await expect(card.getByRole("button", { name: "Start the Google login" })).toBeVisible();
  await expect(card.getByLabel("Google access")).toBeVisible();
  await card.getByRole("button", { name: "Keep the current login" }).click();
  await loggedIn.getByRole("button", { name: "Log out of Google" }).click();
  const question = page.getByRole("dialog", { name: "Log out of Google" });
  await expect(question).toContainText("The OAuth client stays");
  await question.getByRole("button", { name: "Log out", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Logged out of Google." })).toBeVisible();
  await expect(card.getByRole("button", { name: "Start the Google login" })).toBeVisible();
  expect(logOuts).toEqual(["DELETE"]);
});

test("Settings: a paired Telegram bot shows as connected, and disconnects after a warning", async ({ page }) => {
  let saved = true;
  await page.route("**/api/settings", async (route) => {
    const response = await route.fetch();
    const settings = (await response.json()) as { secretsSet: Record<string, boolean> };
    await route.fulfill({
      response,
      json: { ...settings, secretsSet: { ...settings.secretsSet, telegramBotToken: saved } },
    });
  });
  await page.route("**/api/settings/setup", async (route) => {
    const response = await route.fetch();
    const setup = (await response.json()) as { progress: { key: string }[] };
    const progress = setup.progress.map((step) => (step.key === "telegram" ? { ...step, state: "done" } : step));
    await route.fulfill({ response, json: { ...setup, progress, telegram: { paired: true, pairingCode: null } } });
  });
  await page.route("**/api/secrets/telegramBotToken", async (route) => {
    saved = false;
    await route.fulfill({ json: { restartNeeded: true } });
  });
  await logIn(page);
  await openSettings(page, "Connections");
  const card = page.getByRole("region", { name: "Telegram", exact: true });
  const connected = card.getByRole("group", { name: "Telegram login" });
  await expect(connected).toContainText("Your Telegram bot is paired with your chat.");
  await expect(card.getByLabel("Telegram bot token", { exact: true })).toHaveCount(0);
  await connected.getByRole("button", { name: "Set up again" }).click();
  await expect(card.getByLabel("Telegram bot token", { exact: true })).toBeVisible();
  await card.getByRole("button", { name: "Keep the current bot" }).click();
  await connected.getByRole("button", { name: "Disconnect Telegram" }).click();
  const question = page.getByRole("dialog", { name: "Disconnect Telegram" });
  await expect(question).toContainText("Your bot stops answering");
  await question.getByRole("button", { name: "Disconnect", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Disconnected Telegram." })).toBeVisible();
  await expect(card.getByLabel("Telegram bot token", { exact: true })).toBeVisible();
});

test("Files: folders open, a Markdown file shows formatted or plain, and Back returns to the last folder (issue 253)", async ({
  page,
}) => {
  await logIn(page);
  await page.getByRole("button", { name: "Files", exact: true }).click();
  const list = (name: string): Locator => page.getByRole("list", { name: `Contents of ${name}` });
  await list("Vault").getByRole("link", { name: "Projects" }).click();
  await list("Projects").getByRole("link", { name: "2025-03-02-1015-example-app" }).click();
  await list("2025-03-02-1015-example-app")
    .getByRole("link", { name: /AGENTS\.md/ })
    .click();
  const file = page.getByRole("region", { name: "File text" });
  await expect(file.getByRole("heading", { name: "Example app" })).toBeVisible();
  await page.getByRole("button", { name: "Show plain text" }).click();
  await expect(file.getByRole("heading", { name: "Example app" })).toHaveCount(0);
  await expect(file.getByText("# Example app")).toBeVisible();
  // The address holds the path, so a reload keeps the file and Back goes up a folder.
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "AGENTS.md" })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("heading", { level: 1, name: "2025-03-02-1015-example-app" })).toBeVisible();
  await page.getByRole("navigation", { name: "Folder path" }).getByRole("link", { name: "Vault" }).click();
  await expect(list("Vault").getByRole("link", { name: ".eva" })).toBeVisible();
  await expect(list("Vault").getByRole("link", { name: ".git" })).toHaveCount(0);
});

test("Files: a wide screen shows each folder of the path as a column, and the file can fill the page (issue 308)", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name === "phone", "A phone shows the last column alone.");
  await logIn(page);
  await page.goto("/#/files/Projects/2025-03-02-1015-example-app/AGENTS.md");
  const vaultList = page.getByRole("list", { name: "Contents of Vault" });
  const file = page.getByRole("region", { name: "File text" });
  await expect(vaultList).toBeVisible();
  await expect(page.getByRole("list", { name: "Contents of Projects" })).toBeVisible();
  await expect(file.getByRole("heading", { name: "Example app" })).toBeVisible();
  // The open folder of each column is marked, so the path shows at a glance.
  await expect(vaultList.getByRole("link", { name: "Projects" })).toHaveAttribute("aria-current", "true");
  await file.getByRole("button", { name: "Make the file large" }).click();
  await expect(vaultList).toBeHidden();
  await page.keyboard.press("Escape");
  await expect(vaultList).toBeVisible();
  await file.getByRole("button", { name: "Make the file large" }).click();
  await file.getByRole("button", { name: "Make the file small" }).click();
  await expect(vaultList).toBeVisible();
});

test("Files: a file shows its type in colour, and a long name loses the part that the person picks", async ({
  page,
}) => {
  const name = "Quarterly report for the board meeting of the year, final version.pdf";
  await page.route("**/api/files?path=Docs", (route) =>
    route.fulfill({
      json: {
        kind: "folder",
        path: "Docs",
        entries: [
          { name, kind: "file", size: 1234 },
          { name: "Makefile", kind: "file", size: 10 },
        ],
      },
    }),
  );
  await logIn(page);
  await page.goto("/#/files/Docs");
  const row = page.getByRole("list", { name: "Contents of Docs" }).getByRole("link", { name });
  await expect(row.locator(".files-badge.type-red")).toHaveText("PDF");
  // The middle gives way by default, so the start and the extension stay.
  await expect(page.locator("html")).toHaveAttribute("data-file-name-cut", "middle");
  await expect(row.locator(".files-name-tail")).toHaveText(/version\.pdf$/);
  const headIsCut = await row
    .locator(".files-name-head")
    .evaluate((element) => element.scrollWidth > element.clientWidth);
  expect(headIsCut).toBe(true);
  await openSettings(page, "Personalize");
  await page.getByRole("group", { name: "Long file names" }).getByRole("button", { name: "End" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-file-name-cut", "end");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-file-name-cut", "end");
});

test("Files: a wide column takes at least a quarter of the row", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "phone", "A phone shows the last column alone.");
  await logIn(page);
  await page.goto("/#/files/Projects");
  const row = page.locator(".files-columns");
  const column = page.locator(".files-pane").filter({ has: page.getByRole("list", { name: "Contents of Vault" }) });
  await expect(column).toBeVisible();
  const rowWidth = (await row.boundingBox())?.width ?? 0;
  const columnWidth = (await column.boundingBox())?.width ?? 0;
  expect(columnWidth).toBeGreaterThanOrEqual(rowWidth / 4 - 16);
});

test("Files: the one folder view shows only the open folder, and the path leads back", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "phone", "A phone always shows one folder.");
  await logIn(page);
  await openSettings(page, "Personalize");
  await page.getByRole("group", { name: "Files view" }).getByRole("button", { name: "One folder" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-files-view", "single");
  await page.goto("/#/files/Projects/2025-03-02-1015-example-app/AGENTS.md");
  const file = page.getByRole("region", { name: "File text" });
  await expect(file.getByRole("heading", { name: "Example app" })).toBeVisible();
  await expect(page.getByRole("list", { name: "Contents of Vault" })).toBeHidden();
  await expect(page.getByRole("button", { name: "Make the file large" })).toBeHidden();
  await page.getByRole("navigation", { name: "Folder path" }).getByRole("link", { name: "Projects" }).click();
  await expect(page.getByRole("list", { name: "Contents of Projects" })).toBeVisible();
  await expect(page.getByRole("list", { name: "Contents of Vault" })).toBeHidden();
  await expect(page.getByText("Open a file to see it here.")).toBeHidden();
});

test("Files: a phone shows only the open folder (issue 308)", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "phone", "A wide screen shows every column.");
  await logIn(page);
  await page.goto("/#/files/Projects");
  await expect(page.getByRole("list", { name: "Contents of Projects" })).toBeVisible();
  await expect(page.getByRole("list", { name: "Contents of Vault" })).toBeHidden();
  await expect(page.getByRole("button", { name: "Make the file large" })).toHaveCount(0);
});

test("Files: on a phone, the buttons leave the folder name room for whole words", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "phone", "A wide screen has room for the path and the buttons.");
  await logIn(page);
  await page.goto("/#/files/Projects");
  const path = page.getByRole("navigation", { name: "Folder path" });
  const name = path.getByRole("heading", { name: "Projects" });
  await expect(name).toBeVisible();
  await expect(page.getByRole("button", { name: "Download this folder as a zip file" })).toBeVisible();
  // A squeezed name breaks after each letter, so its box gets tall and narrow.
  const box = await name.boundingBox();
  const lineHeight = await name.evaluate((element) => Number.parseFloat(getComputedStyle(element).lineHeight));
  expect(box?.height ?? 0).toBeLessThan(lineHeight * 1.5);
  const parent = path.getByRole("link", { name: "Vault" });
  const parentBox = await parent.boundingBox();
  expect(parentBox?.height ?? 0).toBeLessThan(lineHeight * 1.5);
});

test("Files: the person edits a note, saves it in the vault, and sees it formatted again (issue 308)", async ({
  page,
}, testInfo) => {
  await logIn(page);
  const path = `Notes/${testInfo.project.name}-list.md`;
  await page.goto(`/#/files/${path}`);
  const file = page.getByRole("region", { name: "File text" });
  await expect(file.getByRole("heading", { name: "Shopping" })).toBeVisible();
  await file.getByRole("button", { name: "Edit" }).click();
  const editor = file.getByRole("textbox", { name: `Text of ${path}` });
  await expect(editor).toHaveValue("# Shopping\n\n- Milk\n");
  await editor.fill("# Shopping\n\n- Milk\n- Bread\n");
  await file.getByRole("button", { name: "Save" }).click();
  await expect(file.getByRole("listitem").filter({ hasText: "Bread" })).toBeVisible();
  await expect(editor).toHaveCount(0);
  // The core wrote the file: a reload reads it from the vault.
  await page.reload();
  await expect(file.getByRole("listitem").filter({ hasText: "Bread" })).toBeVisible();
});

test("Files: the person renames a note, and its new address opens it (issue 343)", async ({ page }, testInfo) => {
  await logIn(page);
  const run = testInfo.project.name;
  await page.goto(`/#/files/Notes/${run}-draft.md`);
  const file = page.getByRole("region", { name: "File text" });
  await expect(file.getByRole("heading", { name: "Draft" })).toBeVisible();
  await page.getByRole("button", { name: `Rename ${run}-draft.md` }).click();
  const field = page.getByRole("textbox", { name: `New name of ${run}-draft.md` });
  await field.fill("bad:name.md");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("A name cannot hold these characters")).toBeVisible();
  await field.fill(`${run}-plan.md`);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page).toHaveURL(new RegExp(`#/files/Notes/${run}-plan\\.md$`));
  await expect(page.getByRole("heading", { name: `${run}-plan.md`, level: 1 })).toBeVisible();
  await expect(file.getByRole("heading", { name: "Draft" })).toBeVisible();
  // The core renamed the file: a reload reads it from the vault.
  await page.reload();
  await expect(file.getByRole("heading", { name: "Draft" })).toBeVisible();
});

test("Files: a save of a file that changed meanwhile asks to load it again (issue 308)", async ({ page }) => {
  await logIn(page);
  await page.route("**/api/files", async (route) => {
    if (route.request().method() !== "PUT") return route.continue();
    return route.fulfill({
      status: 409,
      json: {
        error: "The file changed since you opened it. Load it again, then redo your change.",
        code: "file_changed",
      },
    });
  });
  await page.goto("/#/files/Notes/settings.json");
  const file = page.getByRole("region", { name: "File text" });
  await file.getByRole("button", { name: "Edit" }).click();
  await file.getByRole("textbox").fill("{}");
  await file.getByRole("button", { name: "Save" }).click();
  await expect(file.getByRole("alert")).toContainText("The file changed since you opened it.");
  await file.getByRole("button", { name: "Load again" }).click();
  await expect(file.getByRole("textbox")).toHaveValue('{"theme":"dark","size":2}');
});

test("Files: an edit stays while the person goes to another folder or page, and a save says so (issue 308)", async ({
  page,
}) => {
  await logIn(page);
  // The save answers the file as it is, so the file stays the same for the other tests.
  let saves = 0;
  await page.route("**/api/files", async (route) => {
    if (route.request().method() !== "PUT") return route.continue();
    saves += 1;
    await new Promise((resolve) => setTimeout(resolve, 300));
    const read = await route.fetch({ method: "GET", url: `${route.request().url()}?path=Notes%2Fsettings.json` });
    return route.fulfill({ response: read });
  });
  await page.goto("/#/files/Notes/settings.json");
  const file = page.getByRole("region", { name: "File text" });
  await file.getByRole("button", { name: "Edit" }).click();
  await file.getByRole("textbox").fill('{"theme":"light"}');
  await page.getByRole("navigation", { name: "Folder path" }).getByRole("link", { name: "Notes" }).click();
  await page.getByRole("button", { name: "Chats", exact: true }).click();
  await page.getByRole("button", { name: "Files", exact: true }).click();
  await page.getByRole("list", { name: "Contents of Vault" }).getByRole("link", { name: "Notes" }).click();
  await page
    .getByRole("list", { name: "Contents of Notes" })
    .getByRole("link", { name: /settings\.json/ })
    .click();
  await expect(file.getByRole("textbox")).toHaveValue('{"theme":"light"}');
  await file.getByRole("button", { name: "Save" }).dblclick();
  await expect(file.getByRole("textbox")).toHaveCount(0);
  expect(saves).toBe(1);
  await expect(file.getByRole("alert")).toHaveCount(0);
  await expect(file.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();
});

test("Files: JSON shows indented, and its plain text shows as on disk (issue 308)", async ({ page }) => {
  await logIn(page);
  await page.goto("/#/files/Notes/settings.json");
  const file = page.getByRole("region", { name: "File text" });
  await expect(file.locator("pre")).toHaveText('{\n  "theme": "dark",\n  "size": 2\n}');
  await expect(file.locator(".code-key").first()).toHaveText('"theme"');
  await file.getByRole("button", { name: "Show plain text" }).click();
  await expect(file.locator("pre")).toHaveText('{"theme":"dark","size":2}');
});

test("Files: a path that the core tidies still shows its folder (issue 253)", async ({ page }) => {
  await logIn(page);
  // The page keeps `Projects\`, and the core answers for `Projects`.
  await page.goto("/#/files/Projects%5C");
  await expect(page.getByRole("list", { name: "Contents of Projects\\" })).toBeVisible();
  await expect(page.getByRole("link", { name: "2025-03-02-1015-example-app" })).toBeVisible();
});

test("Files: Try again reads a folder again after a failed read (issue 253)", async ({ page }) => {
  await logIn(page);
  let failNext = true;
  await page.route("**/api/files?path=Projects", async (route) => {
    if (!failNext) return route.continue();
    failNext = false;
    return route.fulfill({ status: 500, json: { error: "Eva failed to handle the request." } });
  });
  await page.goto("/#/files/Projects");
  await expect(page.getByRole("alert").filter({ hasText: "Eva failed to handle the request." })).toBeVisible();
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("link", { name: "2025-03-02-1015-example-app" })).toBeVisible();
});

test("Files: the person stars a note, it shows first on the page, and a tap opens it (issue 349)", async ({
  page,
}, testInfo) => {
  await logIn(page);
  const name = `${testInfo.project.name}-list.md`;
  await page.goto(`/#/files/Notes/${name}`);
  const favorites = page.getByRole("navigation", { name: "Favorites" });
  await expect(page.getByRole("region", { name: "File text" })).toBeVisible();
  await page.getByRole("button", { name: "Add to favorites" }).click();
  await expect(page.getByRole("button", { name: "Remove from favorites" })).toHaveAttribute("aria-pressed", "true");
  await expect(favorites.getByRole("link", { name })).toHaveAttribute("aria-current", "page");

  // The favorites live in the vault, so they stay after a reload, on any folder of the page.
  await page.goto("/#/files/Projects");
  await page.reload();
  await favorites.getByRole("link", { name }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  await page.getByRole("button", { name: "Remove from favorites" }).click();
  await expect(page.getByRole("button", { name: "Add to favorites" })).toBeVisible();
  await expect(favorites.getByRole("link", { name })).toHaveCount(0);
});

test("Files: a favorite that is gone shows as missing, and the person removes it (issue 349)", async ({ page }) => {
  await logIn(page);
  const stored = [{ path: "Old/gone.md", name: "gone.md", kind: "missing" }];
  await page.route("**/api/files/favorites", async (route) => {
    if (route.request().method() === "GET") await route.fulfill({ json: stored });
    else await route.fulfill({ json: [] });
  });
  await page.goto("/#/files");
  const favorites = page.getByRole("navigation", { name: "Favorites" });
  await expect(favorites.getByText("Missing")).toBeVisible();
  await favorites.getByRole("button", { name: "Remove gone.md from favorites" }).click();
  await expect(favorites).toHaveCount(0);
});

test("Files: a file and a folder download from their own button, and a failed download says why", async ({ page }) => {
  await logIn(page);
  await page.goto("/#/files/Projects/2025-03-02-1015-example-app/AGENTS.md");
  const file = page.getByRole("region", { name: "File text" });
  await expect(file.getByRole("heading", { name: "Example app" })).toBeVisible();
  const fileDownload = page.waitForEvent("download");
  await file.getByRole("button", { name: "Download this file" }).click();
  expect((await fileDownload).suggestedFilename()).toBe("AGENTS.md");

  await page.goto("/#/files/Projects");
  const folderDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download this folder as a zip file" }).click();
  expect((await folderDownload).suggestedFilename()).toBe("Projects.zip");

  await page.route("**/api/files/download?path=Projects", (route) =>
    route.fulfill({ status: 409, json: { error: "This is larger than 200 MB, so Eva does not download it." } }),
  );
  await page.getByRole("button", { name: "Download this folder as a zip file" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "larger than 200 MB" })).toBeVisible();
});

test("on a special day, EVE greets with that day's eyes, and the tab icon wears them", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-12-25T12:00:00"));
  await logIn(page);
  await newChat(page);
  const greeting = page.locator(".new-chat");
  await expect(greeting.getByRole("heading", { level: 2 })).toHaveText("Merry Christmas!");
  await expect(greeting.locator(".mk.festive.f-spin")).toBeVisible();
  await expect(greeting.locator(".festive-decoration svg")).toBeVisible();
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute("href", /^data:image\/svg\+xml,/);
});

test("a fact that Eva still needs shows as one special suggestion, and the answer goes to Eva", async ({ page }) => {
  await page.clock.setFixedTime(ordinaryDay);
  await logIn(page);
  await newChat(page);
  // The demo vault has no birthday yet, so Eva asks for it first.
  await page.getByRole("button", { name: "Hey Eva! I was born on…" }).click();
  const dialog = page.getByRole("dialog", { name: "Tell Eva your birthday" });
  const field = dialog.getByLabel("Your birthday");
  await expect(field).toBeFocused();
  await expect(dialog.getByRole("button", { name: "Tell Eva" })).toBeDisabled();
  await field.fill("1990-05-14");
  await dialog.getByRole("button", { name: "Tell Eva" }).click();
  await expect(page.locator(".message.answer").first()).toContainText("I was born on 1990-05-14");
});
