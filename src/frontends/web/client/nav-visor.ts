/** The visor of the nav rail: its standard face, the words of its tooltip, and its count. */
import type { Destination } from "./navigation.ts";
import { stateFaces, type Face } from "./visor-faces.ts";

export interface NavVisorInput {
  readonly isConnected: boolean;
  /** The approvals that wait, of any chat. */
  readonly approvals: number;
  /** The open problems, read or not. */
  readonly problems: number;
  /** The open problems that the person did not mark as read. */
  readonly unreadProblems: number;
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
  if (input.unreadProblems > 0) {
    return { face: stateFaces.broken, words: count(input.unreadProblems, "problem needs you", "problems need you") };
  }
  // A read problem is still open, so the face stays, but nothing new waits.
  if (input.problems > 0) {
    return { face: stateFaces.broken, words: count(input.problems, "open problem", "open problems") };
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

export interface VisorSignalInput {
  readonly unreadProblems: number;
  readonly unreadError: boolean;
  /** An unread entry of the history, or a setup step that is left. */
  readonly news: boolean;
  /** The notification center is the open page, so the person already looks. */
  readonly centerOpen: boolean;
}

export interface VisorSignal {
  /** The number on the visor: the unread problems. */
  readonly count: number;
  /** A small dot for news, when no number shows. */
  readonly dot: boolean;
  /** The crosses glow red and pulse. Only an error moves, so it stands out from a warning. */
  readonly alarm: boolean;
}

/** How the visor calls the person to the notification center (#566). */
export function visorSignal(input: VisorSignalInput): VisorSignal {
  return {
    count: input.unreadProblems,
    dot: input.unreadProblems === 0 && input.news,
    alarm: input.unreadError && !input.centerOpen,
  };
}

/**
 * The visor wears the Project eyes while Projects is open on a phone. A phone chat shows no visor
 * beside an answer, so the tab bar is where the person sees the mode. A computer shows it beside each answer.
 */
export function navVisorProjectEyes(current: Destination, isPhone: boolean): boolean {
  return isPhone && current === "projects";
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
