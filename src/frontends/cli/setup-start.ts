/**
 * The short path of `eva setup`, after the engines, the port and the local token: Tailscale, then
 * Eva starts, then the first device gets in with the code that her page shows. From then on the
 * person picks where to finish the setup: here, or on the page.
 */

import { EvaError } from "../../shared/errors.ts";
import { doneLine, noteLine, stepLines } from "./setup-output.ts";

export interface StartOptions {
  readonly interactive: boolean;
  readonly ask: (
    key: "startService" | "openHere" | "deviceCode" | "finishOn" | "tailscaleAccount",
    question: string,
  ) => Promise<string>;
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
  /**
   * Opens this computer's browser at Eva's page, logged in, as `eva open` does. `page` is a path of
   * the page, such as `/settings/setup`, or null for the start. True when a browser opened.
   * Null on a computer with no desktop, such as a server over SSH.
   */
  readonly openHere: ((page: string | null) => Promise<boolean>) | null;
  /**
   * Who may log in to an Eva that is not the first one on this computer, or null for the first
   * one, whose page lets in the computer's own Tailscale account (#322).
   */
  readonly account: AccountChoice | null;
}

/** The Tailscale account that uses a second Eva. */
export interface AccountChoice {
  /** The people's accounts on the tailnet, the computer's owner first. */
  readonly accounts: () => Promise<readonly string[]>;
  /** The accounts that this Eva lets in now; empty means the computer's owner. */
  readonly allowed: () => readonly string[];
  /** Saves the one account that this Eva lets in. */
  readonly allow: (account: string) => void;
  /** Restarts this Eva, so a new account applies at once. True when she runs again. */
  readonly restart: () => Promise<boolean>;
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
  // Before the start, so a new Eva starts with the account; a running one restarts below.
  if (options.account === null)
    await refuseScriptedAccount(
      options,
      "the account question is only for a new Eva beside another one, or for an Eva that lets in a chosen account.",
    );
  const accountChanged = options.account === null ? false : await chooseAccount(options, options.account);
  for (const line of stepLines("Start Eva")) options.write(line);
  if (await options.isRunning()) {
    if (accountChanged && options.account !== null && !(await options.account.restart()))
      options.write(noteLine("Eva did not restart. Restart her from Settings, so the account can log in."));
    options.write(doneLine("Eva runs."));
  } else {
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
      options.write(noteLine("Eva did not start. Setup goes on here."));
      options.write(noteLine("Later, run `eva service install` to start her, or `eva` to see why she stops."));
      return "terminal";
    }
    options.write(doneLine("Eva runs, and starts again each time this computer starts."));
  }
  if (!options.interactive) return "terminal";
  for (const line of stepLines("Your devices")) options.write(line);
  await openOnThisComputer(options);
  options.write(
    noteLine(
      address === options.localUrl
        ? `To let in a browser by hand, open ${address} in it.`
        : `To let in another device, such as your phone, open ${address} there.`,
    ),
  );
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
    const opened = options.openHere !== null && (await options.openHere("/settings/setup"));
    for (const line of pageSteps(address, options.localUrl, opened)) options.write(line);
    return "page";
  }
  options.write("");
  options.write(noteLine("Setup goes on here. Each answer is saved at once, so Ctrl+C at any question loses nothing."));
  return "terminal";
}

/** Offers to open Eva in this computer's browser, logged in, so the person needs no code here (#407). */
async function openOnThisComputer(options: StartOptions): Promise<void> {
  if (options.openHere === null) return;
  const answer = await options.ask("openHere", "Open Eva in this computer's browser now? [Y/n]: ");
  if (/^no?$/i.test(answer.trim())) {
    options.write(noteLine("To open Eva in this computer's browser later, run `eva open`."));
    return;
  }
  options.write(
    (await options.openHere(null))
      ? doneLine("Eva is open in this computer's browser. To open her again later, run `eva open`.")
      : noteLine("No browser opened. Run `eva open` to try again."),
  );
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

/**
 * The steps to finish on the page: its link on this computer, and on the other devices.
 * `opened`: the page is open in this computer's browser already.
 */
function pageSteps(address: string, localUrl: string, opened: boolean): string[] {
  const local = `${localUrl}${setupPagePath}`;
  const remote = `${address}${setupPagePath}`;
  return [
    "",
    "  >> Your turn: finish the setup on Eva's web page.",
    noteLine(
      opened
        ? "  1. The Setup page is open in this computer's browser."
        : `  1. Open ${local} in a browser on this computer.`,
    ),
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

/**
 * Asks which Tailscale account uses this Eva, when the tailnet has more than one. Returns true
 * when the choice changed who may log in. Enter keeps the computer's owner, as for the first Eva.
 */
async function chooseAccount(options: StartOptions, choice: AccountChoice): Promise<boolean> {
  const current = choice.allowed();
  const accounts = await choice.accounts();
  const [owner] = accounts;
  // With no account to choose from, a script's answer must not pass in silence.
  if (owner === undefined || (accounts.length < 2 && current.length === 0)) {
    await refuseScriptedAccount(options, "Tailscale lists no other account on this network.");
    return false;
  }
  // Enter keeps the account that this Eva lets in now: a chosen one, or else the owner.
  const kept = current[0] ?? owner;
  const keptNumber = Math.max(accounts.indexOf(kept), 0) + 1;
  options.write("");
  options.write(
    noteLine(
      current.length > 0
        ? `This Eva lets in the devices of ${current.join(", ")}. To change it, pick another account.`
        : "This is not the first Eva here. Her page lets in the devices of one Tailscale account.",
    ),
  );
  options.write(noteLine("Which account uses this Eva?"));
  accounts.forEach((account, index) => {
    options.write(noteLine(`  ${String(index + 1)}. ${account}${index === 0 ? " (this computer's owner)" : ""}`));
  });
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const answer = (
      await options.ask("tailscaleAccount", `Type a number or an account [${String(keptNumber)}]: `)
    ).trim();
    if (answer === "") return false;
    const chosen = /^\d+$/.test(answer) ? accounts[Number(answer) - 1] : accounts.find((account) => account === answer);
    if (chosen === undefined) {
      const problem = `${answer} is not in the list. Type a number from 1 to ${String(accounts.length)}.`;
      if (!options.interactive) throw new EvaError("config_invalid", problem);
      options.write(noteLine(problem));
      continue;
    }
    const unchanged = current.length === 0 ? chosen === owner : current.length === 1 && current[0] === chosen;
    if (unchanged) return false;
    choice.allow(chosen);
    options.write(doneLine(`This Eva lets in the devices of ${chosen}.`));
    return true;
  }
  return false;
}

/** A script that names an account where setup asks for none learns why, instead of nothing happening. */
async function refuseScriptedAccount(options: StartOptions, reason: string): Promise<void> {
  if (options.interactive) return;
  const scripted = (await options.ask("tailscaleAccount", "")).trim();
  if (scripted !== "")
    throw new EvaError("config_invalid", `EVA_TAILSCALE_ACCOUNT is ${scripted}, but setup did not use it: ${reason}`);
}

async function waitUntilRunning(options: StartOptions): Promise<boolean> {
  for (let waited = 0; waited < startWaitMs; waited += startPollMs) {
    if (await options.isRunning()) return true;
    await options.sleep(startPollMs);
  }
  return options.isRunning();
}
