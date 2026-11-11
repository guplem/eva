/** The addresses of the Life pages (#911): `#/<kind>` for a list and `#/<kind>/<id>` for one entity. */
import { isLifeKind, type LifeKind } from "../../../shared/life-kinds.ts";

export interface LifeRoute {
  readonly kind: LifeKind;
  readonly entityId: string | null;
}

/** The Life page that the address names: `#/<kind>`, or `#/<kind>/<id>` for one entity. */
export function lifeRouteOf(hash: string): LifeRoute | null {
  const match = /^#\/([^/]+)(?:\/(.*))?$/.exec(hash);
  const kind = match?.[1] ?? "";
  if (!isLifeKind(kind)) return null;
  const rest = match?.[2] ?? "";
  // An id is one folder name, so a longer path shows the list.
  if (rest === "" || rest.includes("/")) return { kind, entityId: null };
  try {
    return { kind, entityId: decodeURIComponent(rest) };
  } catch {
    // A hand-typed address with a bad `%` escape.
    return { kind, entityId: null };
  }
}

export function lifeAddressOf(kind: LifeKind, entityId?: string | null): string {
  return entityId === undefined || entityId === null ? `#/${kind}` : `#/${kind}/${encodeURIComponent(entityId)}`;
}
