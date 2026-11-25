/**
 * Gzip for the API's large JSON answers. JSON text shrinks to a fifth or less, so the web app
 * loads fast on a slow network (#1049).
 */
import { accepts } from "./web-bundle-routes.ts";

/** Below this size, gzip saves too little to pay for the work. */
const minimumBytes = 1024;

/**
 * The answer compressed when the request accepts gzip. An answer that no store may keep, such as a
 * decrypted secret, stays as it is: its size then tells nothing about its text.
 */
export async function compressedJson(request: Request, answer: Response): Promise<Response> {
  const isJson = (answer.headers.get("content-type") ?? "").includes("application/json");
  if (!isJson || answer.headers.has("content-encoding") || answer.body === null) return answer;
  if ((answer.headers.get("cache-control") ?? "").includes("no-store")) return answer;
  const content = new Uint8Array(await answer.arrayBuffer());
  const headers = new Headers(answer.headers);
  const init = { status: answer.status, statusText: answer.statusText, headers };
  if (content.byteLength < minimumBytes) return new Response(content, init);
  headers.set("vary", "accept-encoding");
  if (!accepts(request.headers.get("accept-encoding") ?? "", "gzip")) return new Response(content, init);
  headers.set("content-encoding", "gzip");
  headers.delete("content-length");
  return new Response(Bun.gzipSync(content), init);
}
