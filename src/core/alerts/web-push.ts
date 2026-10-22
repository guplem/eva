/**
 * Eva's alerts as system notifications on the person's devices (Web Push), so a person without
 * Telegram learns about a problem while the web app is closed (#369).
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
});

const storeSchema = z.object({
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

/** The contact that RFC 8292 asks for. A push service writes to it about a problem with the sender. */
const vapidSubject = "https://github.com/guplem/eva";

const requestTimeoutMs = 15_000;

const fetchSender: PushSender = async (request) => {
  const response = await fetch(request.endpoint, {
    method: "POST",
    headers: request.headers,
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
      url.protocol === "https:" && pushHosts.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))
    );
  } catch {
    return false;
  }
}

export class WebPush {
  private readonly options: WebPushOptions;
  private readonly send: PushSender;

  constructor(options: WebPushOptions) {
    this.options = options;
    this.send = options.send ?? fetchSender;
  }

  /** The public key that a browser needs to subscribe, as base64url of the uncompressed point. */
  publicKey(): string {
    const jwk = this.privateKey().export({ format: "jwk" });
    const x = Buffer.from(jwk.x ?? "", "base64url");
    const y = Buffer.from(jwk.y ?? "", "base64url");
    return base64url(Buffer.concat([Buffer.from([4]), x, y]));
  }

  devices(): PushDevice[] {
    return this.read().map(({ endpoint, label, createdAt }) => ({ endpoint, label, createdAt }));
  }

  subscribe(subscription: PushSubscriptionInput, label: string): void {
    if (!isPushEndpoint(subscription.endpoint)) {
      throw new EvaError("config_invalid", "This push address is not a browser's push service.");
    }
    const others = this.read().filter((each) => each.endpoint !== subscription.endpoint);
    this.write([
      ...others,
      {
        endpoint: subscription.endpoint,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
        label,
        createdAt: this.options.now().toISOString(),
      },
    ]);
  }

  /** False when the device had no subscription. */
  unsubscribe(endpoint: string): boolean {
    const all = this.read();
    const kept = all.filter((each) => each.endpoint !== endpoint);
    if (kept.length === all.length) return false;
    this.write(kept);
    return true;
  }

  /** Wakes each device. A device whose subscription ended is forgotten. It never throws. */
  async notify(): Promise<void> {
    const subscriptions = this.read();
    if (subscriptions.length === 0) return;
    const key = this.privateKey();
    const ended = new Set<string>();
    await Promise.all(
      subscriptions.map(async (subscription) => {
        try {
          const status = await this.send({
            endpoint: subscription.endpoint,
            headers: {
              TTL: String(pushTtlSeconds),
              Urgency: "high",
              Authorization: `vapid t=${this.vapidToken(subscription.endpoint, key)}, k=${this.publicKey()}`,
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
    const parsed = read.ok ? storeSchema.safeParse(read.value) : null;
    return parsed?.success === true ? parsed.data.subscriptions : [];
  }

  private write(subscriptions: readonly StoredPushSubscription[]): void {
    writeFileAtomic(
      this.options.paths.pushSubscriptions,
      JSON.stringify({ version: pushFormatVersion, subscriptions }, null, 2) + "\n",
    );
  }
}
