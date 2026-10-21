import { describe, expect, test } from "bun:test";
import {
  findTailscale,
  publishWithTailscale,
  readTailnetAccounts,
  readTailscaleState,
  signInToTailscale,
  tailnetAddress,
  tailnetPort,
  type TailscaleContext,
} from "../../../../src/core/remote-access/tailscale.ts";
import { EvaError } from "../../../../src/shared/errors.ts";
import type { ProcessRunner } from "../../../../src/shared/process-runner.ts";

function answering(exitCode: number, stdout: string, stderr = ""): ProcessRunner {
  return { run: () => Promise.resolve({ exitCode, stdout, stderr }) };
}

function context(runner: ProcessRunner): TailscaleContext {
  return { runner, environment: {}, program: ["tailscale"] };
}

const status = (extra: Record<string, unknown>): string =>
  JSON.stringify({
    BackendState: "Running",
    CertDomains: ["server.example-tailnet.ts.net"],
    Self: { DNSName: "server.example-tailnet.ts.net.", UserID: 7 },
    User: { "7": { LoginName: "owner@example.com" } },
    ...extra,
  });

describe("readTailscaleState", () => {
  test("a running, signed-in machine gives its facts", async () => {
    expect(await readTailscaleState(context(answering(0, status({}))))).toEqual({
      kind: "running",
      facts: { hostName: "server.example-tailnet.ts.net", ownerLogin: "owner@example.com", httpsEnabled: true },
    });
    expect(await readTailscaleState(context(answering(0, status({ User: {} }))))).toEqual({
      kind: "running",
      facts: { hostName: "server.example-tailnet.ts.net", ownerLogin: null, httpsEnabled: true },
    });
    const noHttps = await readTailscaleState(context(answering(0, status({ CertDomains: null }))));
    expect(noHttps.kind === "running" && noHttps.facts.httpsEnabled).toBe(false);
  });

  test("a machine that waits for a sign-in gives the sign-in link when Tailscale has one", async () => {
    expect(
      await readTailscaleState(
        context(answering(0, status({ BackendState: "NeedsLogin", AuthURL: "https://login.tailscale.com/a/abc" }))),
      ),
    ).toEqual({ kind: "needs_login", loginUrl: "https://login.tailscale.com/a/abc" });
    expect(
      await readTailscaleState(context(answering(0, status({ BackendState: "NeedsLogin", AuthURL: "" })))),
    ).toEqual({ kind: "needs_login", loginUrl: null });
    // Only Tailscale's own login page passes: the link lets anyone who opens it take this machine.
    expect(
      await readTailscaleState(
        context(answering(0, status({ BackendState: "NeedsLogin", AuthURL: "https://attacker.example/a/abc" }))),
      ),
    ).toEqual({ kind: "needs_login", loginUrl: null });
    for (const link of [
      "https://attacker.example/?https://login.tailscale.com/a/abc",
      "https://login.tailscale.com.attacker.example/a/abc",
      "https://login.tailscale.com/a/abc extra",
    ])
      expect(
        await readTailscaleState(context(answering(0, status({ BackendState: "NeedsLogin", AuthURL: link })))),
      ).toEqual({ kind: "needs_login", loginUrl: null });
    // `tailscale down` keeps the login, so the step is to turn Tailscale on, not to sign in.
    expect(await readTailscaleState(context(answering(0, status({ BackendState: "Stopped" }))))).toEqual({
      kind: "stopped",
      detail: "Tailscale is turned off. Run `tailscale up`.",
    });
  });

  test("a program that cannot start is missing; a daemon that does not answer is stopped", async () => {
    const missing: ProcessRunner = {
      run: () => Promise.reject(new EvaError("process_failed", "Could not start tailscale.")),
    };
    expect(await readTailscaleState(context(missing))).toEqual({ kind: "missing" });
    expect(
      await readTailscaleState(
        context(answering(1, "", "failed to connect to local tailscaled; it doesn't appear to be running")),
      ),
    ).toEqual({ kind: "stopped", detail: "failed to connect to local tailscaled; it doesn't appear to be running" });
    const slow: ProcessRunner = { run: () => Promise.reject(new EvaError("process_timeout", "timed out")) };
    expect((await readTailscaleState(context(slow))).kind).toBe("stopped");
    expect((await readTailscaleState(context(answering(0, "not json")))).kind).toBe("stopped");
    expect((await readTailscaleState(context(answering(0, "null")))).kind).toBe("stopped");
    expect((await readTailscaleState(context(answering(0, status({ BackendState: "Starting" }))))).kind).toBe(
      "stopped",
    );
    expect((await readTailscaleState(context(answering(0, status({ Self: {} }))))).kind).toBe("stopped");
  });

  test("the program comes first in each command, so a socket flag reaches every call", async () => {
    const commands: string[][] = [];
    const recording: ProcessRunner = {
      run: (command) => {
        commands.push([...command]);
        return Promise.resolve({ exitCode: 0, stdout: status({}), stderr: "" });
      },
    };
    await readTailscaleState({ runner: recording, environment: {}, program: ["/opt/ts", "--socket=/run/ts.sock"] });
    expect(commands).toEqual([["/opt/ts", "--socket=/run/ts.sock", "status", "--json"]]);
  });
});

describe("findTailscale", () => {
  const none = (): boolean => false;
  const notOnPath = (): null => null;

  test("on Linux, Eva's own userspace install wins, with its own socket", () => {
    const own = "/srv/eva-user/.local/lib/tailscale/tailscale";
    expect(
      findTailscale({
        platform: "linux",
        homeFolder: "/srv/eva-user",
        environment: {},
        exists: (path) => path === own,
        which: () => "/usr/bin/tailscale",
      }),
    ).toEqual([own, "--socket=/srv/eva-user/.local/share/tailscale/tailscaled.sock"]);
    expect(
      findTailscale({
        platform: "linux",
        homeFolder: "/srv/eva-user",
        environment: {},
        exists: none,
        which: notOnPath,
      }),
    ).toEqual(["tailscale"]);
  });

  test("on Windows, the installed program is found even when Eva's PATH predates the install", () => {
    const installed = "C:\\Program Files\\Tailscale\\tailscale.exe";
    expect(
      findTailscale({
        platform: "win32",
        homeFolder: "D:\\eva-user",
        environment: { ProgramFiles: "C:\\Program Files" },
        exists: (path) => path === installed,
        which: notOnPath,
      }),
    ).toEqual([installed]);
    expect(
      findTailscale({
        platform: "win32",
        homeFolder: "D:\\eva-user",
        environment: { ProgramFiles: "C:\\Program Files" },
        exists: (path) => path === installed,
        which: () => "C:\\Tools\\tailscale.exe",
      }),
    ).toEqual(["C:\\Tools\\tailscale.exe"]);
    expect(
      findTailscale({
        platform: "win32",
        homeFolder: "D:\\eva-user",
        environment: {},
        exists: none,
        which: notOnPath,
      }),
    ).toEqual(["tailscale"]);
  });
});

describe("publishWithTailscale", () => {
  const facts = { hostName: "server.example-tailnet.ts.net", ownerLogin: "owner@example.com", httpsEnabled: true };

  test("the default instance gets an address with no port; another instance keeps its own port", async () => {
    const commands: string[][] = [];
    const recording: ProcessRunner = {
      run: (command) => {
        commands.push([...command]);
        return Promise.resolve({ exitCode: 0, stdout: "", stderr: "" });
      },
    };
    expect(await publishWithTailscale(context(recording), facts, 7420)).toEqual({
      url: "https://server.example-tailnet.ts.net",
      problem: null,
      link: null,
    });
    expect((await publishWithTailscale(context(recording), facts, 7421)).url).toBe(
      "https://server.example-tailnet.ts.net:7421",
    );
    expect(commands[0]).toEqual(["tailscale", "serve", "--bg", "--https=443", "http://127.0.0.1:7420"]);
    expect(tailnetPort(7421)).toBe(7421);
    expect(tailnetAddress("server.example-tailnet.ts.net", 7420)).toBe("https://server.example-tailnet.ts.net");
  });

  test("a tailnet without HTTPS gets the link that turns it on; any other failure names itself", async () => {
    const disabled = answering(
      1,
      "Serve is not enabled on your tailnet.\nhttps://login.tailscale.com/f/serve?node=abc\n",
    );
    expect(await publishWithTailscale(context(disabled), facts, 7420)).toEqual({
      url: null,
      problem: "Turn on HTTPS for your tailnet once. Eva then publishes her page by herself.",
      link: "https://login.tailscale.com/f/serve?node=abc",
    });
    expect((await publishWithTailscale(context(answering(1, "", "some failure")), facts, 7420)).problem).toContain(
      "some failure",
    );
    const throwing: ProcessRunner = { run: () => Promise.reject(new Error("timed out")) };
    expect((await publishWithTailscale(context(throwing), facts, 7420)).problem).toContain("timed out");
  });

  test("a root tailscaled that refuses this user names the one command that allows it", async () => {
    const refused = answering(
      1,
      "",
      "Access denied: serve config denied\nUse 'sudo tailscale serve' or set operator with 'sudo tailscale set --operator=$USER'",
    );
    const result = await publishWithTailscale(context(refused), facts, 7420);
    expect(result.url).toBeNull();
    expect(result.problem).toContain("sudo tailscale set --operator=$USER");
  });

  test("with HTTPS off, Eva never runs tailscale serve, which would wait for a person", async () => {
    const commands: string[][] = [];
    const recording: ProcessRunner = {
      run: (command) => {
        commands.push([...command]);
        return Promise.resolve({ exitCode: 0, stdout: "", stderr: "" });
      },
    };
    const result = await publishWithTailscale(context(recording), { ...facts, httpsEnabled: false }, 7420);
    expect(result.link).toBe("https://login.tailscale.com/admin/dns");
    expect(commands).toEqual([]);
  });
});

describe("signInToTailscale", () => {
  test("tailscale up gives a fresh sign-in link, and stops waiting after its own timeout", async () => {
    const commands: string[][] = [];
    const runner: ProcessRunner = {
      run: (command) => {
        commands.push([...command]);
        return Promise.resolve({
          exitCode: 1,
          stdout: "",
          stderr: "\nTo authenticate, visit:\n\n\thttps://login.tailscale.com/a/fresh\n\ntimeout waiting for login\n",
        });
      },
    };
    expect(await signInToTailscale(context(runner))).toEqual({
      link: "https://login.tailscale.com/a/fresh",
      problem: null,
    });
    expect(commands[0]?.slice(0, 2)).toEqual(["tailscale", "up"]);
    expect(commands[0]?.some((part) => part.startsWith("--timeout="))).toBe(true);
  });

  test("a machine that signs in with no link, or that refuses, says so", async () => {
    expect(await signInToTailscale(context(answering(0, "")))).toEqual({ link: null, problem: null });
    expect(
      (await signInToTailscale(context(answering(1, "", "Access denied: prefs write access denied")))).problem,
    ).toContain("--operator");
    expect((await signInToTailscale(context(answering(1, "", "no daemon")))).problem).toContain("no daemon");
    const throwing: ProcessRunner = { run: () => Promise.reject(new Error("timed out")) };
    expect((await signInToTailscale(context(throwing))).problem).toContain("timed out");
  });
});

describe("readTailnetAccounts (#322)", () => {
  test("lists the accounts on the tailnet, the machine's owner first", async () => {
    const users = {
      User: {
        "3": { LoginName: "partner@example.com" },
        "7": { LoginName: "owner@example.com" },
        "9": { LoginName: "tagged-devices" },
      },
    };
    expect(await readTailnetAccounts(context(answering(0, status(users))))).toEqual([
      "owner@example.com",
      "partner@example.com",
    ]);
  });

  test("gives no account when Tailscale does not answer", async () => {
    expect(await readTailnetAccounts(context(answering(1, "", "not running")))).toEqual([]);
    expect(await readTailnetAccounts(context(answering(0, "not json")))).toEqual([]);
  });
});
