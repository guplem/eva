import { describe, expect, test } from "bun:test";
import { ClaudeLogin, type ClaudeLoginOptions } from "../../../../src/core/setup/claude-login.ts";
import { isEvaError } from "../../../../src/shared/errors.ts";
import type { TerminalProcess, TerminalProcessOptions } from "../../../../src/shared/terminal-process.ts";

const escape = "\u001b";
const bell = "\u0007";
const url =
  "https://claude.com/cai/oauth/authorize?code=true&client_id=example-client&response_type=code&scope=user%3Ainference&state=example-state";
const token = `sk-ant-oat01-${"a1B2_c3-".repeat(12)}`;

/** The shape of `claude setup-token` 2.1 in a terminal: a spinner, a terminal link, then the prompt. */
const addressScreen = [
  `${escape}[97m*${escape}[39m\r\n`,
  `${escape}[37m${escape}[2mBrowser didn't open? Use the url below to sign in (c to copy)${escape}[22m${escape}[39m\r\n\r\n`,
  `${escape}]8;id=example;${url}${bell}${escape}[37m${escape}[2m${url.slice(0, 80)}${escape}[22m${escape}[39m${escape}]8;;${bell}\r\n`,
  `${escape}[2GPaste${escape}[8Gcode${escape}[13Ghere${escape}[18Gif${escape}[21Gprompted${escape}[30G>\r\n`,
];
const tokenScreen = [
  `${escape}[32m✓ Long-lived authentication token created successfully!${escape}[39m\r\n\r\n`,
  `Your OAuth token (valid for 1 year):\r\n\r\n${escape}[1m${token}${escape}[22m\r\n\r\n`,
  "Store this token securely. You won't be able to see it again.\r\n",
];

interface FakeTerminal extends TerminalProcess {
  readonly command: readonly string[];
  readonly options: TerminalProcessOptions;
  readonly written: string[];
  print(text: string): void;
  exit(code: number): void;
  stopped: boolean;
}

/** A fake `claude setup-token`: `onStart` and `onWrite` decide what it prints. */
function fakeTerminal(
  command: readonly string[],
  options: TerminalProcessOptions,
  script: { onStart?: (terminal: FakeTerminal) => void; onWrite?: (terminal: FakeTerminal, text: string) => void },
): FakeTerminal {
  let output = "";
  const listeners: (() => void)[] = [];
  let finish: (code: number) => void = () => undefined;
  const exited = new Promise<number>((resolve) => {
    finish = resolve;
  });
  const terminal: FakeTerminal = {
    command,
    options,
    written: [],
    stopped: false,
    output: () => output,
    onOutput: (listener) => {
      listeners.push(listener);
    },
    write: (text) => {
      terminal.written.push(text);
      script.onWrite?.(terminal, text);
    },
    exited,
    stop: () => {
      terminal.stopped = true;
      finish(143);
    },
    print: (text) => {
      output += text;
      for (const listener of listeners) listener();
    },
    exit: (code) => {
      finish(code);
    },
  };
  queueMicrotask(() => script.onStart?.(terminal));
  return terminal;
}

function printAll(terminal: FakeTerminal, parts: readonly string[]): void {
  for (const part of parts) terminal.print(part);
}

function makeLogin(
  script: Parameters<typeof fakeTerminal>[2],
  overrides: Partial<ClaudeLoginOptions> = {},
): { login: ClaudeLogin; terminals: FakeTerminal[] } {
  const terminals: FakeTerminal[] = [];
  const login = new ClaudeLogin({
    program: "/opt/example/claude",
    cwd: "/tmp/example-eva/engines/claude",
    environment: () => ({ CLAUDE_CONFIG_DIR: "/tmp/example-eva/engines/claude" }),
    start: (command, options) => {
      const terminal = fakeTerminal(command, options, script);
      terminals.push(terminal);
      return terminal;
    },
    waitMs: 500,
    ...overrides,
  });
  return { login, terminals };
}

function showAddress(terminal: FakeTerminal): void {
  printAll(terminal, addressScreen);
}

const happyScript: Parameters<typeof fakeTerminal>[2] = {
  onStart: showAddress,
  onWrite: (terminal, text) => {
    if (text.endsWith("\r")) {
      printAll(terminal, tokenScreen);
      terminal.exit(0);
    }
  },
};

async function failure(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => null,
    (error: unknown) => error,
  );
}

describe("ClaudeLogin", () => {
  test("runs claude setup-token, reads the address, types the code and returns the token", async () => {
    const { login, terminals } = makeLogin(happyScript);
    expect(await login.start()).toEqual({ url });
    const terminal = terminals[0];
    expect(terminal?.command).toEqual(["/opt/example/claude", "setup-token"]);
    expect(terminal?.options.environment).toEqual({ CLAUDE_CONFIG_DIR: "/tmp/example-eva/engines/claude" });
    expect(await login.finish("  example-code#example-state \n")).toEqual({ token });
    expect(terminal?.written.join("")).toBe("example-code#example-state\r");
  });

  test("says so when no claude program is on this machine", async () => {
    const { login } = makeLogin(happyScript, { program: null });
    const error = await failure(login.start());
    expect(isEvaError(error, "claude_login_failed")).toBe(true);
    expect((error as Error).message).toContain("eva setup");
  });

  test("stops the program and says so when no address comes", async () => {
    const { login, terminals } = makeLogin({}, { waitMs: 30 });
    const error = await failure(login.start());
    expect(isEvaError(error, "claude_login_failed")).toBe(true);
    expect((error as Error).message).toContain("try again");
    expect(terminals[0]?.stopped).toBe(true);
  });

  test("shows the last words of claude when it ends before the address", async () => {
    const { login } = makeLogin({
      onStart: (terminal) => {
        terminal.print(`${escape}[31mError: example failure${escape}[39m\r\n`);
        terminal.exit(1);
      },
    });
    const error = await failure(login.start());
    expect(isEvaError(error, "claude_login_failed")).toBe(true);
    expect((error as Error).message).toContain("Error: example failure");
  });

  test("a new start stops the old login", async () => {
    const { login, terminals } = makeLogin(happyScript);
    await login.start();
    await login.start();
    expect(terminals[0]?.stopped).toBe(true);
    expect(terminals[1]?.stopped).toBe(false);
  });

  test("asks for a new start when no login waits for a code", async () => {
    const { login } = makeLogin(happyScript);
    const error = await failure(login.finish("example-code"));
    expect(isEvaError(error, "claude_login_failed")).toBe(true);
    expect((error as Error).message).toContain("Log in to Claude");
  });

  test("asks for a new start after the login ended on its own", async () => {
    const { login, terminals } = makeLogin(happyScript);
    await login.start();
    terminals[0]?.exit(0);
    await Bun.sleep(0);
    const error = await failure(login.finish("example-code"));
    expect((error as Error).message).toContain("Log in to Claude");
  });

  test("refuses an empty code or one with a line break inside", async () => {
    const { login, terminals } = makeLogin(happyScript);
    await login.start();
    for (const code of ["   ", "one\rtwo", "one\ntwo"]) {
      const error = await failure(login.finish(code));
      expect(isEvaError(error, "claude_login_failed")).toBe(true);
    }
    expect(terminals[0]?.written).toEqual([]);
  });

  test("says so when claude refuses the code, and ends the login", async () => {
    const { login, terminals } = makeLogin({
      onStart: showAddress,
      onWrite: (terminal) => {
        // claude 2.1 draws its error over the old screen, and waits instead of ending.
        terminal.print(`${escape}[4AOAuth error: Requ${escape}[20Gst${escape}[23Gfailed\r\n`);
        terminal.print(`${escape}[1C${escape}[1BPress${escape}[8GEnter${escape}[14Gto${escape}[17Gretry.\r\n`);
      },
    });
    await login.start();
    const error = await failure(login.finish("wrong-code"));
    expect(isEvaError(error, "claude_login_failed")).toBe(true);
    expect((error as Error).message).toContain("did not accept the code");
    expect(terminals[0]?.stopped).toBe(true);
    const again = await failure(login.finish("wrong-code"));
    expect((again as Error).message).toContain("Log in to Claude");
    expect(terminals).toHaveLength(1);
  });

  test("says what claude said when it ends after the code", async () => {
    const { login } = makeLogin({
      onStart: showAddress,
      onWrite: (terminal) => {
        terminal.print("Error: example failure\r\n");
        terminal.exit(1);
      },
    });
    await login.start();
    const error = await failure(login.finish("example-code"));
    expect((error as Error).message).toContain("ended before it gave the token");
    expect((error as Error).message).toContain("Error: example failure");
  });

  test("stops the program when no token comes after the code", async () => {
    const { login, terminals } = makeLogin({ onStart: showAddress }, { waitMs: 30 });
    await login.start();
    const error = await failure(login.finish("example-code"));
    expect(isEvaError(error, "claude_login_failed")).toBe(true);
    expect(terminals[0]?.stopped).toBe(true);
  });

  test("gives the program a lifetime, so a forgotten login ends", async () => {
    const { login, terminals } = makeLogin(happyScript);
    await login.start();
    expect(terminals[0]?.options.timeoutMs).toBe(15 * 60_000);
  });

  test("stop ends a waiting login", async () => {
    const { login, terminals } = makeLogin(happyScript);
    await login.start();
    login.stop();
    expect(terminals[0]?.stopped).toBe(true);
  });
});
