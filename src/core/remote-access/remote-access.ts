/**
 * The remote access watcher: it reads Tailscale, publishes the web UI when it can, and reads
 * again on a timer, so a Tailscale that becomes ready after the start needs no restart.
 */
import type { ProcessRunner } from "../../shared/process-runner.ts";
import {
  publishWithTailscale,
  readTailscaleState,
  signInToTailscale,
  tailnetAddress,
  enableHttpsPage,
  type TailscaleContext,
} from "./tailscale.ts";

/** What the person does next on this machine. "ready" means the address works. */
export type RemoteAccessStep = "install" | "start" | "sign_in" | "https" | "ready" | "failed";

/**
 * Phone access through `tailscale serve`, as `/api/status` sends it. An Eva older than #42
 * sends only `url` and `problem`, so the other fields are optional for a reader.
 */
export interface RemoteAccess {
  readonly url: string | null;
  /** What went wrong, or null when a step only waits for the person. */
  readonly problem: string | null;
  readonly step?: RemoteAccessStep;
  /** The page that the step needs: the sign-in link, or the page that turns HTTPS on. */
  readonly link?: string | null;
  /** The Tailscale account of this machine; each new device signs in with it. */
  readonly account?: string | null;
  /** True when Eva can install Tailscale on this machine by herself. */
  readonly canInstall?: boolean;
  readonly busy?: "installing" | "signing_in" | null;
}

/** The host name and its owner from one read of Tailscale, so the two never mix reads. */
export interface TailnetSnapshot {
  readonly hostName: string;
  readonly ownerLogin: string | null;
}

/** What the rest of Eva needs from the watcher. */
export interface RemoteAccessControl {
  current(): RemoteAccess;
  install(): Promise<RemoteAccess>;
  signIn(): Promise<RemoteAccess>;
}

export interface RemoteAccessOptions {
  readonly runner: ProcessRunner;
  readonly environment: Readonly<Record<string, string>>;
  readonly port: number;
  /** Found again at each read, so a new install is used at once. */
  readonly program: () => readonly string[];
  /** False in `eva setup`: only the running Eva publishes her page. */
  readonly publish: boolean;
  /** Null where Eva cannot install Tailscale by herself. */
  readonly install: (() => Promise<void>) | null;
  readonly onChange?: (access: RemoteAccess) => void;
  /** The timer seam; the default is the global `setInterval`. */
  readonly setInterval?: (tick: () => void, ms: number) => { stop(): void };
}

export class RemoteAccessWatcher implements RemoteAccessControl {
  private readonly options: RemoteAccessOptions;
  private access: RemoteAccess;
  private snapshot: TailnetSnapshot | null;
  /** The last link from `tailscale up`; Tailscale's own status may not show it. */
  private loginUrl: string | null;
  /** Why the last install or sign-in failed, shown while Tailscale stays on that step. */
  private actionProblem: { readonly step: RemoteAccessStep; readonly text: string } | null;
  private busy: "installing" | "signing_in" | null;
  private reading: Promise<RemoteAccess> | null;
  private timer: { stop(): void } | null;

  constructor(options: RemoteAccessOptions) {
    this.options = options;
    this.snapshot = null;
    this.loginUrl = null;
    this.actionProblem = null;
    this.busy = null;
    this.reading = null;
    this.timer = null;
    this.access = { url: null, problem: null, step: "start", link: null, account: null, canInstall: false, busy: null };
  }

  current(): RemoteAccess {
    return this.access;
  }

  /** The tailnet name and owner while Tailscale runs; null otherwise. */
  tailnet(): TailnetSnapshot | null {
    return this.snapshot;
  }

  /** Reads Tailscale now. A read that runs already is shared. */
  refresh(): Promise<RemoteAccess> {
    this.reading ??= this.read().finally(() => {
      this.reading = null;
    });
    return this.reading;
  }

  /** Waits for the read that runs now, if any. */
  async settled(): Promise<void> {
    await this.reading;
  }

  /** Installs Tailscale, once at a time. A failure stays on the install step. */
  async install(): Promise<RemoteAccess> {
    const install = this.options.install;
    if (install === null || this.busy !== null) return this.access;
    this.setBusy("installing");
    try {
      await install();
      this.actionProblem = null;
    } catch (error) {
      this.actionProblem = { step: "install", text: error instanceof Error ? error.message : String(error) };
    }
    this.busy = null;
    return this.refresh();
  }

  /** Asks Tailscale for a fresh sign-in link. */
  async signIn(): Promise<RemoteAccess> {
    if (this.busy !== null) return this.access;
    this.setBusy("signing_in");
    const result = await signInToTailscale(this.context());
    if (result.link !== null) this.loginUrl = result.link;
    this.actionProblem = result.problem === null ? null : { step: "sign_in", text: result.problem };
    this.busy = null;
    return this.refresh();
  }

  /** Reads again on each tick. The person sees each change within one interval. */
  watch(intervalMs: number): void {
    this.timer?.stop();
    const tick = (): void => {
      void this.refresh();
    };
    if (this.options.setInterval !== undefined) {
      this.timer = this.options.setInterval(tick, intervalMs);
      return;
    }
    const handle = setInterval(tick, intervalMs);
    this.timer = { stop: () => clearInterval(handle) };
  }

  stop(): void {
    this.timer?.stop();
    this.timer = null;
  }

  private async read(): Promise<RemoteAccess> {
    const state = await readTailscaleState(this.context());
    const before = this.access;
    const base = { canInstall: this.options.install !== null, busy: this.busy };
    let next: RemoteAccess;
    if (state.kind !== "running") this.snapshot = null;
    if (state.kind === "missing") {
      next = { ...base, step: "install", url: null, problem: this.problemFor("install"), link: null, account: null };
    } else if (state.kind === "stopped") {
      next = { ...base, step: "start", url: null, problem: state.detail, link: null, account: null };
    } else if (state.kind === "needs_login") {
      if (state.loginUrl !== null) this.loginUrl = state.loginUrl;
      const problem = this.problemFor("sign_in");
      next = { ...base, step: "sign_in", url: null, problem, link: this.loginUrl, account: null };
    } else {
      const facts = state.facts;
      this.snapshot = { hostName: facts.hostName, ownerLogin: facts.ownerLogin };
      this.loginUrl = null;
      const account = facts.ownerLogin;
      const address = tailnetAddress(facts.hostName, this.options.port);
      if (!facts.httpsEnabled) {
        next = { ...base, step: "https", url: null, problem: null, link: enableHttpsPage, account };
      } else if (!this.options.publish || (before.step === "ready" && before.url === address)) {
        next = { ...base, step: "ready", url: address, problem: null, link: null, account };
      } else {
        const published = await publishWithTailscale(this.context(), facts, this.options.port);
        const step = published.url !== null ? "ready" : published.link !== null ? "https" : "failed";
        next = { ...base, step, url: published.url, problem: published.problem, link: published.link, account };
      }
    }
    if (next.step !== this.actionProblem?.step) this.actionProblem = null;
    this.access = next;
    if (next.step !== before.step || next.url !== before.url) this.options.onChange?.(next);
    return next;
  }

  private problemFor(step: RemoteAccessStep): string | null {
    return this.actionProblem?.step === step ? this.actionProblem.text : null;
  }

  private setBusy(busy: "installing" | "signing_in"): void {
    this.busy = busy;
    this.access = { ...this.access, busy };
  }

  private context(): TailscaleContext {
    return { runner: this.options.runner, environment: this.options.environment, program: this.options.program() };
  }
}
