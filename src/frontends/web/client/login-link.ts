/**
 * The login link of `eva open` (#407). The terminal opens this computer's browser at
 * `#login=<secret>`, with an optional page path after it, such as `#login=<secret>/settings/setup`.
 * The secret lives in the fragment, which the browser never sends, so no server log keeps it.
 */

/** The secret of a login link, and the address to show in its place, or null for any other address. */
export function loginLinkOf(hash: string): { readonly secret: string; readonly address: string } | null {
  const match = /^#login=([A-Za-z0-9_-]+)(\/[^#\s]*)?$/.exec(hash);
  const secret = match?.[1];
  if (secret === undefined) return null;
  return { secret, address: match?.[2] === undefined ? "/" : `/#${match[2]}` };
}

/**
 * Logs this browser in with the link. A browser that is logged in already keeps its login, so each
 * `eva open` adds no new device. Returns why the link did not work, for the login page, or null.
 */
export async function logInWithLink(
  secret: string,
  client: { readonly isLoggedIn: () => Promise<boolean>; readonly redeem: (secret: string) => Promise<void> },
): Promise<string | null> {
  if (await client.isLoggedIn()) return null;
  try {
    await client.redeem(secret);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}
