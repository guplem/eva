import { describe, expect, test } from "bun:test";
import {
  contractColours,
  frameAddress,
  frameRefreshMs,
  framePolicy,
  noticeReconnect,
  onReconnect,
  pageScheme,
  refreshDue,
} from "../../../../../src/frontends/web/client/widget-frames.ts";

describe("the grid's tokens", () => {
  test("send the person's mode, or else the system's", () => {
    expect(pageScheme("dark", false)).toBe("dark");
    expect(pageScheme("light", true)).toBe("light");
    expect(pageScheme(null, true)).toBe("dark");
    expect(pageScheme(null, false)).toBe("light");
  });

  test("send the contract colours that the page has", () => {
    const page: Record<string, string> = { "--bg": " oklch(0.97 0.008 245) ", "--ink": "#111111", "--h": "245" };
    expect(contractColours((name) => page[name] ?? "")).toEqual({
      "--bg": "oklch(0.97 0.008 245)",
      "--ink": "#111111",
    });
  });

  test("give the size in the address, and ask again each minute, so an installed update shows soon", () => {
    expect(frameRefreshMs).toBe(60_000);
    expect(frameAddress("/widgets/abc/index.html", "full")).toBe("/widgets/abc/index.html?size=full");
    expect(refreshDue(null, 0)).toBe(true);
    expect(refreshDue(1_000, 1_000 + frameRefreshMs - 1)).toBe(false);
    expect(refreshDue(1_000, 1_000 + frameRefreshMs)).toBe(true);
  });

  test("narrow the page's frames to the widget paths", () => {
    expect(framePolicy("http://127.0.0.1:7420")).toBe("frame-src http://127.0.0.1:7420/widgets/");
  });

  test("tell each grid of a reconnect, until it stops listening", () => {
    let heard = 0;
    const stop = onReconnect(() => {
      heard += 1;
    });
    noticeReconnect();
    stop();
    noticeReconnect();
    expect(heard).toBe(1);
  });
});
