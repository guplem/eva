/**
 * The web addresses that a widget may call (#691). A host is an `https` origin on the public
 * internet. Eva refuses each address that could reach her own API, another service on the
 * person's network, or a device of the tailnet. A check by name cannot see a public name that
 * points to a private address: `docs/widgets.md` says so.
 */

export type HostCheck =
  { readonly ok: true; readonly origin: string } | { readonly ok: false; readonly reason: string };

/** Checks one `url` of the manifest's `hosts`. `ownHosts`: Eva's own host names, such as her Tailscale name. */
export function checkHost(url: string, ownHosts: readonly string[]): HostCheck {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return refused(`${url} is not a web address.`);
  }
  if (parsed.protocol !== "https:") return refused(`${url} does not use https.`);
  if (parsed.username !== "" || parsed.password !== "" || parsed.pathname !== "/" || parsed.search || parsed.hash)
    return refused(`${url} has more than a host. Give only https and the host, such as https://api.example.com.`);
  // The URL parser turns every form of a number address, such as 0x7f.1, into its plain form.
  const host = parsed.hostname.toLowerCase().replace(/\.$/, "");
  if (ownHosts.some((own) => own.toLowerCase().replace(/\.$/, "") === host))
    return refused(`${url} is Eva herself. A widget never calls Eva's own address.`);
  if (isPrivateName(host) || isPrivateIpv4(host) || isPrivateIpv6(host))
    return refused(`${url} is on this computer, its network or the tailnet. A widget calls only public hosts.`);
  return { ok: true, origin: parsed.origin };
}

function refused(reason: string): HostCheck {
  return { ok: false, reason };
}

/**
 * The names that a local network or a test gives, such as `nas.lan` or `router.home`, and the
 * tailnet. None of them is a public host.
 */
const privateSuffixes = [
  ".localhost",
  ".local",
  ".localdomain",
  ".lan",
  ".home",
  ".home.arpa",
  ".internal",
  ".intranet",
  ".corp",
  ".private",
  ".test",
  ".example",
  ".invalid",
  ".ts.net",
];

/** A name with one label, such as `router`, is a name of the local network. */
function isPrivateName(host: string): boolean {
  if (host.startsWith("[")) return false;
  if (!host.includes(".")) return true;
  return privateSuffixes.some((suffix) => host.endsWith(suffix));
}

/** Loopback, private, link-local, the Tailscale range 100.64.0.0/10, and every other special range. */
function isPrivateIpv4(host: string): boolean {
  const match = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(host);
  if (match === null) return false;
  const [a = 0, b = 0] = match.slice(1).map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19))
  );
}

/**
 * Only global unicast addresses (2000::/3) pass. The rest holds loopback, link-local, the private
 * range fc00::/7 with Tailscale's fd7a:115c:a1e0::/48, and the forms of an IPv4 address.
 */
function isPrivateIpv6(host: string): boolean {
  if (!host.startsWith("[")) return false;
  const first = Number.parseInt(host.slice(1).split(":")[0] ?? "", 16);
  return !(Number.isInteger(first) && first >= 0x2000 && first <= 0x3fff);
}
