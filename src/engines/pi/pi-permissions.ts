/**
 * What pi chats may do, in words for Settings. The words follow `decide` and `buildPiArguments`
 * in pi-adapter.ts: change them together.
 */
import { outwardActionWordsByLevel } from "../../shared/outward-actions.ts";
import type { EnginePermissions, PermissionContext } from "../../shared/permissions.ts";

/**
 * The file wall of a Project chat (#711). pi has no sandbox of its own, so Eva runs each shell
 * command in the sandbox library, where the start check finds that it runs (#759).
 */
const outsideFolder =
  "Your vault, your other project folders and Eva's own folder, by a file tool, and by a shell command where the sandbox runs";
const settingsWrites = "A file tool's write to the folder's .pi settings or to a .git folder";

/** pi has no modes and no permission rules of its own. Eva's extension asks the questions. */
export function describePiPermissions(context: PermissionContext): EnginePermissions {
  const words = outwardActionWordsByLevel(context.outwardActionLevels);
  return {
    mode: null,
    chats: [
      {
        chat: "assistant",
        runs: ["Every other action that stays on this computer", ...words.allow],
        asks: words.ask,
        blocks: words.deny,
        note: null,
      },
      {
        chat: "trusted-project",
        runs: ["Every action: pi has no questions of its own"],
        asks: [],
        blocks: [outsideFolder, settingsWrites],
        note: "pi runs as you would run it in the clone: its own pi extensions load. Eva answers no to each question that an extension asks. Its own pi extensions run outside the sandbox. They, and its .pi settings such as a shell command prefix, can change a shell command after Eva puts it in the sandbox.",
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
