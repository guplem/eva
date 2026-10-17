import { describe, expect, test } from "bun:test";
import { describeAccess, runNetworkSetup } from "../../../../src/frontends/cli/network-setup.ts";
import type { ProcessResult, ProcessRunner } from "../../../../src/shared/process-runner.ts";

const loggedIn = (https: boolean): string =>
  JSON.stringify({
    BackendState: "Running",
    Self: { DNSName: "server.example-tailnet.ts.net.", UserID: 7 },
    User: { "7": { LoginName: "owner@example.com" } },
    CertDomains: https ? ["server.example-tailnet.ts.net"] : null,
  });
const needsLogin = JSON.stringify({ BackendState: "NeedsLogin" });

interface Script {
  /** The answers of `tailscale status --json`, one per call; the last one repeats. */
  readonly statuses: readonly string[];
  readonly installed?: boolean;
  readonly upOutput?: string;
}

function harness(
  script: Script,
  interactive = true,
  answer = "",
): {
  readonly lines: string[];
  readonly commands: string[];
  readonly run: () => Promise<string | null>;
} {
  const lines: string[] = [];
  const commands: string[] = [];
  let statusCalls = 0;
  const runner: ProcessRunner = {
    run: (command): Promise<ProcessResult> => {
      commands.push(command.slice(1).join(" "));
      if (command[1] === "version")
        return script.installed === false
          ? Promise.reject(new Error("not found"))
          : Promise.resolve({ exitCode: 0, stdout: "1.104.1", stderr: "" });
      if (command[1] === "up") return Promise.resolve({ exitCode: 1, stdout: "", stderr: script.upOutput ?? "" });
      const stdout = script.statuses[Math.min(statusCalls, script.statuses.length - 1)] ?? "";
      statusCalls += 1;
      return Promise.resolve({ exitCode: 0, stdout, stderr: "" });
    },
  };
  return {
    lines,
    commands,
    run: () =>
      runNetworkSetup({
        runner,
        environment: {},
        write: (line) => lines.push(line),
        ask: () => Promise.resolve(answer),
        interactive,
        port: 7420,
        sleep: () => Promise.resolve(),
        waitLimitMs: 20_000,
      }),
  };
}

describe("the network step of eva setup (plan §11)", () => {
  test("a ready tailnet ends with the address, how other devices use it, and the advanced local address", async () => {
    const run = harness({ statuses: [loggedIn(true)] });
    expect(await run.run()).toBe("https://server.example-tailnet.ts.net");
    const text = run.lines.join("\n");
    expect(text).toContain("Open Eva: https://server.example-tailnet.ts.net");
    expect(text).toContain("signed in to Tailscale with your account");
    expect(text).toContain("On this machine only (advanced): http://127.0.0.1:7420");
  });

  test("no Tailscale: it says where to install it, and asks nothing", async () => {
    const run = harness({ statuses: ["not json"], installed: false });
    expect(await run.run()).toBeNull();
    expect(run.lines.join("\n")).toContain("https://tailscale.com/download");
    expect(run.lines.join("\n")).toContain("Phone and other computers: not set up");
  });

  test("a machine that is not logged in gets the sign-in link, then the wait ends at the sign-in", async () => {
    const run = harness({
      statuses: [needsLogin, needsLogin, loggedIn(true)],
      upOutput: "To authenticate, visit:\n\n\thttps://login.tailscale.com/a/abc123\n",
    });
    expect(await run.run()).toBe("https://server.example-tailnet.ts.net");
    expect(run.lines).toContain("Open this link on any device and sign in: https://login.tailscale.com/a/abc123");
    expect(run.commands).toContain("up --timeout=10s");
  });

  test("HTTPS off: it names the page, waits, and gives up after the limit with the reason", async () => {
    const run = harness({ statuses: [loggedIn(false)] });
    expect(await run.run()).toBeNull();
    const text = run.lines.join("\n");
    expect(text).toContain("https://login.tailscale.com/admin/dns");
    expect(text).toContain("Stopped waiting");
    expect(text).toContain("Phone and other computers: turn on HTTPS once");
  });

  test("without a person, it only says what to do", async () => {
    const notLoggedIn = harness({ statuses: [needsLogin] }, false);
    expect(await notLoggedIn.run()).toBeNull();
    expect(notLoggedIn.lines.join("\n")).toContain("Run `tailscale up`");
    expect(notLoggedIn.commands).not.toContain("up --timeout=10s");
    const httpsOff = harness({ statuses: [loggedIn(false)] }, false);
    expect(await httpsOff.run()).toBeNull();
    expect(httpsOff.lines.join("\n")).not.toContain("Waiting");
  });

  test("a skipped sign-in, or tailscale up with no link, ends with no address", async () => {
    const skipped = harness({ statuses: [needsLogin] }, true, "n");
    expect(await skipped.run()).toBeNull();
    expect(skipped.commands).not.toContain("up --timeout=10s");
    const noLink = harness({ statuses: [needsLogin], upOutput: "failed to connect to local tailscaled" });
    expect(await noLink.run()).toBeNull();
    expect(noLink.lines.join("\n")).toContain("gave no login link: failed to connect to local tailscaled");
  });
});

describe("describeAccess", () => {
  test("a second instance keeps its own port in the tailnet address", () => {
    expect(
      describeAccess({
        remoteAccess: { url: "https://server.example-tailnet.ts.net:7421", problem: null },
        localUrl: "http://127.0.0.1:7421",
      })[0],
    ).toBe("Open Eva: https://server.example-tailnet.ts.net:7421");
    expect(describeAccess({ remoteAccess: { url: null, problem: null }, localUrl: "x" })[0]).toContain("not available");
  });
});
