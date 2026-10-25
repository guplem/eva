/**
 * The parts that the capture scripts share: the address of the demo server, its login and the browser.
 * Start the demo first, in the checkout to capture: `bun run test/e2e/serve-demo.ts`.
 */
import { chromium, type Browser, type Page } from "@playwright/test";
import { e2ePorts } from "../test/e2e/e2e-ports.ts";

// test/e2e/serve-demo.ts serves the demo vault on this port, with this token.
export const demoUrl = `http://127.0.0.1:${String(e2ePorts().demo)}/`;
const demoToken = "e2e-demo-token";

/** Set EVA_CAPTURE_CHROMIUM to a Chromium program when Playwright has no browser of its own version. */
export function launchBrowser(): Promise<Browser> {
  const executablePath = process.env["EVA_CAPTURE_CHROMIUM"];
  return chromium.launch(executablePath === undefined ? {} : { executablePath });
}

/** Logs in with the demo token, and waits until the login page goes away. */
export async function logIn(page: Page): Promise<void> {
  await page.goto(demoUrl);
  await page.getByLabel(/Token/).fill(demoToken);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.getByLabel(/Token/).waitFor({ state: "detached" });
}
