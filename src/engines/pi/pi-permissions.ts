/**
 * What pi chats may do, in words for Settings. The words follow `decide` and `buildPiArguments`
 * in pi-adapter.ts: change them together.
 */
import { outwardActionWords } from "../../shared/outward-actions.ts";
import type { EnginePermissions } from "../../shared/permissions.ts";

/** pi has no modes and no permission rules of its own. Eva's extension asks the questions. */
export function describePiPermissions(): EnginePermissions {
  return {
    mode: null,
    chats: [
      {
        chat: "assistant",
        runs: ["Every action that stays on this computer"],
        asks: outwardActionWords,
        blocks: [],
        note: null,
      },
      {
        chat: "trusted-project",
        runs: ["Every action: pi has no questions of its own"],
        asks: [],
        blocks: [],
        note: "pi runs as you would run it in the clone: its own pi extensions load. Eva answers no to each question that an extension asks.",
      },
      {
        chat: "untrusted-project",
        runs: ["Every action: pi has no questions of its own"],
        asks: [],
        blocks: [],
        note: "Every pi extension is off, the clone's and your own. Only Eva's own approval extension loads.",
      },
    ],
    personRules: null,
  };
}
