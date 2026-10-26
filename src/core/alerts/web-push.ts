/**
 * Eva's alerts as system notifications on the person's devices (Web Push), so a person without
 * Telegram learns about a problem while the web app is closed (#369). The chats use it too: a
 * finished turn, a schedule's turn and an approval that waits (#360).
 *
 * Each push is empty: it only wakes the web app's service worker, which reads the newest alert
 * from this Eva and shows it. An empty push needs no payload encryption, only the VAPID signature
 * (RFC 8292), which tells the push service that this Eva sent it.
 */
import { createPrivateKey, generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { z } from "zod";
import { EvaError } from "../../shared/errors.ts";
import { readJsonTolerant, writeFileAtomic } from "../../shared/files.ts";
import type { Logger } from "../../shared/logger.ts";
import { loadSecrets, saveSecrets, type HomePaths } from "../settings/home.ts";
import { notificationKinds, type NotificationKind } from "./chat-notifications.ts";

/** One push to one device. */
export interface PushRequest {
  readonly endpoint: string;
  readonly headers: Readonly<Record<string, string>>;
}

/** Sends a push and gives the HTTP status. A test passes its own. */
export type PushSender = (request: PushRequest) => Promise<number>;

/** The subscription that a browser's push manager gives. Eva keeps the keys for a later payload. */
export interface PushSubscriptionInput {
  readonly endpoint: string;
  readonly keys: { readonly p256dh: string; readonly auth: string };
}

export interface PushDevice {
  readonly endpoint: string;
  /** The device's name, as the device list shows it. */
  readonly label: string;
  readonly createdAt: string;
  readonly kinds: readonly NotificationKind[];
}

export interface WebPushOptions {
  readonly paths: HomePaths;
  readonly now: () => Date;
  readonly send?: PushSender;
  readonly logger?: Logger;
}

export const pushFormatVersion = 1;

const storedSubscriptionSchema = z.object({
  endpoint: z.string(),
  p256dh: z.string(),
  auth: z.string(),
  label: z.string(),
  createdAt: z.string(),
  /** The kinds that this device gets. A subscription from before #360 has none, and gets every kind. */
  kinds: z.array(z.enum(notificationKinds)).optional(),
  /** The device login that made the subscription, so its removal ends the subscription too. */
  deviceId: z.string().optional(),
});

/** Exported for the stored-name check, which lists its fields and the values of `kinds`. */
export const pushStoreSchema = z.object({
  version: z.literal(pushFormatVersion),
  subscriptions: z.array(storedSubscriptionSchema),
});

export type StoredPushSubscription = z.infer<typeof storedSubscriptionSchema>;

/**
 * The push services of the browsers. Eva sends a request only to these hosts, so a page can never
 * make Eva call another address.
 */
const pushHosts = ["fcm.googleapis.com", "push.apple.com", "push.services.mozilla.com", "notify.windows.com"] as const;

/** A push waits for the device this long, in seconds, then the push service drops it. */
const pushTtlSeconds = 86_400;

/**
 * The contact that RFC 8292 asks for. A push service writes to it about a problem with the sender.
 * Each instance names the project on purpose: an instance has no public address of its own.
 */
const vapidSubject = "https://github.com/guplem/eva";

const requestTimeoutMs = 15_000;

/** Each alert costs one request for each device, so the list stays short. */
const maxDevices = 20;

/**
 * How long a page's claim that it is in view lasts. The page renews it each minute. A phone that
 * sleeps cannot say that its page went out of view, so the claim must end by itself.
 */
const inViewMs = 90_000;

interface PageClaim {
  readonly until: number;
  readonly chats: ReadonlySet<string>;
}

const fetchSender: PushSender = async (request) => {
  const response = await fetch(request.endpoint, {
    method: "POST",
    headers: request.headers,
    // A redirect could lead to a host outside the push services, so Eva never follows one.
    redirect: "manual",
    signal: AbortSignal.timeout(requestTimeoutMs),
  });
  return response.status;
};

function base64url(data: Buffer | string): string {
  return Buffer.from(data).toString("base64url");
}

function isPushEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    return (
      url.protocol === "https:" &&
      url.port === "" &&
      pushHosts.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))
    );
  } catch {
    return false;
  }
}

export class WebPush {
  private readonly options: WebPushOptions;
  private readonly send: PushSender;
  /**
   * Each page's claim that it is in view, by push address and then by page: when it ends, and the
   * chats that the page shows. The tabs of one browser share one push address, so one tab that
   * goes out of view must not end the claim of another. It lives in memory only.
   */
  private readonly inViewUntil: Map<string, Map<string, PageClaim>>;

  constructor(options: WebPushOptions) {
    this.options = options;
    this.send = options.send ?? fetchSender;
    this.inViewUntil = new Map();
  }

  /** The public key that a browser needs to subscribe, as base64url of the uncompressed point. */
  publicKey(): string {
    return this.publicKeyOf(this.privateKey());
  }

  private publicKeyOf(key: KeyObject): string {
    const jwk = key.export({ format: "jwk" });
    const x = Buffer.from(jwk.x ?? "", "base64url");
    const y = Buffer.from(jwk.y ?? "", "base64url");
    return base64url(Buffer.concat([Buffer.from([4]), x, y]));
  }

  devices(): PushDevice[] {
    return this.read().map(({ endpoint, label, createdAt, kinds }) => ({
      endpoint,
      label,
      createdAt,
      kinds: kinds ?? notificationKinds,
    }));
  }

  /** `deviceId` is the device login of the caller, or null for a login with the token. */
  subscribe(subscription: PushSubscriptionInput, label: string, deviceId: string | null = null): void {
    if (!isPushEndpoint(subscription.endpoint)) {
      throw new EvaError("config_invalid", "This push address is not a browser's push service.");
    }
    const all = this.read();
    // The page sends its subscription again on each visit, so the kinds that the person picked stay.
    const kinds = all.find((each) => each.endpoint === subscription.endpoint)?.kinds;
    const others = all.filter((each) => each.endpoint !== subscription.endpoint);
    if (others.length >= maxDevices) {
      throw new EvaError(
        "config_invalid",
        `Eva sends notifications to ${String(maxDevices)} devices at most. Turn them off on a device first.`,
      );
    }
    this.write([
      ...others,
      {
        endpoint: subscription.endpoint,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
        label,
        createdAt: this.options.now().toISOString(),
        ...(kinds === undefined ? {} : { kinds }),
        ...(deviceId === null ? {} : { deviceId }),
      },
    ]);
  }

  /** False when the device has no subscription. */
  setKinds(endpoint: string, kinds: readonly NotificationKind[]): boolean {
    const all = this.read();
    if (!all.some((each) => each.endpoint === endpoint)) return false;
    const picked = notificationKinds.filter((kind) => kinds.includes(kind));
    this.write(all.map((each) => (each.endpoint === endpoint ? { ...each, kinds: picked } : each)));
    return true;
  }

  /**
   * A page of a device says that it is in view, with the chats that it shows, or that it went out
   * of view. False for an address with no subscription: Eva keeps no claim for it, so a page
   * cannot fill her memory.
   */
  markInView(endpoint: string, pageId: string, inView: boolean, chats: readonly string[] = []): boolean {
    if (!this.read().some((each) => each.endpoint === endpoint)) return false;
    const pages = this.inViewUntil.get(endpoint) ?? new Map<string, PageClaim>();
    const now = this.options.now().getTime();
    for (const [page, claim] of pages) if (claim.until <= now) pages.delete(page);
    if (inView) pages.set(pageId, { until: now + inViewMs, chats: new Set(chats) });
    else pages.delete(pageId);
    if (pages.size === 0) this.inViewUntil.delete(endpoint);
    else this.inViewUntil.set(endpoint, pages);
    return true;
  }

  /**
   * With a chat, only a page that shows that chat counts: the person who reads another chat still
   * wants to know that this one has an answer (#614).
   */
  private isInView(endpoint: string, now: number, sessionId: string | null): boolean {
    return [...(this.inViewUntil.get(endpoint)?.values() ?? [])].some(
      (claim) => claim.until > now && (sessionId === null || claim.chats.has(sessionId)),
    );
  }

  /** Ends the subscriptions of each device login that is gone. A subscription with no device login stays. */
  keepDevices(deviceIds: ReadonlySet<string>): void {
    const all = this.read();
    const kept = all.filter((each) => each.deviceId === undefined || deviceIds.has(each.deviceId));
    if (kept.length !== all.length) this.write(kept);
  }

  /**
   * The devices that get a push of this kind: each one that picked it, and whose page is not in view.
   * A chat's push skips only a device whose page in view shows that chat.
   * A test (null) goes to every device, also one in view: the person pressed its button there.
   */
  recipients(kind: NotificationKind | null, sessionId: string | null = null): string[] {
    if (kind === null) return this.read().map((each) => each.endpoint);
    const now = this.options.now().getTime();
    return this.read()
      .filter((each) => (each.kinds ?? notificationKinds).includes(kind))
      .filter((each) => !this.isInView(each.endpoint, now, sessionId))
      .map((each) => each.endpoint);
  }

  /** False when the device had no subscription. */
  unsubscribe(endpoint: string): boolean {
    const all = this.read();
    const kept = all.filter((each) => each.endpoint !== endpoint);
    if (kept.length === all.length) return false;
    this.write(kept);
    return true;
  }

  /** Wakes each device of the list. A device whose subscription ended is forgotten. It never throws. */
  async notify(endpoints: readonly string[]): Promise<void> {
    if (endpoints.length === 0) return;
    try {
      await this.notifyAll(new Set(endpoints));
    } catch (error) {
      // A damaged secrets.json must not reach the alert path.
      this.options.logger?.log("warn", "The pushes failed.", {
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async notifyAll(endpoints: ReadonlySet<string>): Promise<void> {
    const subscriptions = this.read().filter((each) => endpoints.has(each.endpoint));
    if (subscriptions.length === 0) return;
    const key = this.privateKey();
    const publicKey = this.publicKeyOf(key);
    const ended = new Set<string>();
    await Promise.all(
      subscriptions.map(async (subscription) => {
        try {
          const status = await this.send({
            endpoint: subscription.endpoint,
            headers: {
              TTL: String(pushTtlSeconds),
              Urgency: "high",
              Authorization: `vapid t=${this.vapidToken(subscription.endpoint, key)}, k=${publicKey}`,
              "Content-Length": "0",
            },
          });
          // 404 and 410 mean that the browser ended the subscription.
          if (status === 404 || status === 410) ended.add(subscription.endpoint);
          else if (status >= 400) this.options.logger?.log("warn", "A push failed.", { status });
        } catch (error) {
          this.options.logger?.log("warn", "A push failed.", {
            reason: error instanceof Error ? error.message : String(error),
          });
        }
      }),
    );
    // Read again: a device may subscribe while the pushes wait.
    if (ended.size > 0) this.write(this.read().filter((each) => !ended.has(each.endpoint)));
  }

  /** The VAPID token: a JWT for the push service's origin, signed with ES256. */
  private vapidToken(endpoint: string, key: KeyObject): string {
    const header = base64url(JSON.stringify({ typ: "JWT", alg: "ES256" }));
    const claims = base64url(
      JSON.stringify({
        aud: new URL(endpoint).origin,
        // RFC 8292 allows at most 24 hours.
        exp: Math.floor(this.options.now().getTime() / 1000) + 12 * 3600,
        sub: vapidSubject,
      }),
    );
    const signature = sign("sha256", Buffer.from(`${header}.${claims}`), { key, dsaEncoding: "ieee-p1363" });
    return `${header}.${claims}.${base64url(signature)}`;
  }

  /** The VAPID key, made on first use and kept with the other secrets. */
  private privateKey(): KeyObject {
    const secrets = loadSecrets(this.options.paths);
    if (secrets.webPushPrivateKey !== undefined) {
      return createPrivateKey({ key: Buffer.from(secrets.webPushPrivateKey, "base64"), format: "der", type: "pkcs8" });
    }
    const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const der = privateKey.export({ format: "der", type: "pkcs8" });
    saveSecrets(this.options.paths, { ...secrets, webPushPrivateKey: der.toString("base64") });
    return privateKey;
  }

  private read(): StoredPushSubscription[] {
    const read = readJsonTolerant(this.options.paths.pushSubscriptions);
    const parsed = read.ok ? pushStoreSchema.safeParse(read.value) : null;
    return parsed?.success === true ? parsed.data.subscriptions : [];
  }

  private write(subscriptions: readonly StoredPushSubscription[]): void {
    writeFileAtomic(
      this.options.paths.pushSubscriptions,
      JSON.stringify({ version: pushFormatVersion, subscriptions }, null, 2) + "\n",
    );
    // A device that subscribes again later starts with no claim of its old pages.
    const kept = new Set(subscriptions.map((each) => each.endpoint));
    for (const endpoint of this.inViewUntil.keys()) if (!kept.has(endpoint)) this.inViewUntil.delete(endpoint);
  }
}
