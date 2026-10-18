import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DeviceLogins,
  type DeviceLoginApprover,
  type DeviceLoginRequest,
} from "../../../../src/core/remote-access/device-logins.ts";
import { isEvaError } from "../../../../src/shared/errors.ts";

let folder: string;
let path: string;
let clock: Date;
let asked: DeviceLoginRequest[];
let canApprove: boolean;

function createLogins(): DeviceLogins {
  return new DeviceLogins({ path, now: () => clock });
}

function attachApprover(logins: DeviceLogins): () => void {
  const approver: DeviceLoginApprover = {
    canApprove: () => canApprove,
    ask: (request) => asked.push(request),
  };
  return logins.attachApprover(approver);
}

function thrownBy(work: () => unknown): unknown {
  try {
    work();
  } catch (error) {
    return error;
  }
  return null;
}

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), "eva-devices-"));
  path = join(folder, "state", "devices.json");
  clock = new Date("2026-10-17T10:00:00Z");
  asked = [];
  canApprove = true;
});
afterEach(() => {
  rmSync(folder, { recursive: true, force: true });
});

describe("DeviceLogins", () => {
  test("a request gets a short code and asks the approver, with the account", () => {
    const logins = createLogins();
    attachApprover(logins);
    const request = logins.request("owner@example.com", "owner@example.com, a phone");
    expect(request.code).toMatch(/^[A-Z2-9]{4}$/);
    expect(request.account).toBe("owner@example.com");
    expect(request.expiresAt).toBe("2026-10-17T10:05:00.000Z");
    expect(asked).toEqual([request]);
    expect(logins.check(request.id, "owner@example.com")).toEqual({ state: "pending" });
  });

  test("with no approver, or one that cannot ask anyone, a request is refused", () => {
    const logins = createLogins();
    expect(logins.canApprove()).toBe(false);
    expect(
      isEvaError(
        thrownBy(() => logins.request("owner@example.com", "x")),
        "device_login_unavailable",
      ),
    ).toBe(true);
    const detach = attachApprover(logins);
    canApprove = false;
    expect(logins.canApprove()).toBe(false);
    canApprove = true;
    expect(logins.canApprove()).toBe(true);
    detach();
    expect(logins.canApprove()).toBe(false);
  });

  test("allow issues a device token once, and stores only its SHA-256 hash with a label and the time", () => {
    const logins = createLogins();
    attachApprover(logins);
    const request = logins.request("owner@example.com", "owner@example.com, a phone");
    expect(logins.answer(request.id, "allow")).toBe(true);
    const found = logins.check(request.id, "owner@example.com");
    if (found.state !== "allowed") throw new Error("the request was not allowed");
    expect(found.token.length).toBeGreaterThanOrEqual(32);
    expect(logins.check(request.id, "owner@example.com")).toEqual({ state: "expired" });
    const stored = readFileSync(path, "utf-8");
    expect(stored).not.toContain(found.token);
    expect(JSON.parse(stored)).toEqual({
      devices: [
        {
          hash: createHash("sha256").update(found.token).digest("hex"),
          label: "owner@example.com, a phone",
          createdAt: "2026-10-17T10:00:00.000Z",
        },
      ],
    });
    expect(logins.isValidToken(found.token)).toBe(true);
    expect(createLogins().isValidToken(found.token)).toBe(true);
    expect(logins.isValidToken("not-a-device-token")).toBe(false);
  });

  test("deny ends the request with no token", () => {
    const logins = createLogins();
    attachApprover(logins);
    const request = logins.request("owner@example.com", "x");
    expect(logins.answer(request.id, "deny")).toBe(true);
    expect(logins.check(request.id, "owner@example.com")).toEqual({ state: "denied" });
    expect(logins.answer(request.id, "allow")).toBe(false);
  });

  test("another account cannot collect the token of a request", () => {
    const logins = createLogins();
    attachApprover(logins);
    const request = logins.request("owner@example.com", "x");
    logins.answer(request.id, "allow");
    expect(logins.check(request.id, "stranger@example.com")).toEqual({ state: "expired" });
    expect(logins.check(request.id, "owner@example.com").state).toBe("allowed");
  });

  test("a request expires after 5 minutes, and an answer after that has no effect", () => {
    const logins = createLogins();
    attachApprover(logins);
    const request = logins.request("owner@example.com", "x");
    clock = new Date("2026-10-17T10:05:01Z");
    expect(logins.answer(request.id, "allow")).toBe(false);
    expect(logins.check(request.id, "owner@example.com")).toEqual({ state: "expired" });
    expect(logins.answer("unknown", "allow")).toBe(false);
  });

  test("at most 5 requests in 10 minutes", () => {
    const logins = createLogins();
    attachApprover(logins);
    for (let count = 0; count < 5; count += 1) logins.request("owner@example.com", "x");
    expect(
      isEvaError(
        thrownBy(() => logins.request("owner@example.com", "x")),
        "rate_limited",
      ),
    ).toBe(true);
    expect(asked).toHaveLength(5);
    clock = new Date("2026-10-17T10:10:01Z");
    expect(logins.request("owner@example.com", "x").account).toBe("owner@example.com");
  });

  test("forget removes one device, and forgetAll removes every device", () => {
    const logins = createLogins();
    attachApprover(logins);
    const tokens = [0, 1].map(() => {
      const request = logins.request("owner@example.com", "x");
      logins.answer(request.id, "allow");
      const found = logins.check(request.id, "owner@example.com");
      return found.state === "allowed" ? found.token : "";
    });
    logins.forget(tokens[0] ?? "");
    expect(logins.isValidToken(tokens[0] ?? "")).toBe(false);
    expect(logins.isValidToken(tokens[1] ?? "")).toBe(true);
    expect(logins.forgetAll()).toBe(1);
    expect(logins.isValidToken(tokens[1] ?? "")).toBe(false);
    expect(createLogins().isValidToken(tokens[1] ?? "")).toBe(false);
  });

  test("a broken devices file never stops Eva, and a bad entry is skipped (lesson 54)", () => {
    const logins = createLogins();
    attachApprover(logins);
    const request = logins.request("owner@example.com", "x");
    logins.answer(request.id, "allow");
    const found = logins.check(request.id, "owner@example.com");
    const token = found.state === "allowed" ? found.token : "";
    const stored = JSON.parse(readFileSync(path, "utf-8")) as { devices: unknown[] };
    writeFileSync(path, JSON.stringify({ devices: [42, { hash: 1 }, ...stored.devices] }));
    expect(createLogins().isValidToken(token)).toBe(true);
    writeFileSync(path, "{ not json");
    expect(createLogins().isValidToken(token)).toBe(false);
  });
});

describe("DeviceLogins for the web page", () => {
  function pageApprover(
    logins: DeviceLogins,
    settled: [string, string][],
    open = { value: true },
  ): DeviceLoginApprover {
    const approver: DeviceLoginApprover = {
      canApprove: () => open.value,
      ask: (request) => asked.push(request),
      settled: (id, answer) => settled.push([id, answer]),
    };
    logins.attachApprover(approver);
    return approver;
  }

  function allowedToken(logins: DeviceLogins, label: string): string {
    const request = logins.request("owner@example.com", label);
    logins.answer(request.id, "allow");
    const found = logins.check(request.id, "owner@example.com");
    return found.state === "allowed" ? found.token : "";
  }

  test("an approver sees only the requests that wait and that it was asked", () => {
    const logins = createLogins();
    const open = { value: false };
    const page = pageApprover(logins, [], open);
    attachApprover(logins);
    const unseen = logins.request("owner@example.com", "x");
    open.value = true;
    const first = logins.request("owner@example.com", "x");
    const second = logins.request("owner@example.com", "x");
    expect(logins.waitingFor(page)).toEqual([first, second]);
    logins.answer(first.id, "deny");
    expect(logins.waitingFor(page)).toEqual([second]);
    clock = new Date("2026-10-17T10:05:01Z");
    expect(logins.waitingFor(page)).toEqual([]);
    expect(unseen.id).not.toBe(first.id);
  });

  test("an answer tells every approver that was asked, and only those", () => {
    const logins = createLogins();
    const pageSettled: [string, string][] = [];
    const closedSettled: [string, string][] = [];
    pageApprover(logins, pageSettled);
    pageApprover(logins, closedSettled, { value: false });
    const request = logins.request("owner@example.com", "x");
    logins.answer(request.id, "allow");
    expect(pageSettled).toEqual([[request.id, "allow"]]);
    expect(closedSettled).toEqual([]);
    expect(logins.answer(request.id, "deny")).toBe(false);
    expect(pageSettled).toEqual([[request.id, "allow"]]);
  });

  test("the list shows each device with a short id, its label and date, and marks the caller's device", () => {
    const logins = createLogins();
    attachApprover(logins);
    const phone = allowedToken(logins, "owner@example.com, a phone");
    clock = new Date("2026-10-17T11:00:00Z");
    allowedToken(logins, "owner@example.com, a laptop");
    const listed = logins.list(phone);
    expect(listed.map(({ label, createdAt, current }) => ({ label, createdAt, current }))).toEqual([
      { label: "owner@example.com, a phone", createdAt: "2026-10-17T10:00:00.000Z", current: true },
      { label: "owner@example.com, a laptop", createdAt: "2026-10-17T11:00:00.000Z", current: false },
    ]);
    expect(listed[0]?.id).toBe(createHash("sha256").update(phone).digest("hex").slice(0, 16));
    expect(JSON.stringify(listed)).not.toContain(createHash("sha256").update(phone).digest("hex"));
    expect(logins.list(null).every((device) => !device.current)).toBe(true);
  });

  test("forgetById logs out only that device, and an unknown id changes nothing", () => {
    const logins = createLogins();
    attachApprover(logins);
    const phone = allowedToken(logins, "a phone");
    const laptop = allowedToken(logins, "a laptop");
    const phoneId = logins.list(null)[0]?.id ?? "";
    expect(logins.forgetById("0000000000000000")).toBe(false);
    expect(logins.forgetById("")).toBe(false);
    expect(logins.forgetById(phoneId)).toBe(true);
    expect(logins.isValidToken(phone)).toBe(false);
    expect(logins.isValidToken(laptop)).toBe(true);
    expect(
      createLogins()
        .list(null)
        .map((device) => device.label),
    ).toEqual(["a laptop"]);
  });
});
