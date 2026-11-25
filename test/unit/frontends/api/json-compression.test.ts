import { describe, expect, test } from "bun:test";
import { gunzipSync } from "node:zlib";
import { compressedJson } from "../../../../src/frontends/api/json-compression.ts";

const largeBody = {
  chats: Array.from({ length: 40 }, (_, index) => ({ id: `chat-${String(index)}`, title: "A chat" })),
};
const gzipRequest = new Request("http://eva.test/api/sessions", {
  headers: { "accept-encoding": "gzip, deflate, br" },
});

describe("compressedJson", () => {
  test("compresses a large JSON answer when the request accepts gzip", async () => {
    const answer = await compressedJson(gzipRequest, Response.json(largeBody, { status: 201 }));
    expect(answer.status).toBe(201);
    expect(answer.headers.get("content-encoding")).toBe("gzip");
    expect(answer.headers.get("vary")).toBe("accept-encoding");
    expect(answer.headers.get("content-type")).toContain("application/json");
    const text = new TextDecoder().decode(gunzipSync(new Uint8Array(await answer.arrayBuffer())));
    expect(JSON.parse(text)).toEqual(largeBody);
  });

  test("sends the JSON as it is when the request refuses gzip", async () => {
    for (const acceptEncoding of ["", "br", "gzip;q=0"]) {
      const request = new Request("http://eva.test/api/sessions", { headers: { "accept-encoding": acceptEncoding } });
      const answer = await compressedJson(request, Response.json(largeBody));
      expect(answer.headers.get("content-encoding")).toBeNull();
      expect(answer.headers.get("vary")).toBe("accept-encoding");
      expect(await answer.json()).toEqual(largeBody);
    }
  });

  test("sends a small answer uncompressed", async () => {
    const answer = await compressedJson(gzipRequest, Response.json({ ok: true }, { status: 202 }));
    expect(answer.status).toBe(202);
    expect(answer.headers.get("content-encoding")).toBeNull();
    expect(await answer.json()).toEqual({ ok: true });
  });

  test("leaves a non-JSON answer and an answer that no store may keep", async () => {
    const answers = [
      new Response("x".repeat(4000), { headers: { "content-type": "text/plain" } }),
      Response.json(largeBody, { headers: { "cache-control": "no-store" } }),
    ];
    for (const original of answers) {
      expect(await compressedJson(gzipRequest, original)).toBe(original);
    }
  });

  test("leaves an answer that has an encoding already", async () => {
    const original = new Response("{}", { headers: { "content-type": "application/json", "content-encoding": "br" } });
    expect(await compressedJson(gzipRequest, original)).toBe(original);
  });
});
