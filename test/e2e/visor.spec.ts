import { expect, test, type Locator, type Page, type WebSocketRoute } from "@playwright/test";
import { e2ePorts } from "./e2e-ports.ts";

/** The test page of `visor-gallery.html`, served by `serve-demo.ts`. */
const galleryUrl = `http://127.0.0.1:${String(e2ePorts().gallery)}/`;

const faces = [
  "neutral",
  "happy",
  "wink",
  "delighted",
  "surprised",
  "thinking",
  "searching",
  "listening",
  "focused",
  "firm",
  "skeptical",
  "worried",
  "sad",
  "error",
  "asleep",
];

/** The faces that move by themselves, with the animation of the eyes or of their wrapper. */
const ownMotion: Record<string, { part: "i" | ".eyes" | "::after"; animation: string }> = {
  happy: { part: ".eyes", animation: "bounce" },
  wink: { part: "i", animation: "wsquint" },
  delighted: { part: "i", animation: "beat" },
  surprised: { part: "i", animation: "blink, pop" },
  thinking: { part: "i", animation: "blink, think" },
  searching: { part: ".eyes", animation: "look" },
  listening: { part: "i", animation: "blink, listen" },
  worried: { part: ".eyes", animation: "tremble" },
  asleep: { part: "::after", animation: "zz" },
};

function visorsOf(page: Page, face: string): Locator {
  return page.getByRole("figure", { name: face, exact: true }).locator(".mk");
}

async function animationOf(visor: Locator, part: "i" | ".eyes" | "::after"): Promise<string> {
  return visor.evaluate((element, which) => {
    if (which === "::after") return getComputedStyle(element, "::after").animationName;
    const target = element.querySelector(which);
    return target === null ? "" : getComputedStyle(target).animationName;
  }, part);
}

test("each face shows at each size", async ({ page }) => {
  await page.goto(galleryUrl);
  for (const face of faces) {
    const visors = visorsOf(page, face);
    await expect(visors).toHaveCount(4);
    const widths = await visors.evaluateAll((elements) => elements.map((element) => element.clientWidth));
    expect(widths).toEqual([28, 36, 76, 128]);
  }
});

test("all faces blink, and nine faces also move by themselves", async ({ page }) => {
  await page.goto(galleryUrl);
  expect(await animationOf(visorsOf(page, "neutral").first(), "i")).toBe("blink");
  for (const [face, motion] of Object.entries(ownMotion)) {
    expect(await animationOf(visorsOf(page, face).first(), motion.part), face).toBe(motion.animation);
  }
  // The eyes glow through a filter on their wrapper, so the masked crescents glow too.
  const filter = await visorsOf(page, "happy")
    .first()
    .locator(".eyes")
    .evaluate((element) => getComputedStyle(element).filter);
  expect(filter).toContain("drop-shadow");
});

test("a new face morphs from the last one in 0.35 s", async ({ page }) => {
  await page.goto(galleryUrl);
  const row = page.getByRole("figure", { name: "neutral", exact: true });
  const eye = row.locator(".mk i").first();
  expect(await eye.evaluate((element) => getComputedStyle(element).transitionDuration)).toContain("0.35s");
  await row.click();
  await expect(row.locator(".mk").first()).toHaveClass(/e-joy/);
});

test("with reduced motion, nothing moves and nothing blinks", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(galleryUrl);
  const names = await page
    .locator(".mk")
    .evaluateAll((elements) =>
      elements.flatMap((element) => [
        getComputedStyle(element, "::after").animationName,
        ...[...element.querySelectorAll(".eyes, i")].map((part) => getComputedStyle(part).animationName),
      ]),
    );
  expect(names.length).toBeGreaterThan(0);
  expect(names.every((name) => name === "none")).toBe(true);
});

test("the rotate mode cycles the login faces with their own durations", async ({ page }) => {
  await page.clock.install();
  await page.goto(galleryUrl);
  const visor = page.getByRole("figure", { name: "rotate" }).locator(".mk");
  await expect(visor).toHaveClass(/e-scan/);
  await page.clock.runFor(5_000);
  await expect(visor).toHaveClass(/e-think/);
  await page.clock.runFor(3_000);
  await expect(visor).toHaveClass(/e-joy/);
});

test("with reduced motion, the rotate mode stays on one face", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.clock.install();
  await page.goto(galleryUrl);
  await page.clock.runFor(20_000);
  await expect(page.getByRole("figure", { name: "rotate" }).locator(".mk")).toHaveClass(/e-scan/);
});

test("the nav visor shows EVE, worried while the page reconnects", async ({ page }) => {
  const sockets: WebSocketRoute[] = [];
  await page.routeWebSocket(/\/api\/events(\?devices)?$/, (socket) => {
    socket.connectToServer();
    sockets.push(socket);
  });
  // An ordinary day: on a special day the visor at rest wears that day's eyes.
  await page.clock.setFixedTime(new Date("2026-07-15T12:00:00"));
  await page.goto("/");
  await page.getByLabel(/Token/).fill("e2e-demo-token");
  await page.getByRole("button", { name: "Log in" }).click();
  const visor = page.getByRole("navigation", { name: "Main" }).locator(".mk");
  await expect(visor).toHaveClass("mk");

  await sockets.at(-1)?.close();
  await expect(visor).toHaveClass("mk e-worry");
  await expect(visor).toHaveClass("mk");
});

test("on a special day, the nav visor at rest wears that day's eyes", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-10-31T12:00:00"));
  await page.goto("/");
  await page.getByLabel(/Token/).fill("e2e-demo-token");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("navigation", { name: "Main" }).locator(".mk")).toHaveClass("mk festive f-candle");
});
