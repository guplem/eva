/**
 * pi's login, run by Eva so that a phone can finish it (#811). Eva starts `pi --mode rpc` with
 * the login command of pi-login-command.ts, and plays the person's part of pi's login: she shows
 * each link and each question on the page, and passes each answer back to pi. pi saves the login
 * in its own `auth.json`, in the instance's pi folder that the environment names.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { EvaError } from "../../shared/errors.ts";
import { writeFileAtomic } from "../../shared/files.ts";
import {
  idlePiLogin,
  piLoginMethods,
  type PiLoginLink,
  type PiLoginMethod,
  type PiLoginPlace,
  type PiLoginQuestion,
  type PiLogins,
  type PiLoginState,
  type PiProvider,
} from "../../shared/pi-login.ts";
import { loginCommandName, loginExtensionSource, loginRecordPrefix } from "./pi-login-extension.ts";
import { systemPiProcessStarter, type PiProcess, type PiProcessStarter } from "./pi-process.ts";

export interface PiLoginOptions {
  /** The command that starts pi, read at each start: the page may install pi while Eva runs. Null: no pi. */
  readonly command: () => readonly string[] | null;
  /** Eva's own pi folder in the instance home, where she writes the login command. */
  readonly workFolder: string;
  readonly start?: PiProcessStarter;
  /** The longest wait for pi's next link, question or end. */
  readonly waitMs?: number;
  /** The longest life of one login: time to open the provider's page and log in. */
  readonly lifetimeMs?: number;
}

const defaultWaitMs = 60_000;
const lifetimeMs = 15 * 60_000;
const closeTimeoutMs = 5_000;
const commandsRequestId = "eva-login-commands";
const answerLimit = 10_000;
const tryAgain = "Press Log in to try again.";

/** One record of the login command, after its prefix. */
type CommandRecord = Readonly<Record<string, unknown>> & { readonly type?: unknown };

export class PiLogin implements PiLogins {
  private readonly options: PiLoginOptions;
  /** One person, so one login at a time: a new start replaces it. */
  private current: LoginRun | null;

  constructor(options: PiLoginOptions) {
    this.options = options;
    this.current = null;
  }

  async providers(place: PiLoginPlace): Promise<PiProvider[]> {
    const run = this.run(place, "list", ["list"]);
    await run.until((state) => state.status !== "waiting", this.waitMs());
    run.stop();
    if (run.state.status === "failed") throw failure(run.state.error ?? "pi did not list its providers.");
    if (run.providerList === null) throw failure("pi did not list its providers in time.");
    return run.providerList;
  }

  async start(place: PiLoginPlace, provider: string, method: PiLoginMethod): Promise<PiLoginState> {
    if (!/^[\w.-]{1,100}$/.test(provider)) throw failure("Pick a provider from the list.");
    if (!piLoginMethods.includes(method)) throw failure("Pick a login method from the list.");
    this.stop();
    const run = this.run(place, "login", ["login", provider, method], provider);
    this.current = run;
    await run.until(settled(run.state), this.waitMs());
    return this.state();
  }

  async answer(text: string): Promise<PiLoginState> {
    // pi's own callback can end an OAuth login on Eva's computer while the page still asks for the address.
    if (this.current?.state.status === "done") return this.state();
    const run = this.current?.state.question === null ? null : this.current;
    if (run === null) throw failure(`No pi login waits for an answer. A login ends after 15 minutes. ${tryAgain}`);
    if (text.length > answerLimit) throw failure("The answer is too long. Paste one line.");
    const before = run.state;
    run.answer(text);
    await run.until(settled(before), this.waitMs());
    return this.state();
  }

  state(): PiLoginState {
    return this.current?.state ?? idlePiLogin;
  }

  stop(): void {
    const run = this.current;
    this.current = null;
    run?.stop();
  }

  async logout(place: PiLoginPlace, provider: string): Promise<void> {
    if (!/^[\w.-]{1,100}$/.test(provider)) throw failure("Pick a provider from the list.");
    const run = this.run(place, "logout", ["logout", provider]);
    await run.until((state) => state.status !== "waiting", this.waitMs());
    run.stop();
    if (run.state.status !== "done") throw failure(run.state.error ?? "pi did not log out in time.");
  }

  private waitMs(): number {
    return this.options.waitMs ?? defaultWaitMs;
  }

  private run(place: PiLoginPlace, kind: RunKind, words: readonly string[], provider: string | null = null): LoginRun {
    const command = this.options.command();
    if (command === null)
      throw failure("Eva did not find the pi program on this machine. Press Install pi in Settings, AI engines.");
    const extensionFile = join(this.options.workFolder, "eva-login-extension.ts");
    if (!existsSync(extensionFile) || readFileSync(extensionFile, "utf8") !== loginExtensionSource)
      writeFileAtomic(extensionFile, loginExtensionSource);
    let pi: PiProcess;
    try {
      pi = (this.options.start ?? systemPiProcessStarter)([...command, ...loginArguments(kind, extensionFile)], place);
    } catch (error) {
      throw failure(`Eva could not start the pi program. ${tryAgain}`, error);
    }
    return new LoginRun(pi, kind, words, provider, this.options.lifetimeMs ?? lifetimeMs);
  }
}

type RunKind = "list" | "login" | "logout";

/** The pi command line of a login run (contract-tested like the chat turns). */
export function loginArguments(kind: RunKind, extensionFile: string): string[] {
  return [
    "--mode",
    "rpc",
    "--no-session",
    // A login reaches the provider, and pi may load its model list after it. A list needs no network.
    ...(kind === "login" ? [] : ["--offline"]),
    // Only Eva's command: no extension, skill or tool of the person's own runs in this pi.
    "--no-extensions",
    "--no-skills",
    "--no-prompt-templates",
    "--no-context-files",
    "--no-tools",
    "-e",
    extensionFile,
  ];
}

/** A wait ends at a new link, a new question, or the end of the run. */
function settled(before: PiLoginState): (state: PiLoginState) => boolean {
  return (state) =>
    state.status !== "waiting" ||
    (state.question !== null && state.question !== before.question) ||
    (state.link !== null && state.link !== before.link);
}

/** One pi process that runs one command of the login extension. */
class LoginRun {
  state: PiLoginState;
  providerList: PiProvider[] | null;
  private readonly pi: PiProcess;
  private readonly listeners: Set<() => void>;
  private dialogId: string | null;
  private readonly timer: ReturnType<typeof setTimeout>;
  private ended: boolean;

  constructor(pi: PiProcess, kind: RunKind, words: readonly string[], provider: string | null, lifetime: number) {
    this.pi = pi;
    this.state = { ...idlePiLogin, status: "waiting", provider };
    this.providerList = null;
    this.listeners = new Set();
    this.dialogId = null;
    this.ended = false;
    this.timer = setTimeout(() => {
      this.finish("failed", `The pi ${kind} took too long. ${tryAgain}`);
    }, lifetime);
    void this.read(words);
  }

  /** Waits until the state passes the test, the run ends, or the time is over. */
  until(test: (state: PiLoginState) => boolean, ms: number): Promise<void> {
    return new Promise((resolve) => {
      const check = (): void => {
        if (!test(this.state)) return;
        done();
      };
      const done = (): void => {
        clearTimeout(timeout);
        this.listeners.delete(check);
        resolve();
      };
      const timeout = setTimeout(done, ms);
      this.listeners.add(check);
      check();
    });
  }

  answer(text: string): void {
    const id = this.dialogId;
    const question = this.state.question;
    if (id === null || question === null) return;
    this.dialogId = null;
    this.pi.send({ type: "extension_ui_response", id, value: question.kind === "secret" ? text.trim() : text });
    this.change({ question: null });
  }

  stop(): void {
    if (this.state.status === "waiting") this.finish("failed", `The login stopped. ${tryAgain}`);
    else this.close();
  }

  private async read(words: readonly string[]): Promise<void> {
    this.pi.send({ id: commandsRequestId, type: "get_commands" });
    let failedLine: string | null = null;
    let doneSeen = false;
    try {
      for await (const record of this.pi.records) {
        if (record["type"] === "response" && record["id"] === commandsRequestId) {
          if (!hasLoginCommand(record["data"])) {
            this.finish("failed", "This pi cannot run Eva's login. Update pi on the Updates page, then try again.");
            break;
          }
          this.pi.send({ type: "prompt", message: `/${loginCommandName} ${words.join(" ")}` });
        } else if (record["type"] === "extension_ui_request") {
          const parsed = commandRecord(record);
          if (parsed === null) {
            this.dialog(record);
            continue;
          }
          if (parsed.type === "providers") this.providerList = providersOf(parsed["providers"]);
          else if (parsed.type === "event") this.event(parsed["event"]);
          else if (parsed.type === "failed") failedLine = text(parsed["message"]) ?? "pi gave no reason.";
          else if (parsed.type === "done") doneSeen = true;
          else if (parsed.type === "end") {
            if (failedLine !== null) this.finish("failed", `${failedLine} ${tryAgain}`);
            else this.finish("done", null);
            break;
          }
        }
      }
    } catch {
      // A broken pipe ends the run like an exit does.
    }
    if (!this.ended) {
      const tail = this.pi.stderrTail().trim().split("\n").at(-1)?.slice(0, 300) ?? "";
      this.finish(
        doneSeen ? "done" : "failed",
        doneSeen
          ? null
          : `pi stopped before the login finished.${tail === "" ? "" : ` It said: "${tail}".`} ${tryAgain}`,
      );
    }
  }

  /**
   * A question of pi's login, or any other dialog, which Eva cancels so that pi never waits on it.
   * The other methods, such as `notify`, wait for no answer.
   */
  private dialog(record: Readonly<Record<string, unknown>>): void {
    const id = record["id"];
    const method = record["method"];
    if (typeof id !== "string" || !["confirm", "select", "input", "editor"].includes(String(method))) return;
    const question = questionOf(record);
    if (question === null) {
      this.pi.send({ type: "extension_ui_response", id, cancelled: true });
      return;
    }
    // The page shows one question. An older one that is still open would hold pi for good.
    if (this.dialogId !== null) this.pi.send({ type: "extension_ui_response", id: this.dialogId, cancelled: true });
    this.dialogId = id;
    this.change({ question });
  }

  private event(value: unknown): void {
    const event = (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;
    const link = linkOf(event);
    if (link !== null) this.change({ link });
    else {
      const line = text(event["message"]);
      if (line !== null) this.change({ progress: line.slice(0, 300) });
    }
  }

  private finish(status: "done" | "failed", error: string | null): void {
    if (this.ended) return;
    this.ended = true;
    this.change({ status, error, question: null });
    this.close();
  }

  private close(): void {
    clearTimeout(this.timer);
    this.ended = true;
    void this.pi.close(closeTimeoutMs).catch(() => undefined);
  }

  private change(part: Partial<PiLoginState>): void {
    this.state = { ...this.state, ...part };
    for (const listener of [...this.listeners]) listener();
  }
}

function hasLoginCommand(data: unknown): boolean {
  const commands = (data as { commands?: unknown } | undefined)?.commands;
  return (
    Array.isArray(commands) &&
    commands.some((command) => (command as { name?: unknown } | null)?.name === loginCommandName)
  );
}

/** The record of a `notify` from the login command, or null for any other request. */
function commandRecord(record: Readonly<Record<string, unknown>>): CommandRecord | null {
  const message = record["message"];
  if (record["method"] !== "notify" || typeof message !== "string" || !message.startsWith(loginRecordPrefix))
    return null;
  return parseObject(message.slice(loginRecordPrefix.length));
}

function questionOf(record: Readonly<Record<string, unknown>>): PiLoginQuestion | null {
  const title = record["title"];
  if (typeof title !== "string" || !title.startsWith(loginRecordPrefix)) return null;
  const fields = parseObject(title.slice(loginRecordPrefix.length));
  if (fields === null) return null;
  const message = text(fields["message"]) ?? "";
  if (record["method"] === "select") {
    const options = record["options"];
    const choices = Array.isArray(options) ? options.filter((option) => typeof option === "string") : [];
    return choices.length === 0 ? null : { message, kind: "choice", placeholder: "", choices };
  }
  if (record["method"] !== "input") return null;
  const kind = fields["kind"] === "secret" ? "secret" : fields["kind"] === "manual_code" ? "code" : "text";
  return { message, kind, placeholder: text(record["placeholder"]) ?? "", choices: [] };
}

function linkOf(event: Readonly<Record<string, unknown>>): PiLoginLink | null {
  if (event["type"] === "auth_url") {
    const url = webAddress(event["url"]);
    return url === null ? null : { url, code: null, instructions: text(event["instructions"]) };
  }
  if (event["type"] === "device_code") {
    const url = webAddress(event["verificationUri"]);
    const code = text(event["userCode"]);
    return url === null || code === null ? null : { url, code, instructions: null };
  }
  return null;
}

/** Only a web address: the page shows it as a link, and a link of another scheme could run code. */
function webAddress(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? value : null;
  } catch {
    return null;
  }
}

function providersOf(value: unknown): PiProvider[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry: unknown) => {
    const fields = (typeof entry === "object" && entry !== null ? entry : {}) as Record<string, unknown>;
    const id = text(fields["id"]);
    const methods = Array.isArray(fields["methods"])
      ? piLoginMethods.filter((method) => (fields["methods"] as unknown[]).includes(method))
      : [];
    if (id === null || methods.length === 0) return [];
    return [
      {
        id,
        name: text(fields["name"]) ?? id,
        methods,
        subscription: fields["subscription"] === true,
        loggedIn: fields["loggedIn"] === true,
      },
    ];
  });
}

function parseObject(json: string): CommandRecord | null {
  try {
    const value: unknown = JSON.parse(json);
    return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as CommandRecord) : null;
  } catch {
    return null;
  }
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function failure(message: string, cause?: unknown): EvaError {
  return new EvaError("pi_login_failed", message, cause === undefined ? undefined : { cause });
}
