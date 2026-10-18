import { describe, expect, test } from "bun:test";
import { startAndLetIn, type StartOptions } from "../../../../src/frontends/cli/setup-start.ts";

interface Fake {
  readonly options: StartOptions;
  readonly lines: string[];
  readonly asked: string[];
  readonly allowed: string[];
  readonly started: { count: number };
}

/** `running` says whether Eva answers before setup starts her; `codes` maps a code to its device label. */
function fake(input: {
  interactive?: boolean;
  answers?: Record<string, string[]>;
  running?: boolean;
  startWorks?: boolean;
  codes?: Record<string, string>;
}): Fake {
  const lines: string[] = [];
  const asked: string[] = [];
  const allowed: string[] = [];
  const started = { count: 0 };
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
  };
  return { options, lines, asked, allowed, started };
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
