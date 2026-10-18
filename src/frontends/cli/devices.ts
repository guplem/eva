/**
 * The terminal as a device-login approver. A browser shows a short code, and a person at Eva's
 * terminal types it in `eva devices allow <code>` or in `eva setup`. Only a person with a shell as
 * Eva's user can read `localApiToken`, so only that person can allow a device.
 */
import type { DeviceLoginApprover } from "../../core/remote-access/device-logins.ts";
import type { HomePaths } from "../../core/settings/home.ts";
import { exitCodes } from "../../shared/exit-codes.ts";
import { requestDeviceAllow } from "./client.ts";
import { writeLine, type CliHost } from "./host.ts";
import { runningClient } from "./local-commands.ts";

/** The terminal can always answer: the person types the code there, so it sends no message. */
export const terminalDeviceApprover: DeviceLoginApprover = {
  name: "terminal",
  canApprove: () => true,
  ask: () => undefined,
};

/** `eva devices allow <code>`: lets in the browser that waits with this code. */
export async function allowDevice(host: CliHost, paths: HomePaths, code: string): Promise<number> {
  const client = runningClient(host, paths);
  if (client === null) {
    host.writeError("Eva does not run, so no device waits. Start Eva, open her page, and try again.\n");
    return exitCodes.badConfig;
  }
  const label = await requestDeviceAllow(client, code);
  if (label === null) {
    host.writeError("No device waits with this code. Check the code on the page, or ask again there.\n");
    return exitCodes.badConfig;
  }
  writeLine(host, `Allowed ${label}.`);
  return exitCodes.clean;
}
