/**
 * Takes the captures of the EVE design guide (`docs/design/eve/screenshots/`) from the real web page.
 * Each page of the guide gets four captures: computer and phone, light and dark.
 * The demo server holds example data only, so a capture never shows a person's real data.
 *
 * Start a new demo first, in the checkout to capture: `bun run test/e2e/serve-demo.ts`.
 * The script adds chats, schedules and a clone to the demo, so start a new demo for each run.
 *
 * Usage: bun run scripts/capture-design.ts [out-dir] [page ...]
 *   The default out-dir is docs/design/eve/screenshots. With no page, the script captures each page.
 *   Set EVA_CAPTURE_CHROMIUM to a Chromium program when Playwright has no browser of its own version.
 *   Set EVA_E2E_PORT and EVA_E2E_GALLERY_PORT to the ports of the demo when they are not the defaults.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Browser, BrowserContext, Page } from "@playwright/test";
import { e2ePorts } from "../test/e2e/e2e-ports.ts";
import { specialDayOn } from "../src/frontends/web/client/special-days.ts";
import { demoUrl, launchBrowser, logIn } from "./demo-browser.ts";

interface View {
  readonly device: "computer" | "phone";
  readonly theme: "light" | "dark";
}

/** The chats and the clone that the setup makes, for the pages that show them. */
interface Demo {
  readonly weekChat: string;
  readonly projectChat: string;
}

interface Scene {
  readonly name: string;
  /** Brings the logged-in page to the state of the capture. Gives the id of a chat that it starts. */
  readonly show: (page: Page, view: View, demo: Demo) => Promise<unknown>;
  /** Puts the page back, so the next scene starts from a clean page. */
  readonly after?: (page: Page, startedChat: unknown) => Promise<void>;
}

const views: readonly View[] = [
  { device: "computer", theme: "light" },
  { device: "computer", theme: "dark" },
  { device: "phone", theme: "light" },
  { device: "phone", theme: "dark" },
];

// A phone capture has twice the pixels, so its text stays sharp beside the computer capture.
const sizes = {
  computer: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 },
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 },
} as const;

const webpQuality = 0.85;
const galleryUrl = `http://127.0.0.1:${String(e2ePorts().gallery)}/`;

const [outDir = "docs/design/eve/screenshots", ...wanted] = process.argv.slice(2);

/** A note conflict that the demo cannot make by itself. The words come from the browser tests. */
const planConflict = {
  path: "Notes/plan.md",
  kind: "committed",
  picked: null,
  mine: "- [ ] Review pull request #42\n- [ ] Thursday demo at 9\n",
  theirs: "- [ ] Review pull request #42\n- [ ] Buy coffee\n",
};

async function openChat(page: Page, id: string): Promise<void> {
  await page.evaluate((hash) => {
    window.location.hash = hash;
  }, `#/chat/${id}`);
  await page.locator(".message.answer, .approval-card").first().waitFor();
}

async function openAddress(page: Page, address: string, ready: string): Promise<void> {
  await page.evaluate((hash) => {
    window.location.hash = hash;
  }, address);
  await page.getByRole("heading", { level: 1, name: ready }).waitFor();
}

/** With no project open, the list shows on both sizes, and the page has no title yet. */
async function openProjects(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.location.hash = "#/projects";
  });
  await page.getByRole("navigation", { name: "Projects" }).waitFor();
}

/** A phone hides the chat list behind a button. */
async function openList(page: Page): Promise<void> {
  const menu = page.getByRole("button", { name: "Show the list" });
  if (await menu.isVisible()) await menu.click();
}

/** Starts a new Assistant chat, and gives its id once the page shows it. */
async function newChat(page: Page): Promise<string> {
  await page.evaluate(() => {
    window.location.hash = "#/chats";
  });
  await openList(page);
  const created = page.waitForResponse(
    (response) => response.url().endsWith("/api/sessions") && response.request().method() === "POST",
  );
  await page.getByRole("navigation", { name: "Chats" }).getByRole("button", { name: "New chat", exact: true }).click();
  const id = ((await (await created).json()) as { id: string }).id;
  await page.getByRole("heading", { level: 1, name: "New chat" }).waitFor();
  return id;
}

async function send(page: Page, text: string): Promise<void> {
  const composer = page.getByLabel("Message").first();
  await composer.fill(text);
  await composer.press("Enter");
}

async function rename(page: Page, title: string): Promise<void> {
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Rename" }).click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type(title);
  await page.keyboard.press("Enter");
  await page.getByRole("heading", { level: 1, name: title }).waitFor();
}

async function addSchedule(
  page: Page,
  schedule: { id: string; name: string; time: string; days: string[] },
): Promise<void> {
  await page.getByRole("button", { name: "Add schedule" }).click();
  const form = page.getByRole("dialog", { name: "Add schedule" });
  await form.getByLabel(/^Id/).fill(schedule.id);
  await form.getByLabel("Name").fill(schedule.name);
  await form.getByLabel("Time (HH:MM)").fill(schedule.time);
  for (const day of schedule.days) await form.getByRole("button", { name: day }).click();
  await form.getByLabel("Fixed text").fill(`${schedule.name}.`);
  await form.getByRole("button", { name: "Save schedule" }).click();
  // No front end shows cards in the demo, so the new schedule's card waits in a dialog.
  await page.getByRole("dialog", { name: "Setup card" }).getByRole("button", { name: "Got it" }).click();
  await page.getByRole("listitem", { name: schedule.name }).waitFor();
}

/** Starts a chat with one message, waits for its answer, and gives the chat a title and gives its id. */
async function answeredChat(page: Page, text: string, title: string): Promise<string> {
  const id = await newChat(page);
  await send(page, text);
  await page
    .locator(".message.answer")
    .filter({ hasText: /Done\.|Echo/ })
    .waitFor();
  await rename(page, title);
  return id;
}

/** Fills the demo with the chats, schedules and clone that the pages show. */
async function setUp(browser: Browser): Promise<Demo> {
  const page = await browser.newPage({ ...sizes.computer });
  await logIn(page);

  await answeredChat(page, "Add coffee, oats and lemons to my shopping list.", "Shopping list");
  await answeredChat(page, "Give me three ideas for the home page of example-app.", "Ideas for example-app");
  const weekChat = await answeredChat(page, "What do I have to do this week? Make a list.", "Plan for the week");

  await openAddress(page, "#/schedules", "Schedules");
  await addSchedule(page, { id: "daily-summary", name: "Daily summary", time: "08:00", days: [] });
  await addSchedule(page, { id: "water-plants", name: "Water the plants", time: "18:30", days: ["Fri"] });

  await openProjects(page);
  await page.getByRole("button", { name: /Example app/ }).click();
  await page.getByRole("heading", { level: 1, name: "Example app" }).waitFor();
  const created = page.waitForResponse(
    (response) => response.url().endsWith("/api/sessions") && response.request().method() === "POST",
  );
  await page.locator(".main-header > button").filter({ hasText: "New chat" }).click();
  const projectChat = ((await (await created).json()) as { id: string }).id;
  await send(page, "Run the tests and list what fails.");
  // Only the first chat in a clone asks to trust its repository.
  const answer = page.locator(".message.answer").filter({ hasText: "Done." });
  const trust = page.getByRole("region", { name: "Eva asks for permission" });
  await answer.or(trust).first().waitFor();
  if (await trust.isVisible()) await trust.getByRole("button", { name: "Deny" }).click();
  await answer.waitFor();
  await rename(page, "Fix the failing tests");

  await page.close();
  return { weekChat, projectChat };
}

/** Eva refuses to delete a chat while she still saves its turn, so the delete tries again for a while. */
async function deleteChat(page: Page, id: unknown): Promise<void> {
  if (typeof id !== "string") return;
  for (let tries = 0; ; tries += 1) {
    const response = await page.request.delete(`${demoUrl}api/sessions/${encodeURIComponent(id)}`);
    if (response.ok()) return;
    const failure = (await response.json()) as { code?: string; error?: string };
    if (failure.code !== "session_busy" || tries >= 60)
      throw new Error(`Eva did not delete the chat: ${failure.error}`);
    await page.waitForTimeout(500);
  }
}

const scenes: readonly Scene[] = [
  {
    name: "login",
    // The demo has no Tailscale, so the browser plays the server's side of the device login.
    show: async (page) => {
      await page.context().clearCookies();
      await page.route("**/api/login/device", (route) =>
        route.fulfill({
          status: 201,
          json: {
            id: "capture",
            code: "K7QX",
            account: "owner@example.com",
            expiresAt: "2099-01-01T00:00:00.000Z",
            approvers: ["Telegram", "terminal", "Eva page"],
          },
        }),
      );
      await page.route("**/api/login/device/capture", (route) => route.fulfill({ json: { state: "pending" } }));
      await page.goto(demoUrl);
      await page.getByRole("heading", { name: "Confirm this device" }).waitFor();
    },
    after: async (page) => {
      await page.unrouteAll({ behavior: "ignoreErrors" });
      await logIn(page);
    },
  },
  {
    name: "new",
    show: async (page) => {
      const id = await newChat(page);
      await page.locator(".greeting, .new-chat").first().waitFor();
      return id;
    },
    // The empty chat would stay in the list of every later capture.
    after: deleteChat,
  },
  { name: "chat", show: (page, _view, demo) => openChat(page, demo.weekChat) },
  {
    name: "approval",
    // Each view asks again and denies after its capture, so no other capture shows a waiting request.
    show: async (page) => {
      const id = await newChat(page);
      await send(page, "Open an issue for the login bug, and ask me to approve it.");
      await page.getByRole("region", { name: "Eva asks for permission" }).waitFor();
      await rename(page, "Report the login bug");
      return id;
    },
    after: async (page, id) => {
      await page.getByRole("region", { name: "Eva asks for permission" }).getByRole("button", { name: "Deny" }).click();
      await page.locator(".message.answer").filter({ hasText: "The person answered" }).waitFor();
      await deleteChat(page, id);
    },
  },
  {
    name: "projects",
    show: async (page) => {
      await openProjects(page);
      await page.getByRole("button", { name: /Example app/ }).click();
      await page.locator(".clone-card").first().waitFor();
    },
  },
  { name: "project-chat", show: (page, _view, demo) => openChat(page, demo.projectChat) },
  {
    name: "schedules",
    show: async (page) => {
      await openAddress(page, "#/schedules", "Schedules");
      await page.getByRole("listitem", { name: "Daily summary" }).waitFor();
    },
  },
  { name: "settings", show: (page) => openAddress(page, "#/settings", "Settings") },
  { name: "devices", show: (page) => openAddress(page, "#/settings/access", "Access") },
  {
    name: "problems",
    show: async (page, _view, demo) => {
      await openChat(page, demo.weekChat);
      await page.route("**/api/status", async (route) => {
        const response = await route.fetch();
        const status = (await response.json()) as Record<string, unknown> & { vaultSync: Record<string, unknown> };
        const problems = [
          { key: "vault_sync", level: "error", message: "Notes/plan.md has a conflict." },
          { key: "schedule:daily-summary", level: "warn", message: "The schedule Daily summary failed." },
        ];
        await route.fulfill({
          response,
          json: {
            ...status,
            vaultSync: { ...status.vaultSync, status: "conflict" },
            problems: problems.map((problem) => problem.message),
            problemDetails: problems,
          },
        });
      });
      await page.route("**/api/vault/conflicts", (route) =>
        route.fulfill({ json: { state: { status: "conflict" }, conflicts: [planConflict] } }),
      );
      await page.reload();
      const banner = page.getByRole("region", { name: "Problems" });
      await banner.getByRole("button", { name: "Pick a version" }).click();
      await page.getByRole("dialog", { name: "Note conflicts" }).waitFor();
    },
    after: async (page) => {
      await page.keyboard.press("Escape");
      await page.unrouteAll({ behavior: "ignoreErrors" });
      await page.reload();
    },
  },
  { name: "updates", show: (page) => openAddress(page, "#/settings/updates", "Updates") },
  {
    name: "chat-details",
    show: async (page, view, demo) => {
      await openChat(page, demo.weekChat);
      // A computer shows the details beside the chat. A phone opens them in a sheet from the title.
      if (view.device === "computer") {
        await page
          .getByRole("button", { name: /background task/ })
          .first()
          .click();
        await page.getByRole("dialog", { name: "Background tasks" }).waitFor();
      } else {
        await page.getByRole("heading", { level: 1 }).getByRole("button").click();
        await page.getByRole("dialog", { name: "This chat" }).waitFor();
      }
    },
    after: (page) => page.keyboard.press("Escape"),
  },
];

/**
 * The last click leaves a focus ring and a tooltip, which the person would not see at rest.
 * A dialog keeps its focus, so its close button does not get a ring either way.
 */
async function hideHints(page: Page): Promise<void> {
  // The top middle of the page is a title on every page, with no tooltip.
  await page.mouse.move((page.viewportSize()?.width ?? 0) / 2, 1);
  if ((await page.getByRole("dialog").count()) > 0) return;
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
}

/** The browser encodes the capture as WebP, so the script needs no image tool. */
async function writeWebp(converter: Page, png: Buffer, path: string): Promise<void> {
  const dataUrl = await converter.evaluate(
    async ({ source, quality }) => {
      const image = new Image();
      image.src = source;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      canvas.getContext("2d")?.drawImage(image, 0, 0);
      return canvas.toDataURL("image/webp", quality);
    },
    { source: `data:image/png;base64,${png.toString("base64")}`, quality: webpQuality },
  );
  if (!dataUrl.startsWith("data:image/webp")) throw new Error("This browser cannot encode WebP.");
  writeFileSync(path, Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64"));
  process.stdout.write(`${path}\n`);
}

/**
 * Freezes the clock of the page on a festive day: festive eyes are a surprise, so the guide never shows them.
 * The next ordinary day keeps the same time, so the chats keep their order.
 */
async function avoidFestiveDay(context: BrowserContext): Promise<void> {
  const day = new Date();
  if (specialDayOn(day) === null) return;
  while (specialDayOn(day) !== null) day.setDate(day.getDate() + 1);
  await context.clock.setFixedTime(day);
}

async function newContext(browser: Browser, view: View): Promise<BrowserContext> {
  // No motion, so each capture shows a face at rest and no shimmer.
  const context = await browser.newContext({ ...sizes[view.device], colorScheme: view.theme, reducedMotion: "reduce" });
  await avoidFestiveDay(context);
  return context;
}

/** Each face of EVE, from the test page of the faces, without the festive eyes. */
async function captureExpressions(browser: Browser, converter: Page): Promise<void> {
  for (const theme of ["light", "dark"] as const) {
    const context = await newContext(browser, { device: "computer", theme });
    const page = await context.newPage();
    await page.goto(galleryUrl);
    await page.locator("figure").first().waitFor();
    await page.addStyleTag({
      content: 'figure[aria-label="rotate"], figure[aria-label^="festive"] { display: none; }',
    });
    await page.waitForTimeout(500);
    const png = await page.locator("main").screenshot();
    await writeWebp(converter, png, join(outDir, `expressions-${theme}.webp`));
    await context.close();
  }
}

const chosen = wanted.length === 0 ? scenes : scenes.filter((scene) => wanted.includes(scene.name));
mkdirSync(outDir, { recursive: true });
const browser = await launchBrowser();
try {
  const converter = await browser.newPage();
  const demo = await setUp(browser);
  for (const view of views) {
    const context = await newContext(browser, view);
    const page = await context.newPage();
    await logIn(page);
    for (const scene of chosen) {
      const startedChat = await scene.show(page, view, demo);
      await hideHints(page);
      // The fonts, the images and the last layout settle before the capture.
      await page.waitForTimeout(800);
      await writeWebp(
        converter,
        await page.screenshot(),
        join(outDir, `${scene.name}-${view.device}-${view.theme}.webp`),
      );
      await scene.after?.(page, startedChat);
    }
    await context.close();
  }
  if (wanted.length === 0 || wanted.includes("expressions")) await captureExpressions(browser, converter);
} finally {
  await browser.close();
}
