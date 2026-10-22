import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createPublicKey, verify } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebPush, type PushRequest } from "../../../../src/core/alerts/web-push.ts";
import { homePaths, loadSecrets, type HomePaths } from "../../../../src/core/settings/home.ts";
import { isEvaError } from "../../../../src/shared/errors.ts";

let root: string;
let paths: HomePaths;
let sent: PushRequest[];
let status: number;

const subscription = {
  endpoint: "https://fcm.googleapis.com/fcm/send/abc123",
  keys: { p256dh: "BPublicKeyOfTheBrowser", auth: "authSecret" },
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "eva-web-push-"));
  paths = homePaths(root);
  mkdirSync(paths.stateFolder, { recursive: true });
  sent = [];
  status = 201;
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function push(): WebPush {
  return new WebPush({
    paths,
    now: () => new Date("2026-10-22T08:00:00.000Z"),
    send: (request) => {
      sent.push(request);
      return Promise.resolve(status);
    },
  });
}

function base64url(text: string): Buffer {
  return Buffer.from(text, "base64url");
}

describe("the key", () => {
  test("is made once and kept in secrets.json", () => {
    const first = push().publicKey();
    expect(base64url(first)).toHaveLength(65);
    expect(loadSecrets(paths).webPushPrivateKey).toBeString();
    expect(push().publicKey()).toBe(first);
  });
});

describe("subscriptions", () => {
  test("are kept per device, and a second subscribe of the same endpoint replaces the first", () => {
    const pusher = push();
    pusher.subscribe(subscription, "Phone");
    pusher.subscribe(subscription, "Phone again");
    expect(pusher.devices()).toEqual([
      { endpoint: subscription.endpoint, label: "Phone again", createdAt: "2026-10-22T08:00:00.000Z" },
    ]);
    expect(JSON.parse(readFileSync(paths.pushSubscriptions, "utf-8"))).toMatchObject({ version: 1 });
    expect(pusher.unsubscribe(subscription.endpoint)).toBe(true);
    expect(pusher.unsubscribe(subscription.endpoint)).toBe(false);
    expect(pusher.devices()).toEqual([]);
  });

  test("accept only the push services of the browsers", () => {
    for (const endpoint of [
      "https://web.push.apple.com/abc",
      "https://updates.push.services.mozilla.com/wpush/v2/abc",
      "https://wns2-par02p.notify.windows.com/w/?token=abc",
    ]) {
      expect(() => push().subscribe({ ...subscription, endpoint }, "Device")).not.toThrow();
    }
    for (const endpoint of ["http://fcm.googleapis.com/x", "https://example.com/x", "https://127.0.0.1/x", "nope"]) {
      try {
        push().subscribe({ ...subscription, endpoint }, "Device");
        throw new Error("no error");
      } catch (caught) {
        expect(isEvaError(caught, "config_invalid")).toBe(true);
      }
    }
  });

  test("read a damaged file as none", () => {
    writeFileSync(paths.pushSubscriptions, "{ broken");
    expect(push().devices()).toEqual([]);
  });
});

describe("notify", () => {
  test("sends an empty push with a signed VAPID header to each device", async () => {
    const pusher = push();
    pusher.subscribe(subscription, "Phone");
    await pusher.notify();
    expect(sent).toHaveLength(1);
    const request = sent[0];
    expect(request?.endpoint).toBe(subscription.endpoint);
    expect(request?.headers["TTL"]).toBe("86400");
    expect(request?.headers["Urgency"]).toBe("high");
    const match = /^vapid t=([^,]+), k=(.+)$/.exec(request?.headers["Authorization"] ?? "");
    expect(match?.[2]).toBe(pusher.publicKey());
    const [header, claims, signature] = (match?.[1] ?? "").split(".");
    expect(JSON.parse(base64url(header ?? "").toString())).toEqual({ typ: "JWT", alg: "ES256" });
    expect(JSON.parse(base64url(claims ?? "").toString())).toEqual({
      aud: "https://fcm.googleapis.com",
      exp: Date.parse("2026-10-22T08:00:00.000Z") / 1000 + 12 * 3600,
      sub: "https://github.com/guplem/eva",
    });
    const key = createPublicKey({
      key: { kty: "EC", crv: "P-256", ...publicJwk(pusher.publicKey()) },
      format: "jwk",
    });
    const signed = verify(
      "sha256",
      Buffer.from(`${header ?? ""}.${claims ?? ""}`),
      { key, dsaEncoding: "ieee-p1363" },
      base64url(signature ?? ""),
    );
    expect(signed).toBe(true);
  });

  test("forgets a device whose subscription ended", async () => {
    const pusher = push();
    pusher.subscribe(subscription, "Phone");
    status = 410;
    await pusher.notify();
    expect(pusher.devices()).toEqual([]);
  });

  test("keeps a device after another failure, and never throws", async () => {
    const pusher = new WebPush({
      paths,
      now: () => new Date("2026-10-22T08:00:00.000Z"),
      send: () => Promise.reject(new Error("offline")),
    });
    pusher.subscribe(subscription, "Phone");
    await pusher.notify();
    expect(pusher.devices()).toHaveLength(1);
  });
});

function publicJwk(raw: string): { x: string; y: string } {
  const bytes = base64url(raw);
  return { x: bytes.subarray(1, 33).toString("base64url"), y: bytes.subarray(33, 65).toString("base64url") };
}
