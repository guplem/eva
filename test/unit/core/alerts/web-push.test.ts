import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createPublicKey, verify } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { notificationKinds } from "../../../../src/core/alerts/chat-notifications.ts";
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
  nowMs = Date.parse("2026-10-22T08:00:00.000Z");
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

let nowMs = Date.parse("2026-10-22T08:00:00.000Z");

function push(): WebPush {
  return new WebPush({
    paths,
    now: () => new Date(nowMs),
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
      {
        endpoint: subscription.endpoint,
        label: "Phone again",
        createdAt: "2026-10-22T08:00:00.000Z",
        kinds: [...notificationKinds],
      },
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
    await pusher.notify(pusher.recipients("alerts"));
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
    await pusher.notify(pusher.recipients("alerts"));
    expect(pusher.devices()).toEqual([]);
  });

  test("keeps a device after another failure, and never throws", async () => {
    const pusher = new WebPush({
      paths,
      now: () => new Date("2026-10-22T08:00:00.000Z"),
      send: () => Promise.reject(new Error("offline")),
    });
    pusher.subscribe(subscription, "Phone");
    await pusher.notify(pusher.recipients("alerts"));
    expect(pusher.devices()).toHaveLength(1);
  });
});

function publicJwk(raw: string): { x: string; y: string } {
  const bytes = base64url(raw);
  return { x: bytes.subarray(1, 33).toString("base64url"), y: bytes.subarray(33, 65).toString("base64url") };
}

describe("limits", () => {
  test("refuse a push host with a port, and a 21st device", () => {
    expect(() => push().subscribe({ ...subscription, endpoint: "https://fcm.googleapis.com:8443/x" }, "X")).toThrow();
    const pusher = push();
    for (let index = 0; index < 20; index += 1) {
      pusher.subscribe({ ...subscription, endpoint: `${subscription.endpoint}-${String(index)}` }, "Phone");
    }
    expect(() => pusher.subscribe({ ...subscription, endpoint: `${subscription.endpoint}-more` }, "Phone")).toThrow(
      "20 devices at most",
    );
  });

  test("a damaged secrets.json never reaches the alert path", async () => {
    const pusher = push();
    pusher.subscribe(subscription, "Phone");
    writeFileSync(paths.secrets, "{ broken");
    expect(await pusher.notify(pusher.recipients("alerts"))).toBeUndefined();
    expect(sent).toEqual([]);
  });
});

describe("kinds", () => {
  const second = { ...subscription, endpoint: "https://web.push.apple.com/second" };

  test("a device gets only the kinds that it picked, and a new subscribe keeps them", () => {
    const pusher = push();
    pusher.subscribe(subscription, "Phone");
    pusher.subscribe(second, "Laptop");
    expect(pusher.setKinds(second.endpoint, ["alerts"])).toBe(true);
    pusher.subscribe(second, "Laptop");
    expect(pusher.devices().map((device) => device.kinds)).toEqual([[...notificationKinds], ["alerts"]]);
    expect(pusher.recipients("replies")).toEqual([subscription.endpoint]);
    expect(pusher.recipients("alerts")).toEqual([subscription.endpoint, second.endpoint]);
    expect(pusher.setKinds("https://web.push.apple.com/unknown", [])).toBe(false);
  });

  test("a test goes to every device", () => {
    const pusher = push();
    pusher.subscribe(subscription, "Phone");
    pusher.setKinds(subscription.endpoint, []);
    expect(pusher.recipients("alerts")).toEqual([]);
    expect(pusher.recipients(null)).toEqual([subscription.endpoint]);
  });

  test("notify sends only to the given devices", async () => {
    const pusher = push();
    pusher.subscribe(subscription, "Phone");
    pusher.subscribe(second, "Laptop");
    await pusher.notify([second.endpoint]);
    expect(sent.map((request) => request.endpoint)).toEqual([second.endpoint]);
  });
});

describe("a page in view", () => {
  test("gets no push while its claim lasts, and the claim ends by itself", () => {
    const pusher = push();
    pusher.subscribe(subscription, "Phone");
    expect(pusher.markInView(subscription.endpoint, "tab-1", true)).toBe(true);
    expect(pusher.recipients("replies")).toEqual([]);
    expect(pusher.recipients(null)).toEqual([subscription.endpoint]);
    nowMs += 89_000;
    expect(pusher.recipients("replies")).toEqual([]);
    nowMs += 2_000;
    expect(pusher.recipients("replies")).toEqual([subscription.endpoint]);
  });

  test("that goes out of view gets pushes again, unless another tab of the device is still in view", () => {
    const pusher = push();
    pusher.subscribe(subscription, "Phone");
    pusher.markInView(subscription.endpoint, "tab-1", true);
    pusher.markInView(subscription.endpoint, "tab-2", true);
    pusher.markInView(subscription.endpoint, "tab-2", false);
    expect(pusher.recipients("replies")).toEqual([]);
    pusher.markInView(subscription.endpoint, "tab-1", false);
    expect(pusher.recipients("replies")).toEqual([subscription.endpoint]);
  });

  test("holds back only the notification of a chat that it shows", () => {
    const pusher = push();
    pusher.subscribe(subscription, "Laptop");
    pusher.markInView(subscription.endpoint, "tab-1", true, ["chat-a"]);
    expect(pusher.recipients("replies", "chat-a")).toEqual([]);
    expect(pusher.recipients("replies", "chat-b")).toEqual([subscription.endpoint]);
    // A problem alert has no chat: any page in view holds it back.
    expect(pusher.recipients("alerts")).toEqual([]);
    pusher.markInView(subscription.endpoint, "tab-1", true, ["chat-b"]);
    expect(pusher.recipients("replies", "chat-a")).toEqual([subscription.endpoint]);
    pusher.markInView(subscription.endpoint, "tab-1", true);
    expect(pusher.recipients("replies", "chat-b")).toEqual([subscription.endpoint]);
  });

  test("of an address with no subscription keeps no claim, and a removal ends the claims", () => {
    const pusher = push();
    expect(pusher.markInView(subscription.endpoint, "tab-1", true)).toBe(false);
    pusher.subscribe(subscription, "Phone");
    expect(pusher.recipients("replies")).toEqual([subscription.endpoint]);
    pusher.markInView(subscription.endpoint, "tab-1", true);
    pusher.unsubscribe(subscription.endpoint);
    pusher.subscribe(subscription, "Phone");
    expect(pusher.recipients("replies")).toEqual([subscription.endpoint]);
  });

  test("an old claim of another tab ends by itself", () => {
    const pusher = push();
    pusher.subscribe(subscription, "Phone");
    pusher.markInView(subscription.endpoint, "tab-1", true);
    nowMs += 100_000;
    pusher.markInView(subscription.endpoint, "tab-2", false);
    expect(pusher.recipients("replies")).toEqual([subscription.endpoint]);
  });
});

describe("device logins", () => {
  test("a removed device login loses its subscriptions, and a token login keeps its own", () => {
    const pusher = push();
    pusher.subscribe(subscription, "Phone", "device-1");
    pusher.subscribe({ ...subscription, endpoint: "https://web.push.apple.com/kept" }, "Laptop", "device-2");
    pusher.subscribe({ ...subscription, endpoint: "https://web.push.apple.com/token" }, "Computer", null);
    pusher.keepDevices(new Set(["device-2"]));
    expect(pusher.devices().map((device) => device.label)).toEqual(["Laptop", "Computer"]);
  });
});
