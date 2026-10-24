/**
 * Takes captures of the web page from the demo server.
 * Start the demo first, in the checkout to capture: `bun run test/e2e/serve-demo.ts`.
 *
 * Usage: bun run scripts/capture-ui.ts <out-dir> <prefix> [address ...]
 *   An address is a hash, such as `#/settings` or `#/settings/setup/engine`. The default is `#/chats`.
 *   Each address gives three files: <prefix>-<name>-computer-light.png, -computer-dark and -phone-light.
 *   Set EVA_CAPTURE_CHROMIUM to a Chromium program when Playwright has no browser of its own version.
 *   Set EVA_E2E_PORT to the port of the demo when it does not use the default.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "@playwright/test";
import { e2ePorts } from "../test/e2e/e2e-ports.ts";

// test/e2e/serve-demo.ts serves the demo vault on this port, with this token.
const demoUrl = `http://127.0.0.1:${String(e2ePorts().demo)}/`;
const demoToken = "e2e-demo-token";

// A tall window shows a whole page: each page scrolls inside its own panel, so a full-page shot would cut it.
const views = [
  { name: "computer-light", viewport: { width: 1280, height: 1500 }, colorScheme: "light" },
  { name: "computer-dark", viewport: { width: 1280, height: 1500 }, colorScheme: "dark" },
  { name: "phone-light", viewport: { width: 390, height: 1700 }, colorScheme: "light" },
] as const;

const [outDir, prefix, ...given] = process.argv.slice(2);
if (outDir === undefined || prefix === undefined) {
  process.stderr.write("Use: bun run scripts/capture-ui.ts <out-dir> <prefix> [address ...]\n");
  process.exit(1);
}
const addresses = given.length > 0 ? given : ["#/chats"];
mkdirSync(outDir, { recursive: true });

/** `#/settings/setup/engine` becomes `settings-setup-engine`. */
function fileName(address: string): string {
  return address.replace(/^#\/?/, "").replace(/[^a-z0-9]+/gi, "-") || "home";
}

const executablePath = process.env["EVA_CAPTURE_CHROMIUM"];
const browser = await chromium.launch(executablePath === undefined ? {} : { executablePath });
try {
  for (const view of views) {
    const page = await browser.newPage({ viewport: view.viewport, colorScheme: view.colorScheme });
    await page.goto(demoUrl);
    await page.getByLabel(/Token/).fill(demoToken);
    await page.getByRole("button", { name: "Log in" }).click();
    // The login page goes away when the login works.
    await page.getByLabel(/Token/).waitFor({ state: "detached" });
    for (const address of addresses) {
      await page.evaluate((hash) => {
        window.location.hash = hash;
      }, address);
      // The page reads its data after the address changes; this wait lets it draw.
      await page.waitForTimeout(1500);
      const path = join(outDir, `${prefix}-${fileName(address)}-${view.name}.png`);
      await page.screenshot({ path });
      process.stdout.write(`${path}\n`);
    }
    await page.close();
  }
} finally {
  await browser.close();
}
