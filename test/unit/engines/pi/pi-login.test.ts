/**
 * pi's web login (#811). A fake pi runs the real login command of pi-login-command.ts, with a
 * fake `ModelRuntime`, and speaks pi's RPC records to Eva's `PiLogin`. A live run against a real
 * pi is the human check of the PR.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import evaLogin, {
  loginCommandName,
  loginRecordPrefix,
  type LoginContext,
  type LoginRuntime,
} from "../../../../src/engines/pi/pi-login-command.ts";
import * as extension from "../../../../src/engines/pi/pi-login-extension.ts";
import { loginArguments, PiLogin } from "../../../../src/engines/pi/pi-login.ts";
import type { PiProcess, PiProcessStarter } from "../../../../src/engines/pi/pi-process.ts";
import { EvaError } from "../../../../src/shared/errors.ts";

type PiRecord = Record<string, unknown>;

/** A pi that runs the real login command over RPC records. */
class LoginPi implements PiProcess {
  readonly records: AsyncIterable<PiRecord>;
  readonly sent: PiRecord[] = [];
  closed = false;
  private readonly outbox: PiRecord[] = [];
  private wake: (() => void) | null = null;
  private readonly answers = new Map<string, (value: PiRecord) => void>();
  private handler: ((args: string, context: LoginContext) => Promise<void>) | null = null;
  private nextId = 0;

  constructor(
    runtime: LoginRuntime,
    private readonly options: { readonly hasCommand?: boolean; readonly crashAfterPrompt?: boolean } = {},
  ) {
    evaLogin(
      {
        registerCommand: (name, command) => {
          if (name === loginCommandName) this.handler = command.handler;
        },
      },
      () => Promise.resolve(runtime),
    );
    this.records = this.stream();
  }

  send(record: PiRecord): void {
    this.sent.push(record);
    if (record["type"] === "get_commands") {
      const commands = this.options.hasCommand === false ? [] : [{ name: loginCommandName, source: "extension" }];
      this.push({ type: "response", id: record["id"], success: true, data: { commands } });
    } else if (record["type"] === "prompt") {
      if (this.options.crashAfterPrompt === true) {
        void this.close();
        return;
      }
      const message = String(record["message"]);
      void this.handler?.(message.slice(loginCommandName.length + 2), this.context());
    } else if (record["type"] === "extension_ui_response") {
      this.answers.get(String(record["id"]))?.(record);
    }
  }

  close(): Promise<void> {
    this.closed = true;
    this.wake?.();
    return Promise.resolve();
  }

  stderrTail(): string {
    return "pi: no such provider\n";
  }

  private context(): LoginContext {
    const dialog = (method: string, fields: PiRecord): Promise<PiRecord> => {
      const id = `dialog-${String((this.nextId += 1))}`;
      const answered = new Promise<PiRecord>((resolve) => this.answers.set(id, resolve));
      this.push({ type: "extension_ui_request", id, method, ...fields });
      return answered;
    };
    return {
      ui: {
        notify: (message) => {
          this.push({ type: "extension_ui_request", id: "notice", method: "notify", message });
        },
        input: async (title, placeholder) => {
          const answer = await dialog("input", { title, placeholder });
          return answer["cancelled"] === true ? undefined : String(answer["value"]);
        },
        select: async (title, options) => {
          const answer = await dialog("select", { title, options });
          return answer["cancelled"] === true ? undefined : String(answer["value"]);
        },
      },
    };
  }

  private push(record: PiRecord): void {
    this.outbox.push(record);
    this.wake?.();
  }

  private async *stream(): AsyncIterable<PiRecord> {
    for (;;) {
      const record = this.outbox.shift();
      if (record !== undefined) {
        yield record;
        continue;
      }
      if (this.closed) return;
      await new Promise<void>((resolve) => (this.wake = resolve));
      this.wake = null;
    }
  }
}

interface Login {
  readonly provider: string;
  readonly method: string;
}

/** A runtime whose login runs the given steps with pi's own callbacks. */
function fakeRuntime(
  steps: (interaction: Parameters<LoginRuntime["login"]>[2]) => Promise<void> = () => Promise.resolve(),
): LoginRuntime & { logins: Login[]; logouts: string[] } {
  const logins: Login[] = [];
  const logouts: string[] = [];
  return {
    logins,
    logouts,
    getProviders: () => [
      { id: "anthropic", name: "Anthropic", auth: { oauth: { login: () => null }, apiKey: { login: () => null } } },
      { id: "openai-codex", name: "ChatGPT", auth: { oauth: { login: () => null, isSubscription: true } } },
      { id: "openrouter", name: "OpenRouter", auth: { apiKey: { login: () => null } } },
      { id: "amazon-bedrock", name: "Bedrock", auth: {} },
    ],
    getProviderAuthStatus: (id) =>
      id === "openrouter" ? { configured: true, source: "stored" } : { configured: true, source: "environment" },
    login: async (provider, method, interaction) => {
      logins.push({ provider, method });
      await steps(interaction);
      return {};
    },
    logout: (provider) => {
      logouts.push(provider);
      return Promise.resolve();
    },
  };
}

let folder: string;
const place = { cwd: "/eva", environment: { PI_CODING_AGENT_DIR: "/eva/engines/pi-agent" } };

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), "eva-pi-login-"));
});

afterEach(() => {
  rmSync(folder, { recursive: true, force: true });
});

function login(
  runtime: LoginRuntime,
  options: ConstructorParameters<typeof LoginPi>[1] = {},
): { piLogin: PiLogin; processes: LoginPi[]; commands: (readonly string[])[] } {
  const processes: LoginPi[] = [];
  const commands: (readonly string[])[] = [];
  const start: PiProcessStarter = (command, startOptions) => {
    commands.push(command);
    expect(startOptions).toEqual(place);
    const pi = new LoginPi(runtime, options);
    processes.push(pi);
    return pi;
  };
  return {
    piLogin: new PiLogin({ command: () => ["pi"], workFolder: folder, start, waitMs: 2_000 }),
    processes,
    commands,
  };
}

describe("pi login command", () => {
  test("Eva's copies of its names match the command", () => {
    expect(extension.loginCommandName).toBe(loginCommandName);
    expect(extension.loginRecordPrefix).toBe(loginRecordPrefix);
    expect(extension.loginExtensionSource).toContain(`"${loginCommandName}"`);
  });

  test("pi loads only Eva's command, with no network for a list", () => {
    expect(loginArguments("list", "/eva/pi/eva-login-extension.ts")).toEqual([
      "--mode",
      "rpc",
      "--no-session",
      "--offline",
      "--no-extensions",
      "--no-skills",
      "--no-prompt-templates",
      "--no-context-files",
      "--no-tools",
      "-e",
      "/eva/pi/eva-login-extension.ts",
    ]);
    expect(loginArguments("login", "/x.ts")).not.toContain("--offline");
  });
});

describe("PiLogin", () => {
  test("lists pi's providers with a login method, never Anthropic", async () => {
    const { piLogin, commands } = login(fakeRuntime());

    const providers = await piLogin.providers(place);

    expect(providers).toEqual([
      { id: "openai-codex", name: "ChatGPT", methods: ["oauth"], subscription: true, loggedIn: false },
      { id: "openrouter", name: "OpenRouter", methods: ["api_key"], subscription: false, loggedIn: true },
    ]);
    expect(commands[0]?.slice(-2)).toEqual(["-e", join(folder, "eva-login-extension.ts")]);
    expect(readFileSync(join(folder, "eva-login-extension.ts"), "utf8")).toBe(extension.loginExtensionSource);
  });

  test("an API key goes from the answer to pi, and the login ends", async () => {
    const runtime = fakeRuntime(async (interaction) => {
      expect(await interaction.prompt({ type: "secret", message: "Enter OpenRouter API key" })).toBe("sk-or-key");
    });
    const { piLogin, processes } = login(runtime);

    const asked = await piLogin.start(place, "openrouter", "api_key");
    expect(asked).toMatchObject({
      status: "waiting",
      provider: "openrouter",
      question: { message: "Enter OpenRouter API key", kind: "secret", choices: [] },
    });
    const done = await piLogin.answer("  sk-or-key \n");

    expect(done).toMatchObject({ status: "done", question: null, error: null });
    expect(runtime.logins).toEqual([{ provider: "openrouter", method: "api_key" }]);
    expect(processes[0]?.closed).toBe(true);
  });

  test("an OAuth login shows the provider's page and takes the pasted address", async () => {
    const runtime = fakeRuntime(async (interaction) => {
      interaction.notify({ type: "auth_url", url: "https://auth.example.com/authorize?x=1", instructions: "Log in." });
      interaction.notify({ type: "progress", message: "Waiting for the browser" });
      expect(await interaction.prompt({ type: "manual_code", message: "Paste the authorization code" })).toBe(
        "http://localhost:1455/callback?code=abc",
      );
    });
    const { piLogin } = login(runtime);

    await piLogin.start(place, "openai-codex", "oauth");
    const waiting = await waitFor(piLogin, (state) => state.question !== null);
    expect(waiting).toMatchObject({
      link: { url: "https://auth.example.com/authorize?x=1", code: null, instructions: "Log in." },
      progress: "Waiting for the browser",
      question: { kind: "code", message: "Paste the authorization code" },
    });

    expect(await piLogin.answer("http://localhost:1455/callback?code=abc")).toMatchObject({ status: "done" });
  });

  test("a device login shows the code, and ends when the provider confirms it", async () => {
    let confirm = (): void => undefined;
    const confirmed = new Promise<void>((resolve) => (confirm = resolve));
    const runtime = fakeRuntime(async (interaction) => {
      expect(
        await interaction.prompt({ type: "select", message: "Where?", options: [{ id: "com", label: "GitHub.com" }] }),
      ).toBe("com");
      interaction.notify({
        type: "device_code",
        userCode: "ABCD-1234",
        verificationUri: "https://github.com/login/device",
      });
      await confirmed;
    });
    const { piLogin } = login(runtime);

    expect(await piLogin.start(place, "github-copilot", "oauth")).toMatchObject({
      question: { kind: "choice", choices: ["GitHub.com"] },
    });
    expect(await piLogin.answer("GitHub.com")).toMatchObject({
      status: "waiting",
      link: { url: "https://github.com/login/device", code: "ABCD-1234" },
    });
    confirm();

    expect(await waitFor(piLogin, (state) => state.status !== "waiting")).toMatchObject({ status: "done" });
  });

  test("a failed login says why", async () => {
    const { piLogin } = login(fakeRuntime(() => Promise.reject(new Error("Token exchange failed"))));

    expect(await piLogin.start(place, "openai-codex", "oauth")).toMatchObject({
      status: "failed",
      error: "Token exchange failed Press Log in to try again.",
    });
  });

  test("the command refuses an Anthropic login, even when asked", async () => {
    const runtime = fakeRuntime();
    const { piLogin } = login(runtime);

    expect((await piLogin.start(place, "anthropic", "oauth")).status).toBe("failed");
    expect(runtime.logins).toEqual([]);
  });

  test("a pi with no login command fails with the fix, and gets no prompt", async () => {
    const { piLogin, processes } = login(fakeRuntime(), { hasCommand: false });

    expect(await piLogin.start(place, "openrouter", "api_key")).toMatchObject({
      status: "failed",
      error: "This pi cannot run Eva's login. Update pi on the Updates page, then try again.",
    });
    expect(processes[0]?.sent.some((record) => record["type"] === "prompt")).toBe(false);
  });

  test("a pi that ends early gives its last line", async () => {
    const { piLogin } = login(fakeRuntime(), { crashAfterPrompt: true });

    const state = await piLogin.start(place, "openrouter", "api_key");

    expect(state.status).toBe("failed");
    expect(state.error).toContain('It said: "pi: no such provider"');
  });

  test("a new start ends the old login", async () => {
    const runtime = fakeRuntime(async (interaction) => {
      await interaction.prompt({ type: "secret", message: "Key" });
    });
    const { piLogin, processes } = login(runtime);
    await piLogin.start(place, "openrouter", "api_key");

    await piLogin.start(place, "openrouter", "api_key");

    expect(processes[0]?.closed).toBe(true);
    expect(processes[1]?.closed).toBe(false);
    piLogin.stop();
    expect(piLogin.state().status).toBe("idle");
  });

  test("an answer with no open question fails", () => {
    const { piLogin } = login(fakeRuntime());

    expect(piLogin.answer("x")).rejects.toThrow(EvaError);
  });

  test("a provider name that is not one word never reaches pi", () => {
    const { piLogin, processes } = login(fakeRuntime());

    expect(piLogin.start(place, "openrouter api_key; rm", "api_key")).rejects.toThrow(EvaError);
    expect(processes).toEqual([]);
  });

  test("no pi program gives the install step", () => {
    const piLogin = new PiLogin({ command: () => null, workFolder: folder });

    expect(piLogin.providers(place)).rejects.toThrow("Press Install pi");
  });

  test("logs out of one provider", async () => {
    const runtime = fakeRuntime();
    const { piLogin } = login(runtime);

    await piLogin.logout(place, "openrouter");

    expect(runtime.logouts).toEqual(["openrouter"]);
  });

  test("a link that is not a web address is not shown", async () => {
    const runtime = fakeRuntime(async (interaction) => {
      interaction.notify({ type: "auth_url", url: "javascript:alert(1)" });
      await interaction.prompt({ type: "manual_code", message: "Code" });
    });
    const { piLogin } = login(runtime);

    await piLogin.start(place, "openai-codex", "oauth");

    expect(piLogin.state().link).toBeNull();
    piLogin.stop();
  });
});

async function waitFor(
  piLogin: PiLogin,
  test: (state: ReturnType<PiLogin["state"]>) => boolean,
): Promise<ReturnType<PiLogin["state"]>> {
  for (let tries = 0; tries < 200 && !test(piLogin.state()); tries += 1) await Bun.sleep(5);
  return piLogin.state();
}
