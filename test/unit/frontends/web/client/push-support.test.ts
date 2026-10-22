import { describe, expect, test } from "bun:test";
import { keyBytes, pushSupport, type PushEnvironment } from "../../../../../src/frontends/web/client/push-support.ts";

const chrome: PushEnvironment = {
  userAgent: "Mozilla/5.0 (Linux; Android 15) Chrome/140.0",
  standalone: false,
  secure: true,
  hasPush: true,
  permission: "default",
};

describe("pushSupport", () => {
  test("is ready in a browser with push on HTTPS", () => {
    expect(pushSupport(chrome)).toBe("ready");
    expect(pushSupport({ ...chrome, permission: "granted" })).toBe("ready");
  });

  test("asks an iPhone to install the app first", () => {
    const iphone = { ...chrome, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) Safari/604.1", hasPush: false };
    expect(pushSupport(iphone)).toBe("needs-install");
    expect(pushSupport({ ...iphone, standalone: true, hasPush: true })).toBe("ready");
  });

  test("names a refusal, and a browser or a page with no push", () => {
    expect(pushSupport({ ...chrome, permission: "denied" })).toBe("blocked");
    expect(pushSupport({ ...chrome, secure: false })).toBe("unsupported");
    expect(pushSupport({ ...chrome, hasPush: false })).toBe("unsupported");
    expect(pushSupport({ ...chrome, permission: null })).toBe("unsupported");
  });
});

describe("keyBytes", () => {
  test("decodes base64url with no padding", () => {
    expect([...keyBytes("BAEC_-8")]).toEqual([4, 1, 2, 255, 239]);
  });
});
