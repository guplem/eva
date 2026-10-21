/**
 * A fake Google for tests: the token endpoint, one cheap read of each service and a Drive folder, at
 * `baseUrl`. A test sets an error to see how Eva names the step to fix.
 */
import type { Server } from "bun";

export interface FakeGoogle {
  readonly url: string;
  /** The form of each token request. */
  readonly tokenRequests: URLSearchParams[];
  /** The form of each token revoke. */
  readonly revokeRequests: URLSearchParams[];
  /** The path of each API request. */
  readonly apiRequests: string[];
  /** The name of each Drive folder that Eva created. */
  readonly driveFolders: string[];
  /** The account of the ID token. */
  email: string;
  /** The scopes that the person allowed, with spaces between them. */
  grantedScope: string;
  /** An OAuth error for every token request, such as `invalid_client`. */
  tokenError: string | null;
  /** A status for every token request, with a body that is not JSON, such as 503. */
  tokenOutage: number | null;
  /** A status for every API read, such as 401. */
  apiStatus: number | null;
  /** The services whose API is off, such as `calendar`. */
  readonly disabled: Set<string>;
  stop(): void;
}

const servicePaths: readonly [string, string][] = [
  ["/calendar/", "calendar"],
  ["/drive/", "drive"],
  ["/tasks/", "tasks"],
  ["/gmail/", "gmail"],
  ["/v1/people/", "contacts"],
];

export function fakeGoogle(): FakeGoogle {
  const fake: Omit<FakeGoogle, "url" | "stop"> = {
    tokenRequests: [],
    revokeRequests: [],
    apiRequests: [],
    driveFolders: [],
    email: "person@example.com",
    grantedScope: "openid https://www.googleapis.com/auth/calendar.readonly",
    tokenError: null,
    tokenOutage: null,
    apiStatus: null,
    disabled: new Set(),
  };
  const server: Server<undefined> = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: async (request) => {
      const url = new URL(request.url);
      if (url.pathname === "/revoke") {
        fake.revokeRequests.push(new URLSearchParams(await request.text()));
        return Response.json({});
      }
      if (url.pathname === "/token") {
        const form = new URLSearchParams(await request.text());
        fake.tokenRequests.push(form);
        if (fake.tokenOutage !== null) return new Response("<html>busy</html>", { status: fake.tokenOutage });
        if (fake.tokenError !== null) return Response.json({ error: fake.tokenError }, { status: 400 });
        const payload = Buffer.from(JSON.stringify({ email: fake.email })).toString("base64url");
        return Response.json({
          access_token: "the-access-token",
          expires_in: 3599,
          scope: fake.grantedScope,
          ...(form.get("grant_type") === "authorization_code"
            ? { refresh_token: "the-refresh-token", id_token: `e30.${payload}.signature` }
            : {}),
        });
      }
      fake.apiRequests.push(url.pathname);
      const service = servicePaths.find(([prefix]) => url.pathname.startsWith(prefix))?.[1];
      if (service === undefined) return Response.json({ error: { code: 404 } }, { status: 404 });
      if (request.headers.get("authorization") !== "Bearer the-access-token")
        return Response.json({ error: { code: 401 } }, { status: 401 });
      if (fake.apiStatus !== null)
        return Response.json({ error: { code: fake.apiStatus } }, { status: fake.apiStatus });
      if (fake.disabled.has(service))
        return Response.json(
          { error: { code: 403, status: "PERMISSION_DENIED", details: [{ reason: "SERVICE_DISABLED" }] } },
          { status: 403 },
        );
      if (request.method === "POST" && url.pathname === "/drive/v3/files") {
        const { name } = (await request.json()) as { name: string };
        fake.driveFolders.push(name);
        const id = `folder-${String(fake.driveFolders.length)}`;
        return Response.json({ id, webViewLink: `https://drive.google.com/drive/folders/${id}` });
      }
      return Response.json({ items: [] });
    },
  });
  return Object.assign(fake, {
    url: `http://127.0.0.1:${String(server.port)}`,
    stop: () => {
      void server.stop(true);
    },
  });
}
