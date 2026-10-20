/**
 * EVE's faces: the 15 expressions of the design guide (`docs/design/eve/README.md`), the size
 * classes of the visor, the login rotation, and the one map from Eva's states to faces.
 */

export const faces = [
  "neutral",
  "happy",
  "wink",
  "delighted",
  "surprised",
  "thinking",
  "searching",
  "listening",
  "focused",
  "firm",
  "skeptical",
  "worried",
  "sad",
  "error",
  "asleep",
] as const;

export type Face = (typeof faces)[number];

/** The pixel sizes of the guide: messages, nav rail, empty states, login. */
export type VisorSize = 28 | 36 | 76 | 128;

// The class names are those of the reference, so its CSS stays a copy that one can compare.
const faceClasses: Record<Face, string> = {
  neutral: "",
  happy: "e-joy",
  wink: "e-wink",
  delighted: "e-love",
  surprised: "e-surprise",
  thinking: "e-think",
  searching: "e-scan",
  listening: "e-listen",
  focused: "e-focus",
  firm: "e-firm",
  skeptical: "e-skeptic",
  worried: "e-worry",
  sad: "e-sad",
  error: "e-error",
  asleep: "e-sleep",
};

const sizeClasses: Record<VisorSize, string> = { 28: "s", 36: "", 76: "l", 128: "xl" };

export function visorClassName(face: Face, size: VisorSize): string {
  return ["mk", sizeClasses[size], faceClasses[face]].filter((part) => part !== "").join(" ");
}

/**
 * Each state of Eva has one face, so people learn it. Pages pick a face here, never by hand.
 * The states follow the "Use" column of the guide.
 */
export const stateFaces = {
  /** At rest, and each answer. */
  idle: "neutral",
  /** A new chat, a greeting, a finished task, a complete setup. */
  greeting: "happy",
  /** Done and saved, such as a note added to the vault. */
  saved: "wink",
  /** The person says thanks, or allows a new device. */
  thanked: "delighted",
  /** Something new: a new version, or a new message. */
  news: "surprised",
  /** The engine thinks, with no text yet. */
  thinking: "thinking",
  /** Pairing a device, or a search in the vault. */
  searching: "searching",
  /** Waiting for a message or an answer. */
  waiting: "listening",
  /** Project mode: edits code or runs the tests. */
  projectWork: "focused",
  /** Asks permission for something important. */
  asksPermission: "firm",
  /** A note conflict, or a schedule that nobody confirmed. */
  conflict: "skeptical",
  /** No connection to the hub. */
  offline: "worried",
  /** A schedule failed, or the person denied a permission. */
  failed: "sad",
  /** Something broke and needs the person, such as an expired login. */
  broken: "error",
  /** The hub rests, and nothing is scheduled. */
  resting: "asleep",
  /** A chat cannot answer until a setup step is done. */
  notSetUp: "asleep",
} as const satisfies Record<string, Face>;

/** The faces of the login page while it waits, each with its time on screen in milliseconds. */
export const rotation: readonly (readonly [Face, number])[] = [
  ["searching", 5000],
  ["thinking", 3000],
  ["happy", 2200],
  ["wink", 2200],
  ["surprised", 2600],
  ["listening", 2400],
  ["delighted", 2200],
];

/** Runs `run` after `ms`, and returns a function that cancels it. */
export type Schedule = (run: () => void, ms: number) => () => void;

const browserSchedule: Schedule = (run, ms) => {
  const timer = setTimeout(run, ms);
  return () => clearTimeout(timer);
};

/** Shows each face of the rotation in turn, for ever. Returns a function that stops it. */
export function startRotation(show: (face: Face) => void, schedule: Schedule = browserSchedule): () => void {
  let step = 0;
  let cancel: () => void = () => undefined;
  const showStep = (): void => {
    const [face, ms] = rotation[step] ?? ["searching", 5000];
    show(face);
    cancel = schedule(() => {
      step = (step + 1) % rotation.length;
      showStep();
    }, ms);
  };
  showStep();
  return () => cancel();
}
