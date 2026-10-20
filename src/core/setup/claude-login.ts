/**
 * The Claude Code login, run by Eva so that a phone can finish it. `claude setup-token` prints
 * a login address, then waits for the code that Claude's page shows after the login. It needs a
 * terminal, so Eva runs it in a pseudo-terminal. The page shows the address, the person logs in
 * on any device, and pastes the code back. The program then prints a token that lasts a year.
 */
import { EvaError } from "../../shared/errors.ts";
import type { TerminalProcess, TerminalProcessStarter } from "../../shared/terminal-process.ts";

export interface ClaudeLoginOptions {
  readonly start: TerminalProcessStarter;
  /** The claude program. Null: Eva found none on this machine. */
  readonly program: string | null;
  readonly cwd: string;
  /** The instance's Claude folder and no old token: see `engineToolEnvironment`. */
  readonly environment: () => Record<string, string>;
  /** The longest wait for the address, and for the token after the code. */
  readonly waitMs?: number;
}

/** Time to open Claude's page, log in and paste the code. */
const lifetimeMs = 15 * 60_000;
const defaultWaitMs = 60_000;
const codeLimit = 2_000;
/** A token is whole only when a character that no token holds follows it: output comes in pieces. */
const tokenPattern = /sk-ant-oat[0-9A-Za-z_-]{20,}(?=[^0-9A-Za-z_-])/;
/** After the end of the program, nothing more comes, so the end of the output ends the token too. */
const endedTokenPattern = /sk-ant-oat[0-9A-Za-z_-]{20,}/;
const addressPattern = /https:\/\/\S*oauth\/authorize\S*/;
/** claude prints its prompt after the address, so the address is whole once the prompt shows. */
const promptPattern = /paste\s+code\s+here/i;
/** After a refused code, claude waits on this line instead of ending. */
const refusedPattern = /press\s+enter\s+to\s+retry/i;
/** What `read` returns when claude refused the code. */
const refused = Symbol("refused");
const tryAgain = 'Press "Log in to Claude" to try again.';

export class ClaudeLogin {
  private readonly options: ClaudeLoginOptions;
  /** One person, so one login at a time: a new start replaces it. */
  private current: TerminalProcess | null;
  /** True from the address until the first Finish: claude reads one code only. */
  private waitsForCode: boolean;

  constructor(options: ClaudeLoginOptions) {
    this.options = options;
    this.current = null;
    this.waitsForCode = false;
  }

  /** Starts `claude setup-token` and returns the address of Claude's login page. */
  async start(): Promise<{ url: string }> {
    this.stop();
    const { program } = this.options;
    if (program === null)
      throw failure(
        "Eva did not find the claude program on this machine. Run eva setup on Eva's computer to install it.",
      );
    let terminal: TerminalProcess;
    try {
      terminal = this.options.start([program, "setup-token"], {
        cwd: this.options.cwd,
        environment: this.options.environment(),
        timeoutMs: lifetimeMs,
      });
    } catch (error) {
      throw failure(`Eva could not start the claude program. ${tryAgain}`, error);
    }
    this.current = terminal;
    void terminal.exited.then(() => {
      if (this.current === terminal) this.release();
    });
    const result = await this.waitFor(terminal, (screen) =>
      promptPattern.test(screen.text)
        ? (screen.links.find(isLoginAddress) ?? match(screen.text, addressPattern))
        : null,
    );
    if (typeof result === "string") {
      // A second start meanwhile replaced this login.
      if (this.current !== terminal) throw failure(`A newer Claude login started meanwhile. ${tryAgain}`);
      this.waitsForCode = true;
      return { url: result };
    }
    this.stopTerminal(terminal);
    throw failure(`${ended(result, "Claude's login address")} ${tryAgain}`);
  }

  /** Types the code from Claude's page, and returns the token that claude prints then. */
  async finish(pasted: string): Promise<{ token: string }> {
    const code = pasted.trim();
    if (code === "" || code.length > codeLimit || /\s/.test(code))
      throw failure("Paste the code from Claude's page: one line, with no spaces.");
    const terminal = this.current;
    if (terminal === null || !this.waitsForCode)
      throw failure(
        `No Claude login waits for a code. A login ends after 15 minutes, and after each Finish. ${tryAgain}`,
      );
    this.waitsForCode = false;
    // The screen before the code holds no token and no refusal, so only the new output counts.
    const from = terminal.received();
    terminal.write(`${code}\r`);
    const result = await this.waitFor(
      terminal,
      (screen, exited) =>
        match(screen.text, exited ? endedTokenPattern : tokenPattern) ??
        (refusedPattern.test(screen.text) ? refused : null),
      { from, hide: code },
    );
    this.stopTerminal(terminal);
    if (result === refused)
      throw failure(`Claude did not accept the code. Copy the whole code from Claude's page. ${tryAgain}`);
    if (typeof result === "string") return { token: result };
    throw failure(`${ended(result, "the token")} ${tryAgain}`);
  }

  /** Ends the login, such as at Eva's stop. */
  stop(): void {
    const terminal = this.current;
    this.release();
    if (terminal !== null) terminal.stop();
  }

  private release(): void {
    this.current = null;
    this.waitsForCode = false;
  }

  private stopTerminal(terminal: TerminalProcess): void {
    if (this.current === terminal) this.release();
    terminal.stop();
  }

  /**
   * Waits until `read` finds a value in the output, the program ends, or the wait ends. Only the
   * output after `from`, a count of `received` characters, counts. A line with `hide` in it never goes into the error message.
   */
  private waitFor<T>(
    terminal: TerminalProcess,
    read: (screen: Screen, exited: boolean) => T | null,
    { from = 0, hide }: { readonly from?: number; readonly hide?: string } = {},
  ): Promise<T | { readonly reason: "exited" | "timeout"; readonly lastWords: string }> {
    return new Promise((resolve) => {
      let finished = false;
      const screen = (): Screen => screenOf(outputSince(terminal, from));
      const done = (value: { found: T } | { reason: "exited" | "timeout" }): void => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        unsubscribe();
        resolve("found" in value ? value.found : { ...value, lastWords: lastWords(screen(), hide) });
      };
      const check = (exited: boolean): void => {
        const found = read(screen(), exited);
        if (found !== null) done({ found });
      };
      const timer = setTimeout(() => {
        done({ reason: "timeout" });
      }, this.options.waitMs ?? defaultWaitMs);
      const unsubscribe = terminal.onOutput(() => {
        check(false);
      });
      void terminal.exited.then(() => {
        check(true);
        done({ reason: "exited" });
      });
      check(false);
    });
  }
}

/** The output after the first `from` characters, as far as the cap on the output kept it. */
function outputSince(terminal: TerminalProcess, from: number): string {
  const output = terminal.output();
  return output.slice(Math.max(0, output.length - (terminal.received() - from)));
}

/** The output as a person reads it, and the targets of its terminal links. */
interface Screen {
  readonly text: string;
  readonly links: readonly string[];
}

const escapeCharacter = "\u001b";
const bellCharacter = "\u0007";

/**
 * Removes the terminal codes, such as colors and cursor moves. A terminal link (OSC 8) keeps
 * its whole target, even where the visible text breaks a long address into lines.
 */
function screenOf(output: string): Screen {
  let text = "";
  const links: string[] = [];
  let index = 0;
  while (index < output.length) {
    const character = output.charAt(index);
    if (character === escapeCharacter && output.charAt(index + 1) === "]") {
      // An operating system command ends with a bell, or with ESC and a backslash.
      let end = index + 2;
      while (end < output.length && output.charAt(end) !== bellCharacter && output.charAt(end) !== escapeCharacter)
        end++;
      const body = output.slice(index + 2, end);
      if (body.startsWith("8;")) {
        const target = body.slice(body.indexOf(";", 2) + 1);
        if (target !== "") links.push(target);
      }
      index = output.charAt(end) === escapeCharacter ? end + 2 : end + 1;
    } else if (character === escapeCharacter && output.charAt(index + 1) === "[") {
      // A control sequence ends with one character from @ to ~. A cursor move becomes a space.
      let end = index + 2;
      while (end < output.length && !/[@-~]/.test(output.charAt(end))) end++;
      if (output.charAt(end) === "G" || output.charAt(end) === "C") text += " ";
      index = end + 1;
    } else if (character === escapeCharacter) {
      // A character set choice, such as ESC ( B, has one more character than other short codes.
      index += "()".includes(output.charAt(index + 1)) ? 3 : 2;
    } else {
      if (character === "\r" || character === "\n") text += "\n";
      else if (character >= " ") text += character;
      index++;
    }
  }
  return { text, links };
}

function isLoginAddress(link: string): boolean {
  return addressPattern.test(link);
}

function match(text: string, pattern: RegExp): string | null {
  return pattern.exec(text)?.[0] ?? null;
}

/** The last line that claude printed, which names the problem. */
function lastWords(screen: Screen, hide: string | undefined): string {
  const lines = screen.text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !promptPattern.test(line) && (hide === undefined || !line.includes(hide)));
  return (lines.at(-1) ?? "").slice(0, 300);
}

function ended(result: { readonly reason: "exited" | "timeout"; readonly lastWords: string }, awaited: string): string {
  const words = result.lastWords === "" ? "" : ` It said: "${result.lastWords}".`;
  if (result.reason === "timeout") return `The claude program did not give ${awaited} in time.${words}`;
  return `The claude program ended before it gave ${awaited}.${words}`;
}

function failure(message: string, cause?: unknown): EvaError {
  return new EvaError("claude_login_failed", message, cause === undefined ? undefined : { cause });
}
