/**
 * The pi login port: what the core asks of the pi login that the web page runs (#811). The
 * pi engine implements it, and `src/main.ts` passes it in. pi keeps each login in its own
 * `auth.json`, so no key or token passes through this port, but the answer to a question.
 */

/** A subscription login through the provider's page, or an API key. */
export type PiLoginMethod = "oauth" | "api_key";

export const piLoginMethods: readonly PiLoginMethod[] = ["oauth", "api_key"];

/** One provider of pi, such as ChatGPT or OpenRouter. */
export interface PiProvider {
  readonly id: string;
  readonly name: string;
  readonly methods: readonly PiLoginMethod[];
  /** Its OAuth login uses a subscription, such as ChatGPT Plus. */
  readonly subscription: boolean;
  /** pi has a saved login of this provider. */
  readonly loggedIn: boolean;
}

/** A question of the login, such as "Enter the API key". */
export interface PiLoginQuestion {
  readonly message: string;
  /** `secret`: a key that the page hides. `code`: the code or the address after the provider's page. */
  readonly kind: "text" | "secret" | "code" | "choice";
  readonly placeholder: string;
  /** The answers to pick from, for a `choice`. */
  readonly choices: readonly string[];
}

/** A page to open: the provider's login page, or a device page with a code to type there. */
export interface PiLoginLink {
  readonly url: string;
  /** A device code to type on the page. Null: the page needs no code. */
  readonly code: string | null;
  readonly instructions: string | null;
}

export interface PiLoginState {
  /** `idle`: no login runs. `waiting`: the login waits for the person or the provider. */
  readonly status: "idle" | "waiting" | "done" | "failed";
  readonly provider: string | null;
  readonly link: PiLoginLink | null;
  readonly question: PiLoginQuestion | null;
  /** The last line of progress, such as "Waiting for the browser". */
  readonly progress: string | null;
  /** Why the login failed, for `failed`. */
  readonly error: string | null;
}

export const idlePiLogin: PiLoginState = {
  status: "idle",
  provider: null,
  link: null,
  question: null,
  progress: null,
  error: null,
};

/** Where pi runs, and its environment, which names the instance's pi folder. */
export interface PiLoginPlace {
  readonly cwd: string;
  readonly environment: Readonly<Record<string, string>>;
}

export interface PiLogins {
  /** pi's providers that have a login method, with their login state. */
  providers(place: PiLoginPlace): Promise<PiProvider[]>;
  /** Starts a login, and ends any other one. Gives the state at the first link, question or end. */
  start(place: PiLoginPlace, provider: string, method: PiLoginMethod): Promise<PiLoginState>;
  /** Answers the open question. Gives the state at the next link, question or end. */
  answer(text: string): Promise<PiLoginState>;
  /** The state now, such as while a device login waits for the provider. */
  state(): PiLoginState;
  /** Ends the login that runs, if any. */
  stop(): void;
  /** Removes the saved login of one provider. */
  logout(place: PiLoginPlace, provider: string): Promise<void>;
}
