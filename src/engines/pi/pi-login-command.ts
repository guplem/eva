/**
 * The pi extension that runs pi's own login for Eva's web page. pi's `/login` needs its terminal
 * UI, but the login itself is `ModelRuntime.login`, whose questions and links go through plain
 * callbacks. This extension adds the command `/eva-login`, which calls it in RPC mode:
 *
 * - `/eva-login list`: one record with pi's providers and their login methods.
 * - `/eva-login login <provider> <oauth|api_key>`: pi's login. Each link and each line of
 *   progress goes out as a `notify`. Each question becomes an `input` or a `select` dialog.
 * - `/eva-login logout <provider>`: removes the provider's saved login.
 *
 * Each command ends with one `end` record. Every record is a `notify` whose message starts with
 * the prefix below and holds JSON. pi saves the login in its own `auth.json`, so no key or token
 * ever reaches Eva: a question's answer goes from the page to pi, and nowhere else.
 *
 * pi loads this file as text with `-e` (see pi-login-extension.ts), so it imports nothing.
 */

/** The command name. pi-login-extension.ts holds the same name for Eva. */
export const loginCommandName = "eva-login";

/** Starts each record and each dialog title. pi-login-extension.ts holds the same text. */
export const loginRecordPrefix = "eva-login:";

/** pi bills a Claude login through pi as extra usage, so Eva never offers or runs one. */
const refusedProviders: readonly string[] = ["anthropic"];

type Method = "oauth" | "api_key";

/** One question of pi's login, as pi's runtime asks it. */
interface AuthPrompt {
  readonly type?: string;
  readonly message?: string;
  readonly placeholder?: string;
  readonly options?: readonly { readonly id?: string; readonly label?: string }[];
}

/** One event of pi's login: a link, a device code or a line of progress. */
type AuthEvent = Readonly<Record<string, unknown>> & { readonly type?: string };

/** The part of pi's `ModelRuntime` that the command uses. */
export interface LoginRuntime {
  getProviders(): readonly {
    readonly id: string;
    readonly name?: string;
    readonly auth?: {
      readonly oauth?: { readonly login?: unknown; readonly isSubscription?: boolean };
      readonly apiKey?: { readonly login?: unknown };
    };
  }[];
  getProviderAuthStatus(providerId: string): { readonly configured: boolean; readonly source?: string };
  login(
    providerId: string,
    method: Method,
    interaction: {
      readonly prompt: (prompt: AuthPrompt) => Promise<string>;
      readonly notify: (event: AuthEvent) => void;
    },
  ): Promise<unknown>;
  logout(providerId: string): Promise<void>;
}

/** The part of the command context that the command uses. */
export interface LoginContext {
  readonly ui: {
    notify(message: string, type?: "info" | "warning" | "error"): void;
    input(title: string, placeholder?: string): Promise<string | undefined>;
    select(title: string, options: string[]): Promise<string | undefined>;
  };
  readonly modelRegistry?: { readonly runtime?: unknown };
}

/** The part of pi's extension API that the command uses. */
export interface LoginPi {
  registerCommand(
    name: string,
    options: { description: string; handler: (args: string, context: LoginContext) => Promise<void> },
  ): void;
}

/** Gives the runtime of the running pi, or a new one from pi's public SDK. */
export type RuntimeLoader = (context: LoginContext) => Promise<LoginRuntime>;

export default function evaLogin(pi: LoginPi, loadRuntime: RuntimeLoader = defaultRuntime): void {
  pi.registerCommand(loginCommandName, {
    description: "Eva's login of pi providers, for her web page.",
    handler: async (args, context) => {
      const send = (record: Record<string, unknown>): void => {
        context.ui.notify(loginRecordPrefix + JSON.stringify(record), "info");
      };
      try {
        await runCommand(args.trim().split(/\s+/), context, await loadRuntime(context), send);
      } catch (error) {
        send({ type: "failed", message: error instanceof Error ? error.message : String(error) });
      }
      send({ type: "end" });
    },
  });
}

async function runCommand(
  words: readonly string[],
  context: LoginContext,
  runtime: LoginRuntime,
  send: (record: Record<string, unknown>) => void,
): Promise<void> {
  const [action, provider = "", method = ""] = words;
  if (action === "list") {
    send({ type: "providers", providers: listProviders(runtime) });
    return;
  }
  if (refusedProviders.includes(provider)) throw new Error("Eva never logs in to Anthropic through pi.");
  if (action === "logout") {
    await runtime.logout(provider);
    send({ type: "done" });
    return;
  }
  if (action !== "login" || (method !== "oauth" && method !== "api_key"))
    throw new Error(`Eva's login command does not know "${words.join(" ")}".`);
  await runtime.login(provider, method, {
    notify: (event) => {
      send({ type: "event", event });
    },
    prompt: (prompt) => ask(context, prompt),
  });
  send({ type: "done" });
}

function listProviders(runtime: LoginRuntime): Record<string, unknown>[] {
  return runtime
    .getProviders()
    .filter((provider) => !refusedProviders.includes(provider.id))
    .map((provider) => {
      const methods: Method[] = [];
      if (typeof provider.auth?.oauth?.login === "function") methods.push("oauth");
      if (typeof provider.auth?.apiKey?.login === "function") methods.push("api_key");
      // Only a login in pi's own file counts: an environment key is not this Eva's login.
      const status = runtime.getProviderAuthStatus(provider.id);
      return {
        id: provider.id,
        name: provider.name ?? provider.id,
        methods,
        subscription: provider.auth?.oauth?.isSubscription === true,
        loggedIn: status.configured && status.source === "stored",
      };
    })
    .filter((provider) => provider.methods.length > 0);
}

/** Asks one question through an RPC dialog. A cancel ends the login, as pi's own dialog does. */
async function ask(context: LoginContext, prompt: AuthPrompt): Promise<string> {
  const message = prompt.message ?? "";
  const kind = prompt.type ?? "text";
  const title = loginRecordPrefix + JSON.stringify({ message, kind });
  if (kind === "select") {
    const options = (prompt.options ?? []).filter(
      (option): option is { id: string; label: string } =>
        typeof option.id === "string" && typeof option.label === "string",
    );
    const label = await context.ui.select(
      title,
      options.map((option) => option.label),
    );
    const chosen = options.find((option) => option.label === label);
    if (chosen === undefined) throw new Error("Login cancelled");
    return chosen.id;
  }
  const value = await context.ui.input(title, prompt.placeholder ?? "");
  if (value === undefined) throw new Error("Login cancelled");
  return value;
}

/**
 * The running pi's own runtime, whose login also updates its state. pi's public SDK gives the
 * same class when the registry does not show it.
 */
/** pi maps this name to its own copy for each extension. A variable keeps Eva's type check off it. */
const sdkModule = "@earendil-works/pi-coding-agent";

async function defaultRuntime(context: LoginContext): Promise<LoginRuntime> {
  const own = context.modelRegistry?.runtime;
  if (isRuntime(own)) return own;
  const sdk = (await import(sdkModule)) as {
    ModelRuntime?: { create(): Promise<unknown> };
  };
  const created = await sdk.ModelRuntime?.create();
  if (isRuntime(created)) return created;
  throw new Error("This pi has no login that Eva can run. Update pi on the Updates page.");
}

function isRuntime(value: unknown): value is LoginRuntime {
  const runtime = value as Partial<Record<keyof LoginRuntime, unknown>> | null | undefined;
  return (
    typeof runtime?.login === "function" &&
    typeof runtime.logout === "function" &&
    typeof runtime.getProviders === "function" &&
    typeof runtime.getProviderAuthStatus === "function"
  );
}
