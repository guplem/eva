/**
 * What pi chats may do, in words for Settings. The words follow `decide` and `buildPiArguments`
 * in pi-adapter.ts: change them together.
 */
import { askedActionWords } from "../../shared/outward-actions.ts";
import type { EnginePermissions } from "../../shared/permissions.ts";

/** The file wall of a Project chat (#711). pi has no sandbox, so its shell is not walled. */
const outsideFolder =
  "Your vault, your other project folders and Eva's own folder, by a file tool: a shell command can still read them";
const settingsWrites = "A file tool's write to the folder's .pi settings or to a .git folder";

/** pi has no modes and no permission rules of its own. Eva's extension asks the questions. */
export function describePiPermissions(): EnginePermissions {
  return {
    mode: null,
    chats: [
      {
        chat: "assistant",
        runs: ["Every other action that stays on this computer"],
        asks: askedActionWords,
        blocks: [],
        note: null,
      },
      {
        chat: "trusted-project",
        runs: ["Every action: pi has no questions of its own"],
        asks: [],
        blocks: [outsideFolder, settingsWrites],
        note: "pi runs as you would run it in the clone: its own pi extensions load. Eva answers no to each question that an extension asks.",
      },
      {
        chat: "untrusted-project",
        runs: ["Every action: pi has no questions of its own"],
        asks: [],
        blocks: [outsideFolder, settingsWrites],
        note: "Every pi extension is off, the clone's and your own. Only Eva's own approval extension loads.",
      },
    ],
    personRules: null,
  };
}
