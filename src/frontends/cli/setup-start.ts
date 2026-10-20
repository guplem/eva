/**
 * The short path of `eva setup`, after the engines, the port and the local token: Tailscale, then
 * Eva starts, then the first device gets in with the code that her page shows. From then on the
 * person picks where to finish the setup: here, or on the page.
 */

import { EvaError } from "../../shared/errors.ts";
import { doneLine, noteLine, stepLines } from "./setup-output.ts";

export interface StartOptions {
  readonly interactive: boolean;
  readonly ask: (key: "startService" | "deviceCode" | "finishOn", question: string) => Promise<string>;
  readonly write: (line: string) => void;
  /** The Tailscale steps. Returns the address that opens Eva on other devices, or null. */
  readonly network: () => Promise<string | null>;
  /** The page on this computer. */
  readonly localUrl: string;
  /** Installs and starts the service, as `eva service install` does. True when it worked. */
  readonly startService: () => Promise<boolean>;
  /** True when the Eva of this home runs and her page answers. */
  readonly isRunning: () => Promise<boolean>;
  /** Lets in the browser that waits with this code. Returns its label, or null. */
  readonly allow: (code: string) => Promise<string | null>;
  readonly sleep: (ms: number) => Promise<void>;
}

const startPollMs = 1_000;
/** A new Eva takes a few seconds to take her lock and open her page. */
const startWaitMs = 30_000;

/** Where the person answers the rest of the setup. */
export type FinishPlace = "terminal" | "page";

/** The Setup page of Settings, where each step that is left explains what to do. */
const setupPagePath = "/#/settings/setup";

/** Returns where the person finishes the setup. Without a running Eva, there is no page to open. */
export async function startAndLetIn(options: StartOptions): Promise<FinishPlace> {
  const address = (await options.network()) ?? options.localUrl;
  for (const line of stepLines("Start Eva")) options.write(line);
  if (await options.isRunning()) options.write(doneLine("Eva runs."));
  else {
    const answer = await options.ask("startService", "Start Eva now, and each time this computer starts? [Y/n]: ");
    if (!options.interactive && answer !== "" && !/^(y(es)?|no?)$/i.test(answer))
      throw new EvaError("config_invalid", "The answer to start Eva must be yes or no.");
    // A script starts nothing it did not ask for, such as in a test.
    const start = options.interactive ? !/^no?$/i.test(answer) : /^y(es)?$/i.test(answer);
    if (!start) {
      options.write(noteLine("Eva does not run yet. To start her, run `eva service install`, or `eva` in a terminal."));
      return "terminal";
    }
    if (!(await options.startService()) || !(await waitUntilRunning(options))) {
      options.write(noteLine("Eva did not start. Run `eva` to see why. Setup goes on here."));
      return "terminal";
    }
    options.write(doneLine("Eva runs, and starts again each time this computer starts."));
  }
  if (!options.interactive) return "terminal";
  for (const line of stepLines("Your devices")) options.write(line);
  options.write(noteLine(`Open ${address} on each device that should reach Eva, such as your phone and your laptop.`));
  options.write(noteLine("Each page shows a short code. Type it here to let that device in."));
  let allowed = 0;
  for (;;) {
    const code = await options.ask(
      "deviceCode",
      allowed === 0
        ? "Code from the page (or press Enter to skip this step): "
        : "Code of another device (or press Enter when every device is in): ",
    );
    if (code === "") break;
    const label = await options.allow(code);
    if (label === null) {
      options.write(noteLine("No device waits with this code. Check the code on the page, or reload the page there."));
      continue;
    }
    allowed += 1;
    options.write(doneLine(`Allowed ${label}. It can finish the setup on the page.`));
  }
  const place = await askFinishPlace(options);
  if (place === "page") {
    for (const line of pageSteps(address, options.localUrl)) options.write(line);
    return "page";
  }
  options.write("");
  options.write(noteLine("Setup goes on here. Each answer is saved at once, so Ctrl+C at any question loses nothing."));
  return "terminal";
}

async function askFinishPlace(options: StartOptions): Promise<FinishPlace> {
  options.write("");
  options.write(noteLine("The next steps are your notebook, GitHub, the AI login, Telegram and Google."));
  options.write(noteLine("You can answer them here, or on Eva's web page. The page explains each step."));
  options.write(noteLine("  1. Here, in this terminal."));
  options.write(noteLine("  2. On Eva's web page, in a browser."));
  for (;;) {
    const answer = (await options.ask("finishOn", "Where do you want to go on? Type 1 or 2 [1]: "))
      .trim()
      .toLowerCase();
    if (answer === "" || answer === "1" || answer === "here" || answer === "terminal") return "terminal";
    if (answer === "2" || answer === "page" || answer === "web") return "page";
    options.write(noteLine("Type 1 to go on here, or 2 to go on in the web page."));
  }
}

/** The steps to finish on the page: its link on this computer, and on the other devices. */
function pageSteps(address: string, localUrl: string): string[] {
  const local = `${localUrl}${setupPagePath}`;
  const remote = `${address}${setupPagePath}`;
  return [
    "",
    "  >> Your turn: finish the setup on Eva's web page.",
    noteLine(`  1. Open ${local} in a browser on this computer.`),
    ...(remote === local ? [] : [noteLine(`     Or open ${remote} on a device that you let in, such as your phone.`)]),
    noteLine(
      '  2. The page lists each step. A step marked "Needs you" is left to do. Open it, and follow its instructions.',
    ),
    noteLine("  3. Do the steps in their order. Eva needs at least the AI engine and the vault to answer."),
    noteLine("  4. Each answer is saved at once. When the page asks for a restart, press Restart Eva."),
    "",
    noteLine("You can close this terminal now. Eva keeps running."),
    noteLine(
      "To answer the questions here instead, run `eva setup` again: it asks only for the steps that are not done.",
    ),
  ];
}

async function waitUntilRunning(options: StartOptions): Promise<boolean> {
  for (let waited = 0; waited < startWaitMs; waited += startPollMs) {
    if (await options.isRunning()) return true;
    await options.sleep(startPollMs);
  }
  return options.isRunning();
}
