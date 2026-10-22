/**
 * The terminal as a device-login approver. A browser shows a short code, and a person at Eva's
 * terminal types it in `eva devices allow <code>` or in `eva setup`. Only a person with a shell as
 * Eva's user can read `localApiToken`, so only that person can allow a device.
 * For the same reason, the terminal can open this computer's browser already logged in (`eva open`).
 */
import type { DeviceLoginApprover } from "../../core/remote-access/device-logins.ts";
import type { HomePaths } from "../../core/settings/home.ts";
import {
  baseEnvironmentAllowlist,
  buildChildEnvironment,
  desktopEnvironmentAllowlist,
  type EnvironmentMap,
} from "../../shared/environment.ts";
import { exitCodes } from "../../shared/exit-codes.ts";
import { requestDeviceAllow, requestLoginLink, type ClientOptions } from "./client.ts";
import { writeLine, type CliHost } from "./host.ts";
import { runningClient } from "./local-commands.ts";

/** A browser opener returns at once; a stuck one must not hold the terminal. */
const browserTimeoutMs = 30_000;

/** The terminal can always answer: the person types the code there, so it sends no message. */
export const terminalDeviceApprover: DeviceLoginApprover = {
  name: "terminal",
  servesThisComputer: true,
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

/**
 * The address of a login link. The secret goes in the fragment, which the browser never sends, so
 * no log keeps it. `page` is a path of the page, such as `/settings/setup`, or null for the start.
 */
export function loginLinkAddress(baseUrl: string, secret: string, page: string | null): string {
  return `${baseUrl}/#login=${secret}${page ?? ""}`;
}

/** The command that opens a link in this computer's default browser, or null on a computer with no desktop. */
export function browserCommand(platform: NodeJS.Platform, environment: EnvironmentMap, url: string): string[] | null {
  // Not `cmd /c start`: cmd reads characters such as & in the link as its own syntax.
  if (platform === "win32") return ["rundll32.exe", "url.dll,FileProtocolHandler", url];
  if (platform === "darwin") return ["open", url];
  if (environment["DISPLAY"] === undefined && environment["WAYLAND_DISPLAY"] === undefined) return null;
  // xdg-open can run the browser itself. In the background, with no pipe to Eva, it never holds the runner.
  return [
    "sh",
    "-c",
    'command -v xdg-open >/dev/null || exit 127; xdg-open "$1" </dev/null >/dev/null 2>&1 &',
    "sh",
    url,
  ];
}

/** True when this computer has a desktop with a browser to open. */
export function canOpenBrowser(host: CliHost): boolean {
  return browserCommand(host.platform, host.environment, "") !== null;
}

/**
 * Opens this computer's browser at Eva's page, logged in, with a new login link. When no browser
 * opens, prints the link to open by hand. Returns true when a browser opened.
 */
export async function openLoggedIn(host: CliHost, client: ClientOptions, page: string | null): Promise<boolean> {
  const link = await requestLoginLink(client);
  const address = loginLinkAddress(client.baseUrl, link.secret, page);
  const command = browserCommand(host.platform, host.environment, address);
  if (command !== null) {
    const opened = await host.runner
      .run(command, {
        cwd: host.userHome,
        environment: buildChildEnvironment(host.environment, [
          ...baseEnvironmentAllowlist,
          ...desktopEnvironmentAllowlist,
        ]),
        timeoutMs: browserTimeoutMs,
      })
      .then(
        (result) => result.exitCode === 0,
        () => false,
      );
    if (opened) return true;
  }
  writeLine(host, "No browser opened here. Open this link in a browser on this computer.");
  writeLine(host, `It works once, for 2 minutes: ${address}`);
  return false;
}

/** `eva open`: opens Eva in this computer's browser, logged in, with no token or code (#407). */
export async function openEva(host: CliHost, paths: HomePaths): Promise<number> {
  const client = runningClient(host, paths);
  if (client === null) {
    host.writeError("Eva does not run. Start her with `eva service install`, or run `eva` in another terminal.\n");
    return exitCodes.badConfig;
  }
  if (await openLoggedIn(host, client, null)) writeLine(host, "Opened Eva in this computer's browser.");
  return exitCodes.clean;
}
