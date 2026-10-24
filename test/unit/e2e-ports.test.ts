import { describe, expect, test } from "bun:test";
import { e2ePorts, resolveAutoPorts } from "../e2e/e2e-ports.ts";

describe("e2ePorts", () => {
  test("keeps today's ports with no variable", () => {
    expect(e2ePorts({})).toEqual({ demo: 7499, gallery: 7498 });
  });

  test("reads each port from its variable", () => {
    expect(e2ePorts({ EVA_E2E_PORT: "8100", EVA_E2E_GALLERY_PORT: "8101" })).toEqual({ demo: 8100, gallery: 8101 });
  });

  test("refuses a value that is not a port", () => {
    expect(() => e2ePorts({ EVA_E2E_PORT: "auto" })).toThrow("EVA_E2E_PORT");
    expect(() => e2ePorts({ EVA_E2E_GALLERY_PORT: "70000" })).toThrow("EVA_E2E_GALLERY_PORT");
  });
});

describe("resolveAutoPorts", () => {
  test("writes a free port in place of each auto", async () => {
    const free = [9001, 9002];
    const environment: Record<string, string | undefined> = { EVA_E2E_PORT: "auto", EVA_E2E_GALLERY_PORT: "auto" };
    await resolveAutoPorts(environment, () => Promise.resolve(free.shift() ?? 0));
    expect(e2ePorts(environment)).toEqual({ demo: 9001, gallery: 9002 });
  });

  test("leaves a set port and a missing variable as they are", async () => {
    const environment: Record<string, string | undefined> = { EVA_E2E_PORT: "8100" };
    await resolveAutoPorts(environment, () => Promise.resolve(9001));
    expect(environment).toEqual({ EVA_E2E_PORT: "8100" });
  });

  test("finds a real free port by default", async () => {
    const environment: Record<string, string | undefined> = { EVA_E2E_PORT: "auto" };
    await resolveAutoPorts(environment);
    expect(e2ePorts(environment).demo).toBeGreaterThan(0);
  });
});
