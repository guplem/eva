/**
 * Device login for the web UI. A browser asks to log in with a short code. The owner allows it in
 * Telegram, or types the code in a terminal on Eva's computer, and the browser gets a device token.
 * A login link from that terminal logs in a browser on Eva's computer with no code. Eva stores only the SHA-256 hash of each token, in `state/devices.json`.
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { EvaError } from "../../shared/errors.ts";
import { readJsonTolerant, writeFileAtomic } from "../../shared/files.ts";

export interface DeviceLoginRequest {
  readonly id: string;
  /** The page shows this code, and the approver shows it too, so the owner can compare them. */
  readonly code: string;
  /** The Tailscale account of the browser. */
  readonly account: string;
  readonly expiresAt: string;
  /** The approvers that can answer, such as "Telegram" and "terminal", so the page says where to answer. */
  readonly approvers: readonly string[];
}

export type DeviceLoginState =
  | { readonly state: "pending" }
  | { readonly state: "allowed"; readonly token: string }
  | { readonly state: "denied" }
  /** Also the answer for an unknown request, or a request of another account. */
  | { readonly state: "expired" };

/** A front end that asks the owner, such as the Telegram bot. */
export interface DeviceLoginApprover {
  /** How the page names it to the person. */
  readonly name: string;
  /**
   * True when the person checks the code on their own screen, as in the terminal. Only such an
   * approver gets a request from this computer: any local program can make one.
   */
  readonly servesThisComputer?: boolean;
  /** False while the approver cannot reach the owner, such as a bot with no paired chat. */
  canApprove(): boolean;
  ask(request: DeviceLoginRequest): void;
  /** Another approver, or this one, answered a request that this approver was asked. */
  settled?(id: string, answer: "allow" | "deny"): void;
}

/** What the page hears on its event socket. These are not session events, so they carry no `seq`. */
export type DeviceLoginEvent =
  | { readonly kind: "device_login_request"; readonly request: DeviceLoginRequest }
  | { readonly kind: "device_login_settled"; readonly id: string; readonly answer: "allow" | "deny" };

/** A device as the page lists it. The id is a hash prefix, so the list never shows a whole hash. */
export interface DeviceSummary {
  readonly id: string;
  readonly label: string;
  readonly createdAt: string;
  /** The device of the caller. */
  readonly current: boolean;
}

export interface DeviceLoginsOptions {
  readonly path: string;
  readonly now: () => Date;
}

interface PendingLogin {
  readonly request: DeviceLoginRequest;
  readonly label: string;
  readonly expiresAtMs: number;
  readonly asked: readonly DeviceLoginApprover[];
  answer: { readonly state: "allowed"; readonly token: string } | { readonly state: "denied" } | null;
}

export interface StoredDevice {
  readonly hash: string;
  readonly label: string;
  readonly createdAt: string;
}

const pendingLifetimeMs = 5 * 60_000;
const requestWindowMs = 10 * 60_000;
/** A local program can forge the Tailscale header too, so the requests are few: they ping the owner's phone. */
const requestsPerWindow = 5;
/** No 0, O, 1 or I: the owner compares the code by eye. */
const codeLetters = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const codeLength = 4;
/** 64 bits of the hash tell the devices apart, and the id never logs anyone in. */
const deviceIdLength = 16;
/** A login link opens a browser on Eva's computer, which starts at once: two minutes are enough. */
const loginLinkLifetimeMs = 2 * 60_000;
/** Only the terminal asks for links, so a few at once are enough, and a loop of requests uses no memory. */
const loginLinksAtOnce = 5;

/** A link that logs in one browser on Eva's computer, once (#407). */
export interface LoginLink {
  /** Only the page reads it, from the address fragment, which no request carries. */
  readonly secret: string;
  readonly expiresAt: string;
}

export class DeviceLogins {
  private readonly options: DeviceLoginsOptions;
  private readonly pending: Map<string, PendingLogin>;
  private readonly approvers: Set<DeviceLoginApprover>;
  private readonly forgetListeners: Set<() => void>;
  /** The SHA-256 hash of each waiting login link's secret, and when it ends. */
  private readonly loginLinks: Map<string, number>;
  /** The recent requests of each account, so one account cannot use up another's. */
  private requestTimes: Map<string, number[]>;
  private devices: StoredDevice[];

  constructor(options: DeviceLoginsOptions) {
    this.options = options;
    this.pending = new Map();
    this.approvers = new Set();
    this.forgetListeners = new Set();
    this.loginLinks = new Map();
    this.requestTimes = new Map();
    this.devices = loadDevices(options.path);
  }

  /** Adds an approver. Returns a function that removes it. */
  attachApprover(approver: DeviceLoginApprover): () => void {
    this.approvers.add(approver);
    return () => {
      this.approvers.delete(approver);
    };
  }

  canApprove(): boolean {
    return [...this.approvers].some((approver) => approver.canApprove());
  }

  /** Starts a request and asks every approver that can reach the owner. */
  request(account: string, label: string, options: { readonly thisComputer?: boolean } = {}): DeviceLoginRequest {
    const ready = [...this.approvers].filter(
      (approver) => approver.canApprove() && (options.thisComputer !== true || approver.servesThisComputer === true),
    );
    if (ready.length === 0)
      throw new EvaError(
        "device_login_unavailable",
        "Nothing on this machine can confirm a new device. Log in with the token instead.",
      );
    const nowMs = this.options.now().getTime();
    const recent = (this.requestTimes.get(account) ?? []).filter((time) => nowMs - time < requestWindowMs);
    this.requestTimes.set(account, recent);
    if (recent.length >= requestsPerWindow)
      throw new EvaError("rate_limited", "Too many device logins in the last 10 minutes. Try again later.");
    recent.push(nowMs);
    this.removeExpired(nowMs);
    const request: DeviceLoginRequest = {
      id: randomUUID(),
      code: newCode(),
      account,
      expiresAt: new Date(nowMs + pendingLifetimeMs).toISOString(),
      approvers: ready.map((approver) => approver.name),
    };
    this.pending.set(request.id, {
      request,
      label,
      expiresAtMs: nowMs + pendingLifetimeMs,
      asked: ready,
      answer: null,
    });
    for (const approver of ready) approver.ask(request);
    return request;
  }

  /** The owner's answer. Returns false when the request is unknown, expired, or already answered. */
  answer(id: string, answer: "allow" | "deny"): boolean {
    const nowMs = this.options.now().getTime();
    this.removeExpired(nowMs);
    const login = this.pending.get(id);
    if (login?.answer !== null) return false;
    if (answer === "deny") {
      login.answer = { state: "denied" };
      settle(login, "deny");
      return true;
    }
    const token = this.addDevice(login.label, nowMs);
    login.answer = { state: "allowed", token };
    settle(login, "allow");
    return true;
  }

  /**
   * The answer of one approver. Returns false also for a request that it was not asked, such as a
   * request from Eva's own computer, which only the terminal may answer.
   */
  answerAs(approver: DeviceLoginApprover, id: string, answer: "allow" | "deny"): boolean {
    this.removeExpired(this.options.now().getTime());
    if (this.pending.get(id)?.asked.includes(approver) !== true) return false;
    return this.answer(id, answer);
  }

  /** The requests that wait for an answer and that this approver was asked, oldest first. */
  waitingFor(approver: DeviceLoginApprover): DeviceLoginRequest[] {
    this.removeExpired(this.options.now().getTime());
    return [...this.pending.values()]
      .filter((login) => login.answer === null && login.asked.includes(approver))
      .map((login) => login.request);
  }

  /**
   * Allows the request with this exact code, for the person who types the code that the page
   * shows. Returns its label, or null. Never "the newest request": any local program can make one.
   */
  allowByCode(code: string): string | null {
    this.removeExpired(this.options.now().getTime());
    const wanted = code.trim().toUpperCase();
    const found = [...this.pending.values()].filter((login) => login.answer === null && login.request.code === wanted);
    // Two waiting requests with one code are rare; neither is allowed, so the person asks again.
    if (found.length !== 1 || found[0] === undefined) return null;
    this.answer(found[0].request.id, "allow");
    return found[0].label;
  }

  /**
   * A new login link, for the terminal, which can read the local token. The page that opens the
   * link trades its secret for a device token with `redeemLoginLink`.
   */
  createLoginLink(): LoginLink {
    const nowMs = this.options.now().getTime();
    this.removeEndedLinks(nowMs);
    // A Map keeps its order, so the first key is the oldest link.
    for (const hash of this.loginLinks.keys()) {
      if (this.loginLinks.size < loginLinksAtOnce) break;
      this.loginLinks.delete(hash);
    }
    const secret = randomBytes(32).toString("base64url");
    this.loginLinks.set(hashOf(secret), nowMs + loginLinkLifetimeMs);
    return { secret, expiresAt: new Date(nowMs + loginLinkLifetimeMs).toISOString() };
  }

  /** Trades the secret of a waiting link for a new device token, once. Returns null for any other secret. */
  redeemLoginLink(secret: string, label: string): string | null {
    const nowMs = this.options.now().getTime();
    this.removeEndedLinks(nowMs);
    const hash = hashOf(secret);
    if (secret === "" || !this.loginLinks.delete(hash)) return null;
    return this.addDevice(label, nowMs);
  }

  /** The state of a request, for the browser that made it. An issued token is handed out once. */
  check(id: string, account: string): DeviceLoginState {
    this.removeExpired(this.options.now().getTime());
    const login = this.pending.get(id);
    if (login?.request.account !== account) return { state: "expired" };
    if (login.answer === null) return { state: "pending" };
    this.pending.delete(id);
    return login.answer;
  }

  /** How many browsers may open Eva with a device login. */
  count(): number {
    return this.devices.length;
  }

  isValidToken(token: string): boolean {
    const hash = hashOf(token);
    return this.devices.some((device) => device.hash === hash);
  }

  /** Calls the listener after each removal of devices, so a front end can end their open connections. */
  onForget(listener: () => void): () => void {
    this.forgetListeners.add(listener);
    return () => {
      this.forgetListeners.delete(listener);
    };
  }

  /** Logs out one device. */
  forget(token: string): void {
    const hash = hashOf(token);
    this.devices = this.devices.filter((device) => device.hash !== hash);
    this.saveDevices();
    this.notifyForget();
  }

  /** Every device, oldest first. `currentToken` is the device token of the caller, or null. */
  list(currentToken: string | null): DeviceSummary[] {
    const currentHash = currentToken === null ? null : hashOf(currentToken);
    return this.devices.map((device) => ({
      id: idOf(device),
      label: device.label,
      createdAt: device.createdAt,
      current: device.hash === currentHash,
    }));
  }

  /** Logs out the device with this id. Returns false when no single device has it. */
  forgetById(id: string): boolean {
    const matches = this.devices.filter((device) => idOf(device) === id);
    const [match] = matches;
    if (matches.length !== 1 || match === undefined) return false;
    this.devices = this.devices.filter((device) => device !== match);
    this.saveDevices();
    this.notifyForget();
    return true;
  }

  /** Logs out every device. Returns how many there were. */
  forgetAll(): number {
    const count = this.devices.length;
    this.devices = [];
    this.saveDevices();
    this.notifyForget();
    return count;
  }

  private removeExpired(nowMs: number): void {
    for (const [id, login] of this.pending) if (login.expiresAtMs <= nowMs) this.pending.delete(id);
  }

  /** Saves a new device, and gives its token, which Eva never stores. */
  private addDevice(label: string, nowMs: number): string {
    const token = randomBytes(32).toString("base64url");
    this.devices = [...this.devices, { hash: hashOf(token), label, createdAt: new Date(nowMs).toISOString() }];
    this.saveDevices();
    return token;
  }

  private removeEndedLinks(nowMs: number): void {
    for (const [hash, endsAtMs] of this.loginLinks) if (endsAtMs <= nowMs) this.loginLinks.delete(hash);
  }

  private notifyForget(): void {
    for (const listener of this.forgetListeners) callSafely(() => listener());
  }

  private saveDevices(): void {
    writeFileAtomic(this.options.path, JSON.stringify({ devices: this.devices }, null, 2) + "\n");
  }
}

function hashOf(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function idOf(device: StoredDevice): string {
  return device.hash.slice(0, deviceIdLength);
}

function settle(login: PendingLogin, answer: "allow" | "deny"): void {
  for (const approver of login.asked) callSafely(() => approver.settled?.(login.request.id, answer));
}

/** A broken front end must not undo an answer that is already saved, or keep the others from hearing of it. */
function callSafely(work: () => void): void {
  try {
    work();
  } catch {
    // The other front ends still get the news.
  }
}

function newCode(): string {
  return [...randomBytes(codeLength)].map((byte) => codeLetters[byte % codeLetters.length]).join("");
}

/** Reads the devices tolerantly: a bad file means no devices, and a bad entry is skipped (lessons 54, 69). */
function loadDevices(path: string): StoredDevice[] {
  const read = readJsonTolerant(path);
  if (!read.ok || typeof read.value !== "object" || read.value === null) return [];
  const devices: unknown = (read.value as { devices?: unknown }).devices;
  if (!Array.isArray(devices)) return [];
  return devices.filter(isStoredDevice);
}

function isStoredDevice(value: unknown): value is StoredDevice {
  if (typeof value !== "object" || value === null) return false;
  const device = value as Record<string, unknown>;
  return (
    typeof device["hash"] === "string" && typeof device["label"] === "string" && typeof device["createdAt"] === "string"
  );
}
