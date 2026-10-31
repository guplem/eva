import { describe, expect, test } from "bun:test";
import { checkHost } from "../../../../src/core/widgets/widget-hosts.ts";

const own = ["eva-box.example-tailnet.ts.net", "127.0.0.1", "localhost", "eva.example.com"];

describe("checkHost", () => {
  test("takes a public https host, with or without a port", () => {
    expect(checkHost("https://api.open-meteo.com", own)).toEqual({ ok: true, origin: "https://api.open-meteo.com" });
    expect(checkHost("https://API.example.org:8443", own)).toEqual({
      ok: true,
      origin: "https://api.example.org:8443",
    });
    expect(checkHost("https://[2001:db8::1]", own)).toEqual({ ok: true, origin: "https://[2001:db8::1]" });
    expect(checkHost("https://93.184.216.34", own).ok).toBe(true);
  });

  test("refuses another scheme, a path, a query and a login", () => {
    for (const url of [
      "http://api.example.com",
      "https://api.example.com/v1",
      "https://api.example.com?x=1",
      "https://api.example.com#x",
      "https://user@api.example.com",
      "wss://api.example.com",
      "not an address",
    ]) {
      expect(checkHost(url, own).ok).toBe(false);
    }
  });

  test("refuses Eva herself, this computer, the network and the tailnet", () => {
    for (const url of [
      "https://eva.example.com",
      "https://EVA.example.com.",
      "https://localhost",
      "https://app.localhost",
      "https://router",
      "https://printer.local",
      "https://nas.home.arpa",
      "https://db.internal",
      "https://other-box.example-tailnet.ts.net",
      "https://127.0.0.1",
      "https://0x7f.1",
      "https://2130706433",
      "https://0.0.0.0",
      "https://10.1.2.3",
      "https://172.16.0.1",
      "https://172.31.255.255",
      "https://192.168.1.1",
      "https://169.254.169.254",
      "https://100.64.0.1",
      "https://100.127.255.255",
      "https://198.18.0.1",
      "https://224.0.0.1",
      "https://[::1]",
      "https://[::]",
      "https://[fd7a:115c:a1e0::1]",
      "https://[fe80::1]",
      "https://[::ffff:127.0.0.1]",
    ]) {
      expect({ url, ok: checkHost(url, own).ok }).toEqual({ url, ok: false });
    }
    expect(checkHost("https://172.32.0.1", own).ok).toBe(true);
    expect(checkHost("https://100.128.0.1", own).ok).toBe(true);
  });
});
