/**
 * Device login for the web UI. A browser that comes through an allowed
 * Tailscale account asks to log in, the owner allows it in Telegram, and the browser gets a
 * device token. Eva stores only the SHA-256 hash of each token, in `state/devices.json`.
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
}

export type DeviceLoginState =
  | { readonly state: "pending" }
  | { readonly state: "allowed"; readonly token: string }
  | { readonly state: "denied" }
  /** Also the answer for an unknown request, or a request of another account. */
  | { readonly state: "expired" };

/** A front end that asks the owner, such as the Telegram bot. */
export interface DeviceLoginApprover {
  /** False while the approver cannot reach the owner, such as a bot with no paired chat. */
  canApprove(): boolean;
  ask(request: DeviceLoginRequest): void;
  /** Another approver, or this one, answered a request that this approver was asked. */
  settled?(id: string, answer: "allow" | "deny"): void;
}

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

interface StoredDevice {
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

export class DeviceLogins {
  private readonly options: DeviceLoginsOptions;
  private readonly pending: Map<string, PendingLogin>;
  private readonly approvers: Set<DeviceLoginApprover>;
  private requestTimes: number[];
  private devices: StoredDevice[];

  constructor(options: DeviceLoginsOptions) {
    this.options = options;
    this.pending = new Map();
    this.approvers = new Set();
    this.requestTimes = [];
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
  request(account: string, label: string): DeviceLoginRequest {
    const ready = [...this.approvers].filter((approver) => approver.canApprove());
    if (ready.length === 0)
      throw new EvaError(
        "device_login_unavailable",
        "This machine runs no Telegram bot that can confirm a new device. Log in with the token instead.",
      );
    const nowMs = this.options.now().getTime();
    this.requestTimes = this.requestTimes.filter((time) => nowMs - time < requestWindowMs);
    if (this.requestTimes.length >= requestsPerWindow)
      throw new EvaError("rate_limited", "Too many device logins in the last 10 minutes. Try again later.");
    this.requestTimes.push(nowMs);
    this.removeExpired(nowMs);
    const request: DeviceLoginRequest = {
      id: randomUUID(),
      code: newCode(),
      account,
      expiresAt: new Date(nowMs + pendingLifetimeMs).toISOString(),
    };
    this.pending.set(request.id, { request, label, expiresAtMs: nowMs + pendingLifetimeMs, asked: ready, answer: null });
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
    const token = randomBytes(32).toString("base64url");
    this.devices = [
      ...this.devices,
      { hash: hashOf(token), label: login.label, createdAt: new Date(nowMs).toISOString() },
    ];
    this.saveDevices();
    login.answer = { state: "allowed", token };
    settle(login, "allow");
    return true;
  }

  /** The requests that wait for an answer and that this approver was asked, oldest first. */
  waitingFor(approver: DeviceLoginApprover): DeviceLoginRequest[] {
    this.removeExpired(this.options.now().getTime());
    return [...this.pending.values()]
      .filter((login) => login.answer === null && login.asked.includes(approver))
      .map((login) => login.request);
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

  isValidToken(token: string): boolean {
    const hash = hashOf(token);
    return this.devices.some((device) => device.hash === hash);
  }

  /** Logs out one device. */
  forget(token: string): void {
    const hash = hashOf(token);
    this.devices = this.devices.filter((device) => device.hash !== hash);
    this.saveDevices();
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
    return true;
  }

  /** Logs out every device. Returns how many there were. */
  forgetAll(): number {
    const count = this.devices.length;
    this.devices = [];
    this.saveDevices();
    return count;
  }

  private removeExpired(nowMs: number): void {
    for (const [id, login] of this.pending) if (login.expiresAtMs <= nowMs) this.pending.delete(id);
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
  for (const approver of login.asked) approver.settled?.(login.request.id, answer);
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
