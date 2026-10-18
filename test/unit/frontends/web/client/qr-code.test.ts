import { describe, expect, test } from "bun:test";
import { qrCodeShape } from "../../../../../src/frontends/web/client/qr-code.ts";

describe("qrCodeShape", () => {
  test("one path draws every dark module, inside a quiet border that scanners need", () => {
    const shape = qrCodeShape("https://server.example-tailnet.ts.net");
    // A version 3 code is 29 modules wide; the border adds 4 on each side.
    expect(shape.size).toBe(37);
    expect(shape.path).toMatch(/^(M\d+ \d+h1v1h-1z)+$/);
    // The top-left finder pattern starts right after the border.
    expect(shape.path).toStartWith("M4 4h1v1h-1z");
    expect(shape.path).not.toContain("M0 0");
  });
});
