/**
 * The short path of `eva setup`, after the engines, the port and the local token: Tailscale, then
 * Eva starts, then the first device gets in with the code that her page shows. From then on the
 * person can finish the setup on the page, in the terminal, or in both at once.
 */

import { EvaError } from "../../shared/errors.ts";

export interface StartOptions {
  readonly interactive: boolean;
  readonly ask: (key: "startService" | "deviceCode", question: string) => Promise<string>;
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

export async function startAndLetIn(options: StartOptions): Promise<void> {
  const address = (await options.network()) ?? options.localUrl;
  if (!(await options.isRunning())) {
    const answer = await options.ask("startService", "Start Eva now, and each time this computer starts? [Y/n]: ");
    if (!options.interactive && answer !== "" && !/^(y(es)?|no?)$/i.test(answer))
      throw new EvaError("config_invalid", "The answer to start Eva must be yes or no.");
    // A script starts nothing it did not ask for, such as in a test.
    const start = options.interactive ? !/^no?$/i.test(answer) : /^y(es)?$/i.test(answer);
    if (!start) {
      options.write("Eva does not run yet. To start her, run `eva service install`, or `eva` in a terminal.");
      return;
    }
    if (!(await options.startService()) || !(await waitUntilRunning(options))) {
      options.write("Eva did not start. Run `eva` to see why. Setup goes on here.");
      return;
    }
  }
  if (!options.interactive) return;
  options.write(`Open ${address} on any device. The page shows a short code.`);
  for (;;) {
    const code = await options.ask(
      "deviceCode",
      "Type the code that the page shows, to let that device in (Enter to go on here): ",
    );
    if (code === "") break;
    const label = await options.allow(code);
    if (label === null) {
      options.write("No device waits with this code. Check the code on the page, or ask again there.");
      continue;
    }
    options.write(`Allowed ${label}. That device can finish the setup on the page.`);
  }
  options.write(
    "Answer the next questions here, or press Ctrl+C and finish on the page. Each answer is saved at once, in both places.",
  );
}

async function waitUntilRunning(options: StartOptions): Promise<boolean> {
  for (let waited = 0; waited < startWaitMs; waited += startPollMs) {
    if (await options.isRunning()) return true;
    await options.sleep(startPollMs);
  }
  return options.isRunning();
}
