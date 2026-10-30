// Helpers for the widget tests. Outside Eva, a write fails, so a test that needs a write to work
// fakes it here, with no local server of Eva.

/**
 * Answers each PUT and DELETE of a contract data path as Eva does, and records it. Returns the
 * list of writes: `{ method, path, body }`, with the body parsed as JSON when it is JSON.
 */
export async function fakeWrites(page) {
  const writes = [];
  await page.route(
    (url) => url.pathname.startsWith("/data/"),
    async (route) => {
      const request = route.request();
      if (request.method() !== "PUT" && request.method() !== "DELETE") return route.fallback();
      const text = request.postData() ?? "";
      let body = text;
      try {
        body = JSON.parse(text);
      } catch {
        // Not JSON, such as a YAML file: keep the text.
      }
      writes.push({ method: request.method(), path: new URL(request.url()).pathname.slice(1), body });
      return route.fulfill({ status: 204 });
    },
  );
  return writes;
}

/** Answers eva/location.json as Eva does, with this point, or with null for "no location yet". */
export async function fakeEvaLocation(page, point) {
  await page.route("**/eva/location.json", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(point) }),
  );
}

/** Today in the browser's time zone, as the widget writes it. */
export function today() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${String(now.getFullYear())}-${month}-${day}`;
}
