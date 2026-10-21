import { describe, expect, test } from "bun:test";
import { startAndLetIn, type StartOptions } from "../../../../src/frontends/cli/setup-start.ts";
import { isEvaError } from "../../../../src/shared/errors.ts";

interface Fake {
  readonly options: StartOptions;
  readonly lines: string[];
  readonly asked: string[];
  readonly allowed: string[];
  readonly started: { count: number };
  /** The Tailscale accounts that setup let in, and the restarts that it asked for. */
  readonly accounts: { allowed: string[]; restarts: number };
}

/** `running` says whether Eva answers before setup starts her; `codes` maps a code to its device label. */
function fake(input: {
  interactive?: boolean;
  answers?: Record<string, string[]>;
  running?: boolean;
  startWorks?: boolean;
  codes?: Record<string, string>;
  /** For an Eva that is not the first one: the tailnet's accounts, owner first, and the ones let in. */
  tailnet?: { accounts: string[]; allowed?: string[] };
}): Fake {
  const lines: string[] = [];
  const asked: string[] = [];
  const allowed: string[] = [];
  const started = { count: 0 };
  const accounts = { allowed: [...(input.tailnet?.allowed ?? [])], restarts: 0 };
  let running = input.running ?? false;
  const queues = Object.fromEntries(Object.entries(input.answers ?? {}).map(([key, value]) => [key, [...value]]));
  const options: StartOptions = {
    interactive: input.interactive ?? true,
    ask: (key) => {
      asked.push(key);
      return Promise.resolve(queues[key]?.shift() ?? "");
    },
    write: (line) => lines.push(line),
    network: () => Promise.resolve("https://eva.example-tailnet.ts.net"),
    localUrl: "http://127.0.0.1:7420",
    startService: () => {
      started.count += 1;
      if (input.startWorks ?? true) running = true;
      return Promise.resolve(input.startWorks ?? true);
    },
    isRunning: () => Promise.resolve(running),
    allow: (code) => {
      const label = input.codes?.[code.trim().toUpperCase()] ?? null;
      if (label !== null) allowed.push(code);
      return Promise.resolve(label);
    },
    sleep: () => Promise.resolve(),
    account:
      input.tailnet === undefined
        ? null
        : {
            accounts: () => Promise.resolve(input.tailnet?.accounts ?? []),
            allowed: () => accounts.allowed,
            allow: (account) => {
              accounts.allowed = [account];
            },
            restart: () => {
              accounts.restarts += 1;
              return Promise.resolve(true);
            },
          },
  };
  return { options, lines, asked, allowed, started, accounts };
}

describe("startAndLetIn", () => {
  test("a person starts Eva, opens the page, and lets the first device in with its code", async () => {
    const setup = fake({ answers: { deviceCode: ["ZZZZ", "k7qx", ""] }, codes: { K7QX: "this computer, a browser" } });
    await startAndLetIn(setup.options);
    expect(setup.started.count).toBe(1);
    const text = setup.lines.join("\n");
    expect(text).toContain("Open https://eva.example-tailnet.ts.net");
    expect(text).toContain("No device waits with this code.");
    expect(text).toContain("Allowed this computer, a browser.");
    expect(text).toContain("Ctrl+C");
    expect(setup.allowed).toEqual(["k7qx"]);
  });

  test("with no Tailscale address yet, the page opens on this computer", async () => {
    const setup = fake({});
    await startAndLetIn({ ...setup.options, network: () => Promise.resolve(null) });
    expect(setup.lines.join("\n")).toContain("Open http://127.0.0.1:7420");
  });

  test("no keeps Eva stopped, and setup asks for no code", async () => {
    const setup = fake({ answers: { startService: ["n"] } });
    await startAndLetIn(setup.options);
    expect(setup.started.count).toBe(0);
    expect(setup.asked).not.toContain("deviceCode");
    expect(setup.lines.join("\n")).toContain("eva service install");
  });

  test("a running Eva is not started again", async () => {
    const setup = fake({ running: true });
    await startAndLetIn(setup.options);
    expect(setup.started.count).toBe(0);
    expect(setup.asked).not.toContain("startService");
    expect(setup.asked).toContain("deviceCode");
  });

  test("a failed start says so, and setup goes on with no code", async () => {
    const setup = fake({ startWorks: false });
    await startAndLetIn(setup.options);
    expect(setup.asked).not.toContain("deviceCode");
    expect(setup.lines.join("\n")).toContain("Eva did not start");
  });

  test("a script starts Eva only when it asks, and never waits for a code", async () => {
    const quiet = fake({ interactive: false });
    await startAndLetIn(quiet.options);
    expect(quiet.started.count).toBe(0);
    const starting = fake({ interactive: false, answers: { startService: ["yes"] } });
    await startAndLetIn(starting.options);
    expect(starting.started.count).toBe(1);
    expect(starting.asked).not.toContain("deviceCode");
  });
});

test("a script answers yes or no to the start, and nothing else", async () => {
  const setup = fake({ interactive: false, answers: { startService: ["true"] } });
  const error = await startAndLetIn(setup.options).then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(isEvaError(error, "config_invalid")).toBe(true);
  expect(setup.started.count).toBe(0);
});

describe("where the person finishes the setup", () => {
  test("Enter keeps the setup in the terminal", async () => {
    const setup = fake({ running: true });
    expect(await startAndLetIn(setup.options)).toBe("terminal");
    expect(setup.asked).toContain("finishOn");
    expect(setup.lines.join("\n")).not.toContain("#/settings/setup");
  });

  test("the web page gives its link, on this computer and on the other devices, with clear steps", async () => {
    const setup = fake({ running: true, answers: { finishOn: ["2"] } });
    expect(await startAndLetIn(setup.options)).toBe("page");
    const text = setup.lines.join("\n");
    expect(text).toContain("http://127.0.0.1:7420/#/settings/setup");
    expect(text).toContain("https://eva.example-tailnet.ts.net/#/settings/setup");
    expect(text).toContain("close this terminal");
  });

  test("with no Tailscale address, the page link is only the one on this computer", async () => {
    const setup = fake({ running: true, answers: { finishOn: ["page"] } });
    expect(await startAndLetIn({ ...setup.options, network: () => Promise.resolve(null) })).toBe("page");
    const text = setup.lines.join("\n");
    expect(text).toContain("http://127.0.0.1:7420/#/settings/setup");
    expect(text).not.toContain("ts.net/#/settings/setup");
  });

  test("an unknown answer asks again", async () => {
    const setup = fake({ running: true, answers: { finishOn: ["maybe", "1"] } });
    expect(await startAndLetIn(setup.options)).toBe("terminal");
    expect(setup.asked.filter((key) => key === "finishOn")).toHaveLength(2);
  });

  test("an Eva that does not run has no page, so setup goes on in the terminal without the question", async () => {
    const setup = fake({ answers: { startService: ["n"] } });
    expect(await startAndLetIn(setup.options)).toBe("terminal");
    expect(setup.asked).not.toContain("finishOn");
  });

  test("a script never gets the question", async () => {
    const setup = fake({ interactive: false, answers: { startService: ["yes"] } });
    expect(await startAndLetIn(setup.options)).toBe("terminal");
    expect(setup.asked).not.toContain("finishOn");
  });
});

describe("the Tailscale account of a second Eva (#322)", () => {
  const tailnet = { accounts: ["owner@example.com", "partner@example.com"] };

  test("a person picks the account from the list, and Eva starts with it", async () => {
    const setup = fake({ tailnet, answers: { tailscaleAccount: ["2"] } });
    await startAndLetIn(setup.options);
    expect(setup.accounts.allowed).toEqual(["partner@example.com"]);
    expect(setup.accounts.restarts).toBe(0);
    expect(setup.started.count).toBe(1);
    const text = setup.lines.join("\n");
    expect(text).toContain("2. partner@example.com");
    expect(text).toContain("lets in the devices of partner@example.com");
    // The choice comes before the start, so Eva starts with it.
    expect(setup.asked.indexOf("tailscaleAccount")).toBeLessThan(setup.asked.indexOf("startService"));
  });

  test("Enter keeps the computer owner's account", async () => {
    const setup = fake({ tailnet, answers: { tailscaleAccount: [""] } });
    await startAndLetIn(setup.options);
    expect(setup.accounts.allowed).toEqual([]);
  });

  test("an Eva that already runs restarts, so the account can log in at once", async () => {
    const setup = fake({ tailnet, running: true, answers: { tailscaleAccount: ["partner@example.com"] } });
    await startAndLetIn(setup.options);
    expect(setup.accounts.allowed).toEqual(["partner@example.com"]);
    expect(setup.accounts.restarts).toBe(1);
  });

  test("an account chosen before shows, Enter keeps it, and another pick changes it", async () => {
    const kept = fake({ tailnet: { ...tailnet, allowed: ["partner@example.com"] }, running: true });
    await startAndLetIn(kept.options);
    expect(kept.lines.join("\n")).toContain("This Eva lets in the devices of partner@example.com");
    expect(kept.accounts).toEqual({ allowed: ["partner@example.com"], restarts: 0 });
    const changed = fake({
      tailnet: { ...tailnet, allowed: ["partner@example.com"] },
      running: true,
      answers: { tailscaleAccount: ["1"] },
    });
    await startAndLetIn(changed.options);
    expect(changed.accounts).toEqual({ allowed: ["owner@example.com"], restarts: 1 });
  });

  test("a script's account that setup cannot use stops setup with the reason", async () => {
    for (const setup of [
      fake({ interactive: false, answers: { tailscaleAccount: ["partner@example.com"] } }),
      fake({
        tailnet: { accounts: ["owner@example.com"] },
        interactive: false,
        answers: { tailscaleAccount: ["partner@example.com"] },
      }),
    ]) {
      const refused = await startAndLetIn(setup.options).then(
        () => "went on",
        (error: unknown) => (isEvaError(error, "config_invalid") ? error.message : String(error)),
      );
      expect(refused).toContain("EVA_TAILSCALE_ACCOUNT");
    }
  });

  test("the first Eva on a computer, or a tailnet of one account, gets no question", async () => {
    const first = fake({});
    await startAndLetIn(first.options);
    expect(first.asked).not.toContain("tailscaleAccount");
    const alone = fake({ tailnet: { accounts: ["owner@example.com"] } });
    await startAndLetIn(alone.options);
    expect(alone.asked).not.toContain("tailscaleAccount");
  });

  test("a script names the account", async () => {
    const setup = fake({
      tailnet,
      interactive: false,
      answers: { tailscaleAccount: ["partner@example.com"], startService: ["yes"] },
    });
    await startAndLetIn(setup.options);
    expect(setup.accounts.allowed).toEqual(["partner@example.com"]);
  });
});
