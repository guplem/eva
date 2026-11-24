/**
 * Eva's own routes for the web app in the built executable. Bun's HTML bundle route sends each
 * file uncompressed and with no cache rule. On a slow route to a server, the 1.4 MB script then
 * took up to 30 seconds on each load (#1042).
 */
import { readFileSync } from "node:fs";
import { basename } from "node:path";

/** The part of Bun's `HTMLBundle` that Eva reads. `files` exists only in a bundle built ahead of time. */
export interface BuiltWebBundle {
  readonly index: string;
  readonly files?: readonly {
    readonly path: string;
    readonly loader: string;
    readonly headers: Readonly<Record<string, string>>;
  }[];
}

export type WebFileRoute = (request: Request) => Response;

/** The bundler puts a content hash in every file name but the page's, so a cached copy is never stale. */
const hashedFileCache = "public, max-age=31536000, immutable";
/** The page names the hashed files of the current version, so the browser checks it on each load. */
const pageCache = "no-cache";

/**
 * A route for the page at `/` and one for each of its files, or null when Bun bundles the page
 * at run time, as in a source run or a test. Each file is read and compressed once.
 */
export function bundledWebRoutes(bundle: BuiltWebBundle): Record<string, WebFileRoute> | null {
  if (bundle.files === undefined) return null;
  const routes: Record<string, WebFileRoute> = {};
  for (const file of bundle.files) {
    const isPage = file.path === bundle.index;
    const contentType = file.headers["content-type"] ?? "application/octet-stream";
    routes[isPage ? "/" : `/${basename(file.path)}`] = fileRoute(
      readFileSync(file.path),
      contentType,
      isPage ? pageCache : hashedFileCache,
    );
  }
  return routes;
}

function fileRoute(content: Uint8Array<ArrayBuffer>, contentType: string, cacheControl: string): WebFileRoute {
  const compressed = isCompressible(contentType) ? Bun.gzipSync(content) : null;
  if (compressed === null || compressed.byteLength >= content.byteLength) {
    return () => new Response(content, { headers: { "content-type": contentType, "cache-control": cacheControl } });
  }
  return (request) => {
    const acceptsGzip = accepts(request.headers.get("accept-encoding") ?? "", "gzip");
    const headers: Record<string, string> = {
      "content-type": contentType,
      "cache-control": cacheControl,
      vary: "accept-encoding",
    };
    if (!acceptsGzip) return new Response(content, { headers });
    return new Response(compressed, { headers: { ...headers, "content-encoding": "gzip" } });
  };
}

/** True when `Accept-Encoding` names the encoding with a quality above zero: `gzip;q=0` refuses gzip. */
function accepts(acceptEncoding: string, encoding: string): boolean {
  return acceptEncoding.split(",").some((part) => {
    const [name = "", ...parameters] = part.split(";").map((piece) => piece.trim().toLowerCase());
    return name === encoding && !parameters.some((parameter) => /^q=0(\.0*)?$/.test(parameter));
  });
}

/** Text compresses well. An image or a font is compressed already. */
function isCompressible(contentType: string): boolean {
  return /^text\/|javascript|json|svg|xml/i.test(contentType);
}
