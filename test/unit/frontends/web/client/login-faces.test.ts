import { describe, expect, test } from "bun:test";
import { loginFace } from "../../../../../src/frontends/web/client/login-faces.ts";

describe("loginFace", () => {
  test("a denied request looks sad, and an expired one skeptical", () => {
    expect(loginFace("denied")).toBe("sad");
    expect(loginFace("expired")).toBe("skeptical");
  });

  test("the token form with no failed request looks neutral", () => {
    expect(loginFace("token")).toBe("neutral");
  });

  test("the page searches while it asks for a code", () => {
    expect(loginFace("asking")).toBe("searching");
  });
});
