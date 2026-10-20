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
  /** The pause between the code and the Enter key. */
  readonly enterPauseMs?: number;
}

/** Time to open Claude's page, log in and paste the code. */
const lifetimeMs = 15 * 60_000;
const defaultWaitMs = 60_000;
/**
 * claude 2.1 reads a long write as a paste, and an Enter inside a paste becomes a line break.
 * Then claude waits with the code in its field, and never sends it. A pause before the Enter
 * makes it a separate key press.
 */
const defaultEnterPauseMs = 500;
const codeLimit = 2_000;
const tokenPattern = /sk-ant-oat[0-9A-Za-z_-]{20,}/;
const addressPattern = /https:\/\/\S*oauth\/authorize\S*/;
/** claude prints its prompt after the address, so the address is whole once the prompt shows. */
const promptPattern = /paste\s+code\s+here/i;
/** claude 2.1 hides the code in its field as stars: such a line tells the person nothing. */
const maskedPattern = /^\*{3,}\S{0,8}$/;
/** After a refused code, claude waits on this line instead of ending. */
const refusedPattern = /press\s+enter\s+to\s+retry/i;
/** What `read` returns when claude refused the code. */
const refused = Symbol("refused");
const tryAgain = 'Press "Start the login" to try again.';

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
    // Only the output after the code goes into the last words: the old screen holds the address.
    const from = terminal.received();
    terminal.write(code);
    await Bun.sleep(this.options.enterPauseMs ?? defaultEnterPauseMs);
    // A stop or a new start during the pause ended this login: the wait below reads its end.
    if (this.current === terminal) terminal.write("\r");
    const result = await this.waitFor(
      terminal,
      (screen, exited) =>
        // Output comes in pieces, so a line is whole only after claude moved on, or ended.
        match(exited ? screen.text : screen.drawn, tokenPattern) ?? (refusedPattern.test(screen.text) ? refused : null),
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
   * Waits until `read` finds a value on the screen, the program ends, or the wait ends. The last
   * words come only from lines that the output after `from`, a count of `received` characters,
   * wrote. A line with `hide` in it never goes into the error message.
   */
  private waitFor<T>(
    terminal: TerminalProcess,
    read: (screen: Screen, exited: boolean) => T | null,
    { from = 0, hide }: { readonly from?: number; readonly hide?: string } = {},
  ): Promise<T | { readonly reason: "exited" | "timeout"; readonly lastWords: string }> {
    return new Promise((resolve) => {
      let finished = false;
      const screen = (): Screen => {
        const output = terminal.output();
        return screenOf(output, output.length - (terminal.received() - from));
      };
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

/** The output as a person sees it on the screen, and the targets of its terminal links. */
interface Screen {
  /** All the lines on the screen. */
  readonly text: string;
  /** The lines above the cursor: claude drew them and moved on, so none of them is half drawn. */
  readonly drawn: string;
  /** The lines that the new output wrote, from the top. */
  readonly fresh: readonly string[];
  readonly links: readonly string[];
}

const escapeCharacter = "\u001b";
const bellCharacter = "\u0007";

/**
 * Plays the output on a grid of character cells. claude 2.1 redraws only the cells that changed,
 * and jumps over a cell that already holds the right character. So a line, such as the token, is
 * whole only on the grid, never in the output text. The output from index `from` on is new.
 * A terminal link (OSC 8) keeps its whole target, even where the screen breaks a long address.
 */
function screenOf(output: string, from: number): Screen {
  const rows: string[][] = [];
  const fresh = new Set<number>();
  const links: string[] = [];
  let row = 0;
  let column = 0;
  const cells = (): string[] => {
    while (rows.length <= row) rows.push([]);
    return rows[row] ?? [];
  };
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
      // A control sequence ends with one character from @ to ~.
      let end = index + 2;
      while (end < output.length && !/[@-~]/.test(output.charAt(end))) end++;
      const parameter = output.slice(index + 2, end);
      const count = Math.max(1, Number.parseInt(parameter, 10) || 1);
      const line = cells();
      switch (output.charAt(end)) {
        case "A":
          row = Math.max(0, row - count);
          break;
        case "B":
          row += count;
          break;
        case "C":
          column += count;
          break;
        case "D":
          column = Math.max(0, column - count);
          break;
        case "G":
          column = count - 1;
          break;
        case "K":
          // Erase in line: 0 or none to the end, 1 from the start, 2 the whole line.
          if (parameter === "2") line.length = 0;
          else if (parameter === "1") line.fill(" ", 0, column + 1);
          else line.length = Math.min(line.length, column);
          break;
      }
      index = end + 1;
    } else if (character === escapeCharacter) {
      // A character set choice, such as ESC ( B, has one more character than other short codes.
      index += "()".includes(output.charAt(index + 1)) ? 3 : 2;
    } else {
      if (character === "\r") column = 0;
      else if (character === "\n") row++;
      else if (character >= " ") {
        const line = cells();
        while (line.length < column) line.push(" ");
        line[column] = character;
        column++;
        if (index >= from) fresh.add(row);
      }
      index++;
    }
  }
  const lines = rows.map((line) => line.join(""));
  return {
    text: lines.join("\n"),
    drawn: lines
      .slice(0, row)
      .map((line) => `${line}\n`)
      .join(""),
    fresh: lines.filter((_line, number) => fresh.has(number)),
    links,
  };
}

function isLoginAddress(link: string): boolean {
  return addressPattern.test(link);
}

function match(text: string, pattern: RegExp): string | null {
  return pattern.exec(text)?.[0] ?? null;
}

/** The last line that claude printed, which names the problem. */
function lastWords(screen: Screen, hide: string | undefined): string {
  const lines = screen.fresh
    .map((line) => line.trim())
    .filter(
      (line) =>
        line !== "" &&
        !promptPattern.test(line) &&
        !maskedPattern.test(line) &&
        (hide === undefined || !line.includes(hide)),
    );
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
