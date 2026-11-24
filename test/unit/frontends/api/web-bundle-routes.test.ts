import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { bundledWebRoutes, type BuiltWebBundle } from "../../../../src/frontends/api/web-bundle-routes.ts";

const pageText = `<!doctype html><script src="/chunk-ab12cd34.js"></script>${"<div></div>".repeat(50)}`;
const scriptText = `console.log(${JSON.stringify("eva ".repeat(500))});`;
const pngBytes = new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4]);

let folder: string;
let bundle: BuiltWebBundle;

beforeAll(() => {
  folder = mkdtempSync(join(tmpdir(), "eva-web-bundle-"));
  const write = (name: string, content: string | Uint8Array): string => {
    const path = join(folder, name);
    writeFileSync(path, content);
    return path;
  };
  const page = write("index-ff00ee11.html", pageText);
  bundle = {
    index: page,
    files: [
      { path: page, loader: "html", headers: { etag: "p1", "content-type": "text/html;charset=utf-8" } },
      {
        path: write("chunk-ab12cd34.js", scriptText),
        loader: "js",
        headers: { etag: "s1", "content-type": "text/javascript;charset=utf-8" },
      },
      {
        path: write("apple-touch-icon-k1dmy9rp.png", pngBytes),
        loader: "file",
        headers: { etag: "i1", "content-type": "image/png" },
      },
    ],
  };
});

afterAll(() => {
  rmSync(folder, { recursive: true, force: true });
});

function get(path: string, acceptEncoding: string | null): Response {
  const routes = bundledWebRoutes(bundle);
  const handler = routes?.[path];
  if (handler === undefined) throw new Error(`No route for ${path}`);
  const headers: Record<string, string> = acceptEncoding === null ? {} : { "accept-encoding": acceptEncoding };
  return handler(new Request(`http://127.0.0.1${path}`, { headers }));
}

describe("bundledWebRoutes", () => {
  test("gives no routes when Bun bundles the page at run time", () => {
    expect(bundledWebRoutes({ index: "index.html" })).toBeNull();
  });

  test("serves the page at the root, never cached for long", async () => {
    const response = get("/", "gzip");
    expect(response.headers.get("content-type")).toBe("text/html;charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("no-cache");
    expect(response.headers.get("content-encoding")).toBe("gzip");
    expect(gunzipSync(new Uint8Array(await response.arrayBuffer())).toString()).toBe(pageText);
  });

  test("sends a hashed script compressed and cached for good", async () => {
    const response = get("/chunk-ab12cd34.js", "gzip, deflate, br");
    expect(response.headers.get("content-encoding")).toBe("gzip");
    expect(response.headers.get("vary")).toBe("accept-encoding");
    expect(response.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    const body = new Uint8Array(await response.arrayBuffer());
    expect(body.byteLength).toBeLessThan(scriptText.length);
    expect(gunzipSync(body).toString()).toBe(scriptText);
  });

  test("sends the script as it is to a client that refuses gzip", async () => {
    const response = get("/chunk-ab12cd34.js", null);
    expect(response.headers.get("content-encoding")).toBeNull();
    expect(await response.text()).toBe(scriptText);
  });

  test("sends the script as it is when gzip has a quality of zero", async () => {
    const response = get("/chunk-ab12cd34.js", "gzip;q=0, identity");
    expect(response.headers.get("content-encoding")).toBeNull();
    expect(await response.text()).toBe(scriptText);
  });

  test("never compresses an image, which is compressed already", async () => {
    const response = get("/apple-touch-icon-k1dmy9rp.png", "gzip");
    expect(response.headers.get("content-encoding")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(pngBytes);
  });
});
