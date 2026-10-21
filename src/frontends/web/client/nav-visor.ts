/** The visor of the nav rail: its standard face, the words of its tooltip, and the faces of a tap. */
import { stateFaces, type Face } from "./visor-faces.ts";

export interface NavVisorInput {
  readonly isConnected: boolean;
  /** The approvals that wait, of any chat. */
  readonly approvals: number;
  /** The open problems of the status. */
  readonly problems: number;
  /** The running turns of Assistant mode chats. */
  readonly assistantTurns: number;
  /** The running turns of project chats. */
  readonly projectTurns: number;
  /**
   * A setup step stops every chat. A step that is only left, such as Telegram, does not count:
   * the Settings badge counts those, and the visor would sleep on each new install.
   */
  readonly chatBlocked: boolean;
}

export interface NavVisorState {
  readonly face: Face;
  readonly words: string;
}

function count(amount: number, one: string, many: string): string {
  return `${amount} ${amount === 1 ? one : many}`;
}

/**
 * The one main thing that goes on, so the visor never mixes two states. A state that needs
 * the person comes before work that runs by itself.
 */
export function navVisorState(input: NavVisorInput): NavVisorState {
  if (!input.isConnected) return { face: stateFaces.offline, words: "Eva does not answer" };
  if (input.approvals > 0) {
    return {
      face: stateFaces.asksPermission,
      words: `${count(input.approvals, "approval waits", "approvals wait")} for you`,
    };
  }
  if (input.problems > 0) {
    return { face: stateFaces.broken, words: count(input.problems, "problem needs you", "problems need you") };
  }
  if (input.chatBlocked) return { face: stateFaces.notSetUp, words: "A setup step stops the chats" };
  const turns = input.assistantTurns + input.projectTurns;
  if (turns > 0) {
    return {
      face: input.projectTurns > 0 ? stateFaces.projectWork : stateFaces.thinking,
      words: `Eva works on ${count(turns, "chat", "chats")}`,
    };
  }
  return { face: stateFaces.idle, words: "Eva is online, and nothing runs" };
}

/** The playful faces that a tap plays. Each has a motion of its own, so the tap shows. */
export const tapFaces: readonly Face[] = ["happy", "wink", "delighted", "surprised"];

/** How long a tap face shows before the standard face comes back, in milliseconds. */
export const tapFaceMs = 1_800;

/** Picks a playful face, never the last one, so each tap looks different. */
export function tapFace(random: () => number = Math.random, last?: Face): Face {
  const choices = tapFaces.filter((face) => face !== last);
  return choices[Math.min(Math.floor(random() * choices.length), choices.length - 1)] ?? "happy";
}
