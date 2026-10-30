// A small static server for the demo and the tests: `npm start`. A browser blocks fetch on
// file://, so a double-click on index.html cannot run the widget. Like GitHub Pages, it answers
// only GET, so a write fails, as it does outside Eva.
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const port = Number(process.env.PORT ?? 3000);
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".yaml": "text/yaml; charset=utf-8",
  ".yml": "text/yaml; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

/** The file of a request path, or null for a path outside the folder or a hidden file. */
function fileOf(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath.split("?")[0] ?? "/");
  } catch {
    // A broken escape, such as %E0%A4%A, names no file.
    return null;
  }
  const relative = normalize(decoded.endsWith("/") ? `${decoded}index.html` : decoded).replace(/^[/\\]+/, "");
  if (relative.startsWith("..") || relative.split(sep).some((part) => part.startsWith("."))) return null;
  return join(root, relative);
}

const server = createServer(async (request, response) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { allow: "GET, HEAD" }).end();
    return;
  }
  const file = fileOf(request.url ?? "/");
  const info = file === null ? null : await stat(file).catch(() => null);
  if (file === null || info === null || !info.isFile()) {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream" });
  if (request.method === "HEAD") response.end();
  else createReadStream(file).pipe(response);
});

server.listen(port, () => {
  process.stdout.write(`The widget runs at http://localhost:${String(port)}/\n`);
});
