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
const tokenPattern = /sk-ant-oat[0-9A-Za-z_-]{20,}/;
const addressPattern = /https:\/\/\S*oauth\/authorize\S*/;
/** After a refused code, claude waits on this line instead of ending. */
const refusedPattern = /press\s+enter\s+to\s+retry/i;
/** What `read` returns when claude refused the code. */
const refused = Symbol("refused");
const tryAgain = 'Press "Log in to Claude" to try again.';

export class ClaudeLogin {
  private readonly options: ClaudeLoginOptions;
  /** One person, so one login at a time: a new start replaces it. */
  private pending: TerminalProcess | null;

  constructor(options: ClaudeLoginOptions) {
    this.options = options;
    this.pending = null;
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
    this.pending = terminal;
    void terminal.exited.then(() => {
      if (this.pending === terminal) this.pending = null;
    });
    const result = await this.waitFor(
      terminal,
      (screen) => screen.links.find(isLoginAddress) ?? match(screen.text, addressPattern),
    );
    if (typeof result === "string") return { url: result };
    this.stopTerminal(terminal);
    throw failure(`${ended(result, "Claude's login address")} ${tryAgain}`);
  }

  /** Types the code from Claude's page, and returns the token that claude prints then. */
  async finish(pasted: string): Promise<{ token: string }> {
    const code = pasted.trim();
    if (code === "" || code.length > codeLimit || /\s/.test(code))
      throw failure("Paste the code from Claude's page: one line, with no spaces.");
    const terminal = this.pending;
    if (terminal === null) throw failure(`No Claude login waits for a code. ${tryAgain}`);
    // The code goes to one program only: a second Finish must not type into it again.
    this.pending = null;
    // The screen before the code holds no token and no refusal, so only the new output counts.
    const from = terminal.output().length;
    terminal.write(`${code}\r`);
    const result = await this.waitFor(
      terminal,
      (screen) => match(screen.text, tokenPattern) ?? (refusedPattern.test(screen.text) ? refused : null),
      from,
    );
    this.stopTerminal(terminal);
    if (result === refused)
      throw failure(`Claude did not accept the code. Copy the whole code from Claude's page. ${tryAgain}`);
    if (typeof result === "string") return { token: result };
    throw failure(`${ended(result, "the token")} ${tryAgain}`);
  }

  /** Ends a waiting login, such as at Eva's stop. */
  stop(): void {
    const terminal = this.pending;
    this.pending = null;
    if (terminal !== null) terminal.stop();
  }

  private stopTerminal(terminal: TerminalProcess): void {
    if (this.pending === terminal) this.pending = null;
    terminal.stop();
  }

  /** Waits until `read` finds a value in the output, the program ends, or the wait ends. */
  private waitFor<T>(
    terminal: TerminalProcess,
    read: (screen: Screen) => T | null,
    from = 0,
  ): Promise<T | { readonly reason: "exited" | "timeout"; readonly lastWords: string }> {
    return new Promise((resolve) => {
      let finished = false;
      const done = (value: { found: T } | { reason: "exited" | "timeout" }): void => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        resolve(
          "found" in value ? value.found : { ...value, lastWords: lastWords(screenOf(terminal.output().slice(from))) },
        );
      };
      const check = (): void => {
        const found = read(screenOf(terminal.output().slice(from)));
        if (found !== null) done({ found });
      };
      const timer = setTimeout(() => {
        done({ reason: "timeout" });
      }, this.options.waitMs ?? defaultWaitMs);
      terminal.onOutput(check);
      void terminal.exited.then(() => {
        check();
        done({ reason: "exited" });
      });
      check();
    });
  }
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
      index += 3;
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
function lastWords(screen: Screen): string {
  const lines = screen.text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !/^paste code here/i.test(line));
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
