import { describe, expect, test } from "bun:test";
import { loginLinkOf, logInWithLink } from "../../../../../src/frontends/web/client/login-link.ts";

describe("loginLinkOf", () => {
  test("reads the secret of `eva open`, and the page to open after the login (#407)", () => {
    expect(loginLinkOf("#login=Ab_c-12")).toEqual({ secret: "Ab_c-12", address: "/" });
    expect(loginLinkOf("#login=Ab_c-12/settings/setup")).toEqual({ secret: "Ab_c-12", address: "/#/settings/setup" });
  });

  test("any other address is no login link", () => {
    expect(loginLinkOf("")).toBeNull();
    expect(loginLinkOf("#/settings/setup")).toBeNull();
    expect(loginLinkOf("#login=")).toBeNull();
    expect(loginLinkOf("#login=a b")).toBeNull();
  });
});

describe("logInWithLink", () => {
  test("a browser that is not logged in trades the secret for its login", async () => {
    const used: string[] = [];
    const notice = await logInWithLink("secret", {
      isLoggedIn: () => Promise.resolve(false),
      redeem: (secret) => {
        used.push(secret);
        return Promise.resolve();
      },
    });
    expect(notice).toBeNull();
    expect(used).toEqual(["secret"]);
  });

  test("a browser that is logged in already keeps its login, so the devices list gets no copy", async () => {
    const used: string[] = [];
    await logInWithLink("secret", {
      isLoggedIn: () => Promise.resolve(true),
      redeem: (secret) => {
        used.push(secret);
        return Promise.resolve();
      },
    });
    expect(used).toEqual([]);
  });

  test("a used or old link gives the reason, for the login page", async () => {
    const notice = await logInWithLink("secret", {
      isLoggedIn: () => Promise.resolve(false),
      redeem: () => Promise.reject(new Error("This login link was used, or it expired.")),
    });
    expect(notice).toBe("This login link was used, or it expired.");
  });
});
