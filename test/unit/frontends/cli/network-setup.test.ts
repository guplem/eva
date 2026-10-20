import { describe, expect, test } from "bun:test";
import { RemoteAccessWatcher } from "../../../../src/core/remote-access/remote-access.ts";
import { accessLines, runNetworkSetup } from "../../../../src/frontends/cli/network-setup.ts";
import { EvaError } from "../../../../src/shared/errors.ts";
import type { ProcessResult, ProcessRunner } from "../../../../src/shared/process-runner.ts";

const loggedIn = (https: boolean): string =>
  JSON.stringify({
    BackendState: "Running",
    Self: { DNSName: "server.example-tailnet.ts.net.", UserID: 7 },
    User: { "7": { LoginName: "owner@example.com" } },
    CertDomains: https ? ["server.example-tailnet.ts.net"] : null,
  });
const needsLogin = JSON.stringify({ BackendState: "NeedsLogin" });
const missing = "missing";

interface Script {
  /** The answers of `tailscale status --json`, one per call; the last one repeats. */
  readonly statuses: readonly string[];
  readonly upOutput?: string;
  /** Null: Eva cannot install here. */
  readonly install?: (() => Promise<void>) | null;
}

function harness(
  script: Script,
  interactive = true,
  answer = "",
): {
  readonly lines: string[];
  readonly commands: string[];
  readonly questions: string[];
  readonly run: () => Promise<string | null>;
} {
  const lines: string[] = [];
  const commands: string[] = [];
  const questions: string[] = [];
  let statusCalls = 0;
  const runner: ProcessRunner = {
    run: (command): Promise<ProcessResult> => {
      commands.push(command.slice(1).join(" "));
      if (command[1] === "up") return Promise.resolve({ exitCode: 1, stdout: "", stderr: script.upOutput ?? "" });
      const stdout = script.statuses[Math.min(statusCalls, script.statuses.length - 1)] ?? "";
      statusCalls += 1;
      if (stdout === missing) return Promise.reject(new EvaError("process_failed", "Could not start tailscale."));
      return Promise.resolve({ exitCode: 0, stdout, stderr: "" });
    },
  };
  const access = new RemoteAccessWatcher({
    runner,
    environment: {},
    port: 7420,
    program: () => ["tailscale"],
    install: script.install ?? null,
  });
  return {
    lines,
    commands,
    questions,
    run: () =>
      runNetworkSetup({
        access,
        localUrl: "http://127.0.0.1:7420",
        write: (line) => lines.push(line),
        ask: (question) => {
          questions.push(question);
          return Promise.resolve(answer);
        },
        interactive,
        sleep: () => Promise.resolve(),
        waitLimitMs: 20_000,
      }),
  };
}

describe("the network step of eva setup", () => {
  test("a ready tailnet ends with the address, a QR code, the device steps and the local address", async () => {
    const run = harness({ statuses: [loggedIn(true)] });
    expect(await run.run()).toBe("https://server.example-tailnet.ts.net");
    const text = run.lines.join("\n");
    expect(text).toContain("Open Eva: https://server.example-tailnet.ts.net");
    expect(text).toContain("owner@example.com");
    expect(text).toContain("▀");
    expect(text).toContain("On this machine only (advanced): http://127.0.0.1:7420");
    // Setup publishes too, so the printed address works as soon as Eva runs.
    expect(run.commands).toContain("serve --bg --https=443 http://127.0.0.1:7420");
  });

  test("no Tailscale where Eva can install it: she asks, installs, then signs the machine in", async () => {
    let installs = 0;
    const run = harness({
      // The install reads once more first: Eva installs only where no Tailscale exists.
      statuses: [missing, missing, needsLogin, needsLogin, loggedIn(true)],
      upOutput: "To authenticate, visit:\n\n\thttps://login.tailscale.com/a/abc123\n",
      install: () => {
        installs += 1;
        return Promise.resolve();
      },
    });
    expect(await run.run()).toBe("https://server.example-tailnet.ts.net");
    expect(installs).toBe(1);
    expect(run.questions[0]).toContain("Install Tailscale");
    expect(run.questions[1]).toContain("Sign this machine in");
    expect(run.lines.join("\n")).toContain("https://login.tailscale.com/a/abc123");
    expect(run.commands.some((command) => command.startsWith("up --timeout="))).toBe(true);
  });

  test("a failed install names the problem and the page to install by hand", async () => {
    const run = harness({
      statuses: [missing],
      install: () => Promise.reject(new EvaError("tailscale_install_failed", "The download failed.")),
    });
    expect(await run.run()).toBeNull();
    const text = run.lines.join("\n");
    expect(text).toContain("The download failed.");
  });

  test("no Tailscale where Eva cannot install it: the link, then a wait for the person", async () => {
    const run = harness({ statuses: [missing, missing, loggedIn(true)] });
    expect(await run.run()).toBe("https://server.example-tailnet.ts.net");
    expect(run.lines.join("\n")).toContain("https://tailscale.com/download");
    expect(run.questions).toEqual([]);
  });

  test("HTTPS off: it names the page, waits, and gives up after the limit, with no restart needed", async () => {
    const run = harness({ statuses: [loggedIn(false)] });
    expect(await run.run()).toBeNull();
    const text = run.lines.join("\n");
    expect(text).toContain("https://login.tailscale.com/admin/dns");
    expect(text).toContain("Stopped waiting");
    expect(text).toContain("within a minute");
    expect(text).not.toContain("restart");
  });

  test("without a person, it only says what to do, and asks nothing", async () => {
    const notLoggedIn = harness({ statuses: [needsLogin] }, false);
    expect(await notLoggedIn.run()).toBeNull();
    expect(notLoggedIn.lines.join("\n")).toContain("Sign in to Tailscale");
    expect(notLoggedIn.questions).toEqual([]);
    expect(notLoggedIn.commands.some((command) => command.startsWith("up"))).toBe(false);
    const httpsOff = harness({ statuses: [loggedIn(false)] }, false);
    expect(await httpsOff.run()).toBeNull();
    expect(httpsOff.lines.join("\n")).not.toContain("Waiting");
  });

  test("a skipped sign-in, or tailscale up with no link, ends with no address", async () => {
    const skipped = harness({ statuses: [needsLogin] }, true, "n");
    expect(await skipped.run()).toBeNull();
    expect(skipped.commands.some((command) => command.startsWith("up"))).toBe(false);
    const noLink = harness({ statuses: [needsLogin], upOutput: "failed to connect to local tailscaled" });
    expect(await noLink.run()).toBeNull();
    expect(noLink.lines.join("\n")).toContain("gave no sign-in link: failed to connect to local tailscaled");
  });
});

describe("accessLines", () => {
  test("a ready address gets a QR code and the plain address, which works where the code does not show", () => {
    const lines = accessLines({
      remoteAccess: { url: "https://server.example-tailnet.ts.net:7421", problem: null, step: "ready" },
      localUrl: "http://127.0.0.1:7421",
    });
    expect(lines[0]).toBe("Open Eva: https://server.example-tailnet.ts.net:7421");
    expect(lines.join("\n")).toContain("▀");
    const notReady = accessLines({ remoteAccess: { url: null, problem: "x" }, localUrl: "x" });
    expect(notReady.join("\n")).not.toContain("▀");
  });
});
