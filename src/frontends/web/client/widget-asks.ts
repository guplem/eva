/**
 * The asks of a widget (contract 3, #696, #1006): a message that a widget sends to Eva's page, so
 * Eva writes a text in the message box (`chat`) or opens a page for a vault path (`open`). This file
 * reads and checks a message, and finds the page of a path. `WidgetGrid.tsx` does the rest.
 */
import { parseProjectId } from "../../../core/projects/project-id.ts";
import type { WidgetAskType } from "../../../core/widgets/widget-kinds.ts";
import { openPath } from "../../../core/widgets/widget-places.ts";
import { lifeKindPlaces, lifeKinds, olderLifeKindPlaces } from "../../../shared/life-kinds.ts";
import { fileAddressOf } from "./file-paths.ts";
import { lifeAddressOf } from "./life-routes.ts";
import { projectAddressOf } from "./navigation.ts";

/** The longest text of a `chat` ask: the person reads all of it in the message box. */
export const askTextLimit = 2000;

export type AskReason = "not-allowed" | "no-tap" | "too-long" | "not-found" | "unknown";

/** One message of a widget. Only `id` and `ask` are sure: the rest is the widget's, so it is checked. */
export interface AskRequest {
  readonly id: number;
  readonly ask: string;
  readonly text?: unknown;
  readonly path?: unknown;
}

/** The message as a request of the contract, or null for any other message, which gets no answer. */
export function askRequestOf(data: unknown): AskRequest | null {
  if (data === null || typeof data !== "object") return null;
  const message = data as Record<string, unknown>;
  const { id, ask } = message;
  if (message["eva"] !== "widget" || typeof id !== "number" || !Number.isFinite(id) || typeof ask !== "string")
    return null;
  return {
    id,
    ask,
    ...("text" in message ? { text: message["text"] } : {}),
    ...("path" in message ? { path: message["path"] } : {}),
  };
}

export interface AskContext {
  /** The asks of the widget's approval on this computer. */
  readonly approved: readonly WidgetAskType[];
  /** True when the person tapped this widget's frame just before the message. */
  readonly tapped: boolean;
  /** True for a widget in the preview of a clone: it never acts on Eva's page (#693). */
  readonly preview: boolean;
}

/** Why Eva refuses the request, or null when she does it. The path of `open` is checked apart. */
export function checkAsk(request: AskRequest, context: AskContext): AskReason | null {
  if (context.preview) return "not-allowed";
  if (request.ask === "hello") return null;
  if (request.ask !== "chat" && request.ask !== "open") return "unknown";
  if (request.ask === "chat" && (typeof request.text !== "string" || request.text.trim() === "")) return "unknown";
  if (request.ask === "open" && typeof request.path !== "string") return "unknown";
  if (!context.approved.includes(request.ask)) return "not-allowed";
  if (!context.tapped) return "no-tap";
  if (request.ask === "chat" && (request.text as string).length > askTextLimit) return "too-long";
  return null;
}

/** Each place of a Life kind, the older one of a vault that waits for its upgrade too (#940). */
const lifePlaces = lifeKinds.flatMap((kind) =>
  [lifeKindPlaces[kind], olderLifeKindPlaces[kind]].flatMap((place) => (place === undefined ? [] : [{ kind, place }])),
);

/** The project's main file: its page shows it. */
const projectFile = "AGENTS.md";

/**
 * The address of the best page for a vault path, or null for a path that no widget may reach: the
 * page of a Life entity or of a project, or else the Files page. It reads no disk: the page asks
 * the core whether the path exists.
 */
export function openAddressOf(path: string): string | null {
  const trimmed = path.replace(/\/+$/, "");
  const segments = openPath(trimmed);
  if (segments === null) return null;
  for (const { kind, place } of lifePlaces) {
    const folder = place.folder.split("/");
    const inside = segments.slice(folder.length);
    const under = folder.every((part, index) => segments[index] === part);
    if (!under) continue;
    // The folder of the kind opens its list.
    if (inside.length === 0) return lifeAddressOf(kind);
    if (inside.length === 1 || (inside.length === 2 && inside[1] === place.mainFile))
      return lifeAddressOf(kind, inside[0]);
  }
  const [root, project, ...rest] = segments;
  if (
    root === "Projects" &&
    project !== undefined &&
    parseProjectId(project) !== null &&
    (rest.length === 0 || (rest.length === 1 && rest[0] === projectFile))
  )
    return projectAddressOf({ kind: "project", projectId: project });
  return fileAddressOf(trimmed);
}

/** The person's text with the widget's text after it, in its own paragraph. Nothing typed is lost. */
export function textAfterTyped(typed: string, text: string): string {
  const kept = typed.trimEnd();
  return kept === "" ? text : `${kept}\n\n${text}`;
}

/** Eva's answer to a request, without the `eva` and `id` keys that each answer carries. */
export type AskAnswer =
  { readonly ok: true; readonly asks?: readonly WidgetAskType[] } | { readonly ok: false; readonly reason: AskReason };
