import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
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
  const listeners = new Set<() => void>();
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
    received: () => output.length,
    onOutput: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
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
    enterPauseMs: 1,
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
    // claude 2.1 reads a long write as a paste: an Enter inside it becomes a line break, not a submit.
    if (text === "\r") {
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
    // The Enter key goes alone, after a pause: in one write with the code, claude reads it as a paste.
    expect(terminal?.written).toEqual(["example-code#example-state", "\r"]);
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
    expect((error as Error).message).toContain("Start the login");
  });

  test("asks for a new start after the login ended on its own", async () => {
    const { login, terminals } = makeLogin(happyScript);
    await login.start();
    terminals[0]?.exit(0);
    await Bun.sleep(0);
    const error = await failure(login.finish("example-code"));
    expect((error as Error).message).toContain("Start the login");
  });

  test("keeps the token when claude ends the login by itself, such as in the browser that claude opened", async () => {
    const { login, terminals } = makeLogin(happyScript);
    await login.start();
    const terminal = terminals[0];
    if (terminal === undefined) throw new Error("No terminal started.");
    printAll(terminal, tokenScreen);
    terminal.exit(0);
    await Bun.sleep(0);
    expect(await login.finish("example-code")).toEqual({ token });
    expect(terminal.written).toEqual([]);
    // The token goes out once only.
    expect((await failure(login.finish("example-code"))) as Error).toBeInstanceOf(Error);
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
    expect((again as Error).message).toContain("Start the login");
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

describe("ClaudeLogin with output in pieces", () => {
  test("waits for the prompt, so a cut address never goes to the page", async () => {
    const { login, terminals } = makeLogin({
      onStart: (terminal) => {
        terminal.print(addressScreen[0] ?? "");
        terminal.print(addressScreen[1] ?? "");
        // The link stops in the middle of the address.
        terminal.print(`${escape}]8;id=example;${url.slice(0, 60)}`);
      },
    });
    const started = login.start();
    await Bun.sleep(5);
    const terminal = terminals[0];
    terminal?.print(`${url.slice(60)}${bell}${url}${escape}]8;;${bell}\r\n`);
    terminal?.print(addressScreen[3] ?? "");
    expect(await started).toEqual({ url });
  });

  test("waits for the end of the token", async () => {
    const { login, terminals } = makeLogin({ onStart: showAddress });
    await login.start();
    const finished = login.finish("example-code");
    const terminal = terminals[0];
    terminal?.print(`Your OAuth token (valid for 1 year):\r\n\r\n${token.slice(0, 40)}`);
    await Bun.sleep(5);
    terminal?.print(`${token.slice(40)}${escape}[22m\r\n`);
    expect(await finished).toEqual({ token });
  });

  test("takes the token at the end of the output when claude ends", async () => {
    const { login } = makeLogin({
      onStart: showAddress,
      onWrite: (terminal) => {
        terminal.print(token);
        terminal.exit(0);
      },
    });
    await login.start();
    expect(await login.finish("example-code")).toEqual({ token });
  });

  test("never puts the pasted code into the error", async () => {
    const { login } = makeLogin(
      {
        onStart: showAddress,
        // The terminal echoes what Eva types.
        onWrite: (terminal, text) => {
          terminal.print(text.replaceAll("\r", "\r\n"));
        },
      },
      { waitMs: 30 },
    );
    await login.start();
    const error = await failure(login.finish("secret-example-code"));
    expect((error as Error).message).not.toContain("secret-example-code");
  });

  test("never puts the hidden code into the error", async () => {
    const { login } = makeLogin(
      {
        onStart: showAddress,
        // claude 2.1 shows a star for each character of the code, and sometimes the last few.
        onWrite: (terminal, text) => {
          if (text !== "\r") terminal.print(`\r${escape}[31C${"*".repeat(text.length - 3)}${text.slice(-3)}\r\n`);
        },
      },
      { waitMs: 30 },
    );
    await login.start();
    const error = await failure(login.finish("secret-example-code"));
    expect((error as Error).message).not.toContain("***");
    expect((error as Error).message).not.toContain('It said: "');
  });

  test("a Finish before the address waits for no code", async () => {
    const { login, terminals } = makeLogin({});
    const started = login.start();
    const error = await failure(login.finish("example-code"));
    expect((error as Error).message).toContain("No Claude login waits");
    expect(terminals[0]?.written).toEqual([]);
    terminals[0]?.print(addressScreen.join(""));
    expect(await started).toEqual({ url });
  });

  test("a start that a newer start replaced says so", async () => {
    const { login, terminals } = makeLogin({});
    const first = login.start();
    const second = login.start();
    terminals[1]?.print(addressScreen.join(""));
    expect(await second).toEqual({ url });
    const error = await failure(first);
    expect(isEvaError(error, "claude_login_failed")).toBe(true);
  });

  test("stop also ends a login that waits for its token", async () => {
    const { login, terminals } = makeLogin({ onStart: showAddress });
    await login.start();
    const finished = failure(login.finish("example-code"));
    login.stop();
    expect(terminals[0]?.stopped).toBe(true);
    expect(isEvaError(await finished, "claude_login_failed")).toBe(true);
  });
});

/**
 * The screens of claude 2.1.304, with no colors, as Eva runs it (a fake token server made the
 * token). claude redraws only the cells that changed, so the token row jumps over a cell that
 * already holds its letter.
 */
function screen(name: "address" | "token" | "refused"): string {
  return readFileSync(
    join(import.meta.dir, "..", "..", "..", "fixtures", "claude-code", `setup-token-${name}.txt`),
    "utf8",
  );
}
const drawnToken = /sk-ant-\S*/.exec(screen("token"))?.[0]?.replace(`${escape}[10G`, "o").replace(`${escape}[K`, "");

describe("ClaudeLogin with the real screens of claude 2.1", () => {
  const showRealAddress = (terminal: FakeTerminal): void => {
    terminal.print(screen("address"));
  };

  test("reads the address", async () => {
    const { login } = makeLogin({ onStart: showRealAddress });
    expect((await login.start()).url).toContain("state=example-state");
  });

  test("reads a token that claude draws over its old screen", async () => {
    const { login } = makeLogin({
      onStart: showRealAddress,
      onWrite: (terminal, text) => {
        if (text !== "\r") return;
        terminal.print(screen("token"));
        terminal.exit(0);
      },
    });
    await login.start();
    expect(drawnToken).toStartWith("sk-ant-oat01-");
    expect(await login.finish("example-code")).toEqual({ token: drawnToken ?? "" });
  });

  test("reads a token that the Windows terminal places with cursor moves, not line breaks", async () => {
    // ConPTY puts each line at its row and column (ESC [ row ; column H). Without the move,
    // the next line "Store this token securely" joins the end of the token.
    const { login } = makeLogin({
      onStart: showAddress,
      onWrite: (terminal, text) => {
        if (text !== "\r") return;
        terminal.print(`${escape}[2J${escape}[H${escape}[3;1H${token}${escape}[4;1HStore this token securely.`);
        terminal.exit(0);
      },
    });
    await login.start();
    expect(await login.finish("example-code")).toEqual({ token });
  });

  test("waits for the end of a token that comes in pieces over the old screen", async () => {
    const { login, terminals } = makeLogin({ onStart: showRealAddress });
    await login.start();
    const finished = login.finish("example-code");
    const output = screen("token");
    const cut = output.indexOf("sk-ant-") + 30;
    terminals[0]?.print(output.slice(0, cut));
    await Bun.sleep(5);
    terminals[0]?.print(output.slice(cut));
    expect(await finished).toEqual({ token: drawnToken ?? "" });
  });

  test("says so when claude refuses the code", async () => {
    const { login } = makeLogin({
      onStart: showRealAddress,
      onWrite: (terminal, text) => {
        if (text === "\r") terminal.print(screen("refused"));
      },
    });
    await login.start();
    const error = await failure(login.finish("example-code"));
    expect((error as Error).message).toContain("did not accept the code");
  });

  test("says what claude said last, not what its old screen held", async () => {
    const { login } = makeLogin(
      {
        onStart: showRealAddress,
        onWrite: (terminal, text) => {
          if (text === "\r") terminal.print(`\r${escape}[1C${escape}[6AError: example failure${escape}[K\r\n`);
        },
      },
      { waitMs: 30 },
    );
    await login.start();
    const error = await failure(login.finish("example-code"));
    expect((error as Error).message).toContain('It said: "Error: example failure"');
  });
});

describe("ClaudeLogin with a full output buffer", () => {
  test("still finds the token after the cap on the output dropped old text", async () => {
    const cap = 1_500;
    let output = "";
    let received = 0;
    const listeners = new Set<() => void>();
    const print = (text: string): void => {
      received += text.length;
      output = (output + text).slice(-cap);
      for (const listener of listeners) listener();
    };
    const login = new ClaudeLogin({
      program: "claude",
      cwd: "/tmp/example-eva",
      environment: () => ({}),
      waitMs: 500,
      start: () => ({
        output: () => output,
        received: () => received,
        onOutput: (listener) => {
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        },
        write: () => {
          print(`\r\n${token}\r\n`);
        },
        exited: new Promise<number>(() => undefined),
        stop: () => undefined,
      }),
    });
    const started = login.start();
    // Spinner frames fill the buffer before the address comes.
    for (let frame = 0; frame < 200; frame++) print(`${escape}[97m*${escape}[39m\r\n`);
    print(addressScreen.join(""));
    expect(await started).toEqual({ url });
    expect(await login.finish("example-code")).toEqual({ token });
  });
});
