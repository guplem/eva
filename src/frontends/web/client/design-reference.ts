/**
 * The content of the design reference page: the colour tokens, the shared components and a map
 * of the layers. A test checks each token, class and folder here against the code, so the page
 * never names a part that is gone.
 */
import type { IconName } from "./icons.tsx";
import type { VisorSize } from "./visor-faces.ts";

export interface ColourToken {
  readonly name: string;
  readonly use: string;
}

export interface ColourGroup {
  readonly title: string;
  readonly tokens: readonly ColourToken[];
}

export const colourGroups: readonly ColourGroup[] = [
  {
    title: "Surfaces",
    tokens: [
      { name: "--bg", use: "Page background" },
      { name: "--bg2", use: "End of the main gradient" },
      { name: "--side", use: "Nav rail, lists and inspector" },
      { name: "--panel", use: "Cards, bubbles, composer and dialogs" },
      { name: "--chip", use: "Chips, inputs and step lines" },
      { name: "--line", use: "Rare dividers" },
    ],
  },
  {
    title: "Text",
    tokens: [
      { name: "--ink", use: "Text" },
      { name: "--muted", use: "Secondary text" },
    ],
  },
  {
    title: "Accent, from the seed colour",
    tokens: [
      { name: "--accent", use: "Main buttons and active states" },
      { name: "--accent-ink", use: "Accent text and icons on a neutral surface" },
      { name: "--on-accent", use: "Text on the accent" },
      { name: "--soft", use: "User bubbles and selected items" },
      { name: "--soft-ink", use: "Text on --soft" },
      { name: "--glow", use: "Glow of the eyes and the main buttons" },
    ],
  },
  {
    title: "EVE",
    tokens: [
      { name: "--eye", use: "EVE's eyes" },
      { name: "--visor", use: "Top of the visor gradient" },
      { name: "--visor2", use: "Bottom of the visor gradient" },
      { name: "--shell", use: "Ring around a large visor" },
    ],
  },
  {
    title: "States, the same for every seed",
    tokens: [
      { name: "--ok", use: "Done" },
      { name: "--ok-bg", use: "Background of a done state" },
      { name: "--warn", use: "Wait, or take care" },
      { name: "--warn-bg", use: "Background of a warning" },
      { name: "--warn-ink", use: "Small text on --warn-bg" },
      { name: "--bad", use: "The person must act" },
      { name: "--bad-bg", use: "Background of a problem" },
    ],
  },
];

export type ComponentId =
  | "buttons"
  | "card"
  | "pills"
  | "status-icons"
  | "callouts"
  | "fields"
  | "choice-chips"
  | "mode-chips"
  | "command-line"
  | "guide-steps"
  | "section-card"
  | "progress"
  | "tooltip"
  | "toasts"
  | "skeletons"
  | "visor"
  | "icons";

export interface ComponentSample {
  readonly id: ComponentId;
  readonly title: string;
  /** The classes to use, in the order a person adds them. */
  readonly classes: readonly string[];
  /** The React part that draws it, when one exists. */
  readonly part?: string;
  readonly use: string;
}

export const componentSamples: readonly ComponentSample[] = [
  {
    id: "buttons",
    title: "Buttons",
    classes: ["primary", "soft", "outline", "ghost", "danger", "large", "small"],
    use: "A pill. Give a view one primary button at most.",
  },
  {
    id: "card",
    title: "Card",
    classes: ["card", "card-header", "card-description", "card-body"],
    part: "Card",
    use: "A titled block on a panel. Settings uses one per setting.",
  },
  {
    id: "pills",
    title: "Status pills",
    classes: ["pill", "dot", "done", "ok", "warn", "failed", "idle"],
    part: "StatusPill",
    use: "A short word for a state. The dot gives the state a shape.",
  },
  {
    id: "status-icons",
    title: "Status marks",
    classes: ["status-icon", "large"],
    part: "StatusIcon",
    use: "A round mark for a setup step: done, needs you, failed or optional.",
  },
  {
    id: "callouts",
    title: "Callouts",
    classes: ["callout", "success", "warning", "danger"],
    use: "A note inside a card.",
  },
  {
    id: "fields",
    title: "Fields",
    classes: ["field", "field-label", "field-hint", "inline-form", "button-row"],
    use: "A label, a hint and an input. An inline form puts its buttons on the same row.",
  },
  {
    id: "choice-chips",
    title: "Choice chips",
    classes: ["choice-chips", "choice-chip"],
    part: "ChoiceChips",
    use: "A choice from a few options, such as the theme.",
  },
  {
    id: "mode-chips",
    title: "Mode chips",
    classes: ["mode-chip", "soft"],
    use: "A small label, such as a chat's mode or engine.",
  },
  {
    id: "command-line",
    title: "Command line",
    classes: ["command-line"],
    part: "CommandLine",
    use: "A command to type, with a Copy button.",
  },
  {
    id: "guide-steps",
    title: "Guide steps",
    classes: ["guide-steps"],
    part: "Steps",
    use: "Numbered steps for a setup guide, in plain words.",
  },
  {
    id: "section-card",
    title: "Link card",
    classes: ["section-card", "section-icon", "chevron"],
    use: "A big button that opens a page, as on the Settings home.",
  },
  {
    id: "progress",
    title: "Progress bar",
    classes: ["progress", "progress-track", "running", "progress-fill"],
    part: "ProgressBar",
    use: "A wait inside a card, with its sentence. A known share fills the bar and shows the percentage. An unknown share runs lines across it.",
  },
  {
    id: "tooltip",
    title: "Tooltip",
    classes: ["tooltip"],
    part: "TooltipLayer",
    use: "A short hint over an element. Give the element a data-tooltip attribute, never a title. A pointer that rests on it, or the keyboard focus, shows it.",
  },
  {
    id: "toasts",
    title: "Toasts",
    classes: ["toast", "toast-actions", "toast-close", "toast-timer"],
    part: "Toast",
    use: "A short message at the bottom of the screen, such as the result of an action. The ring around the close button empties, and then the toast closes. A pointer on the toast stops the ring. Press a button to show one.",
  },
  {
    id: "skeletons",
    title: "Skeletons",
    classes: ["skeleton", "skeleton-line", "skeleton-block"],
    part: "FactsSkeleton, ListSkeleton, ConversationSkeleton, CardsSkeleton",
    use: "A wait for content that fills a large area, such as a chat or a list. The grey shapes copy the content to come.",
  },
  {
    id: "visor",
    title: "EVE's visor",
    classes: ["mk", "s", "l", "xl"],
    part: "Visor",
    use: "EVE's face. Each state of Eva has one expression. The white shell ring marks a large visor that stands alone on a page.",
  },
  {
    id: "icons",
    title: "Icons",
    classes: ["icon"],
    part: "Icon",
    use: "Eva's own line icons, in the colour of the text. Take each one from client/icons.tsx, for the use that it shows.",
  },
];

export interface VisorSizeUse {
  readonly size: VisorSize;
  /** Large visors stand alone, so a white ring lifts them off the page. Small ones sit in a line of text. */
  readonly shell: boolean;
  readonly use: string;
}

export const visorSizes: readonly VisorSizeUse[] = [
  { size: 28, shell: false, use: "Next to a message or a dialog title" },
  { size: 36, shell: false, use: "Nav rail, a card or a notice" },
  { size: 76, shell: true, use: "An empty page or a page-wide notice" },
  { size: 128, shell: true, use: "Login and the new chat greeting" },
];

/** What each icon means, so one icon keeps one meaning on every page. */
export const iconUses: Readonly<Record<IconName, string>> = {
  chat: "A chat, assistant mode",
  folder: "The vault, a folder",
  briefcase: "A project, Project mode",
  clock: "A time, a schedule",
  gear: "Settings",
  plus: "Add, new chat",
  search: "Search",
  send: "Send a message",
  clip: "Attach a file",
  check: "Done, setup",
  x: "Close, remove",
  file: "A file, a note",
  pen: "Edit, rename",
  term: "A terminal, an engine",
  fork: "Fork a chat",
  branch: "A git branch",
  sync: "Vault sync",
  more: "More actions",
  menu: "Open the menu",
  back: "Go back, open (flipped)",
  bolt: "Developer tools",
  shield: "Permissions, security",
  phone: "A phone, remote access",
  laptop: "A computer, a device",
  alert: "A problem",
  "wifi-off": "No connection",
  download: "Updates, download",
  copy: "Copy",
  sun: "Light theme",
  moon: "Dark theme",
  bell: "Notifications",
  globe: "Connections, the web",
  key: "A token, a login",
  calendar: "A day, a date",
  down: "Open a list",
  restart: "Restart Eva",
  palette: "Personalize, colours",
  trash: "Delete for good",
  info: "More information",
  lock: "Private, locked",
  eye: "Show a secret",
  external: "Opens another site",
  play: "Run now",
  stop: "Stop a turn",
  user: "The person, an account",
  home: "Home page",
  mic: "Record a voice note",
  expand: "Make the file preview large",
  shrink: "Make the file preview small again",
};

export interface ArchitectureLayer {
  readonly title: string;
  /** From the repository root. */
  readonly path: string;
  readonly role: string;
}

/** From the top, where a person types, to the bottom, which every layer uses. */
export const architectureLayers: readonly ArchitectureLayer[] = [
  {
    title: "Front ends",
    path: "src/frontends",
    role: "The terminal, Telegram and this web page, with its API. They send messages and show events.",
  },
  {
    title: "Core",
    path: "src/core",
    role: "Sessions, modes, projects, vault sync, schedules, settings and updates.",
  },
  {
    title: "Engines",
    path: "src/engines",
    role: "One adapter per harness, Claude Code and pi. An adapter runs a turn and sends back events.",
  },
  {
    title: "Shared",
    path: "src/shared",
    role: "Types, errors and seams, such as the process runner. Every layer uses it.",
  },
  {
    title: "Wiring",
    path: "src/main.ts",
    role: "Builds each part and connects them. It holds no logic.",
  },
];

/** The path of one message, from the person to the harness and back. */
export const messageFlow: readonly string[] = [
  "You type in a front end",
  "The core finds the session and its mode",
  "The engine runs a turn in Claude Code or pi",
  "Events come back, redacted and in order",
  "Each front end shows them",
];
