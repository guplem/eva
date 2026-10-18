/**
 * The remote access watcher: it reads Tailscale, publishes the web UI when it can, and reads
 * again on a timer, so a Tailscale that becomes ready after the start needs no restart.
 */
import { isEvaError } from "../../shared/errors.ts";
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

/** The action that Eva runs now for the person. */
export type RemoteAccessBusy = "installing" | "signing_in";

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
  readonly busy?: RemoteAccessBusy | null;
}

/**
 * What the local API trusts. The host name exists only while Tailscale runs. The owner stays
 * from the last good read, so one failed read never turns the identity check off.
 */
export interface TailnetSnapshot {
  readonly hostName: string | null;
  readonly ownerLogin: string | null;
}

/** What the rest of Eva needs from the watcher. */
export interface RemoteAccessControl {
  current(): RemoteAccess;
  refresh(): Promise<RemoteAccess>;
  install(): Promise<RemoteAccess>;
  signIn(): Promise<RemoteAccess>;
}

export interface RemoteAccessOptions {
  readonly runner: ProcessRunner;
  readonly environment: Readonly<Record<string, string>>;
  readonly port: number;
  /** Found again at each read, so a new install is used at once. */
  readonly program: () => readonly string[];
  /** Null where Eva cannot install Tailscale by herself. */
  readonly install: (() => Promise<void>) | null;
  readonly onChange?: (access: RemoteAccess) => void;
  /** The timer seam; the default is the global `setInterval`. */
  readonly setInterval?: (tick: () => void, ms: number) => { stop(): void };
}

/**
 * A ready address is published again after this many reads (about 10 minutes at the 30-second
 * watch): `tailscale serve reset` or a lost serve setting shows no change in `tailscale status`.
 */
const republishEveryReads = 20;

export class RemoteAccessWatcher implements RemoteAccessControl {
  private readonly options: RemoteAccessOptions;
  private access: RemoteAccess;
  private hostName: string | null;
  private ownerLogin: string | null;
  /** The last link from `tailscale up`; Tailscale's own status may not show it. */
  private loginUrl: string | null;
  /** Why the last install or sign-in failed, shown while Tailscale stays on the steps it names. */
  private actionProblem: { readonly steps: readonly RemoteAccessStep[]; readonly text: string } | null;
  private busy: RemoteAccessBusy | null;
  private reading: Promise<RemoteAccess> | null;
  private readsSincePublish: number;
  private timer: { stop(): void } | null;

  constructor(options: RemoteAccessOptions) {
    this.options = options;
    this.hostName = null;
    this.ownerLogin = null;
    this.loginUrl = null;
    this.actionProblem = null;
    this.busy = null;
    this.reading = null;
    this.readsSincePublish = 0;
    this.timer = null;
    this.access = { url: null, problem: null, step: "start", link: null, account: null, canInstall: false, busy: null };
  }

  current(): RemoteAccess {
    return this.access;
  }

  tailnet(): TailnetSnapshot {
    return { hostName: this.hostName, ownerLogin: this.ownerLogin };
  }

  /** Reads Tailscale now. A read that runs already is shared. */
  refresh(): Promise<RemoteAccess> {
    this.reading ??= this.read().finally(() => {
      this.reading = null;
    });
    return this.reading;
  }

  /**
   * Installs Tailscale, once at a time, and only where none exists: a second daemon would hide
   * the one that works. A failure stays on the install and start steps.
   */
  async install(): Promise<RemoteAccess> {
    const install = this.options.install;
    if (install === null || this.busy !== null) return this.access;
    this.setBusy("installing");
    try {
      if ((await this.freshRead()).step !== "install") {
        this.setBusy(null);
        return this.access;
      }
      await install();
      this.actionProblem = null;
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      // A partial Linux install leaves the program but no running daemon: the cause must stay visible.
      this.actionProblem = {
        steps: ["install", "start"],
        text: isEvaError(error, "tailscale_install_failed") ? text : `The Tailscale install failed: ${text}`,
      };
    } finally {
      this.setBusy(null);
    }
    const after = await this.freshRead();
    if (after.step === "install" && after.problem === null) {
      this.actionProblem = {
        steps: ["install"],
        text: "The install ended, but Eva does not find Tailscale yet. Eva looks again within a minute.",
      };
      return this.freshRead();
    }
    return after;
  }

  /** Asks Tailscale for a fresh sign-in link. */
  async signIn(): Promise<RemoteAccess> {
    if (this.busy !== null) return this.access;
    this.setBusy("signing_in");
    try {
      const result = await signInToTailscale(this.context());
      if (result.link !== null) this.loginUrl = result.link;
      this.actionProblem = result.problem === null ? null : { steps: ["sign_in", "start"], text: result.problem };
    } finally {
      this.setBusy(null);
    }
    return this.freshRead();
  }

  /** Reads again on each tick, also while ready: Tailscale can stop, or the host name can change. */
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

  /** A read that starts after an action, never one that began before it ended. */
  private async freshRead(): Promise<RemoteAccess> {
    await this.reading;
    return this.refresh();
  }

  private async read(): Promise<RemoteAccess> {
    const state = await readTailscaleState(this.context());
    const before = this.access;
    const base = { canInstall: this.options.install !== null, busy: this.busy };
    let next: RemoteAccess;
    if (state.kind !== "running") this.hostName = null;
    if (state.kind !== "needs_login") this.loginUrl = null;
    if (state.kind === "missing") {
      next = { ...base, step: "install", url: null, problem: this.problemFor("install"), link: null, account: null };
    } else if (state.kind === "stopped") {
      const problem = this.problemFor("start") ?? state.detail;
      next = { ...base, step: "start", url: null, problem, link: null, account: this.ownerLogin };
    } else if (state.kind === "needs_login") {
      if (state.loginUrl !== null) this.loginUrl = state.loginUrl;
      const problem = this.problemFor("sign_in");
      next = { ...base, step: "sign_in", url: null, problem, link: this.loginUrl, account: null };
    } else {
      const facts = state.facts;
      this.hostName = facts.hostName;
      if (facts.ownerLogin !== null) this.ownerLogin = facts.ownerLogin;
      const account = facts.ownerLogin;
      const address = tailnetAddress(facts.hostName, this.options.port);
      this.readsSincePublish += 1;
      if (!facts.httpsEnabled) {
        next = { ...base, step: "https", url: null, problem: null, link: enableHttpsPage, account };
      } else if (before.step === "ready" && before.url === address && this.readsSincePublish < republishEveryReads) {
        next = { ...base, step: "ready", url: address, problem: null, link: null, account };
      } else {
        this.readsSincePublish = 0;
        const published = await publishWithTailscale(this.context(), facts, this.options.port);
        const step = published.url !== null ? "ready" : published.link !== null ? "https" : "failed";
        next = { ...base, step, url: published.url, problem: published.problem, link: published.link, account };
      }
    }
    if (this.actionProblem !== null && !this.actionProblem.steps.includes(next.step ?? "failed"))
      this.actionProblem = null;
    this.access = next;
    if (next.step !== before.step || next.url !== before.url) this.options.onChange?.(next);
    return next;
  }

  private problemFor(step: RemoteAccessStep): string | null {
    return this.actionProblem?.steps.includes(step) === true ? this.actionProblem.text : null;
  }

  private setBusy(busy: RemoteAccessBusy | null): void {
    this.busy = busy;
    this.access = { ...this.access, busy };
  }

  private context(): TailscaleContext {
    return { runner: this.options.runner, environment: this.options.environment, program: this.options.program() };
  }
}
