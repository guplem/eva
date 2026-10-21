/**
 * The ready-made Google access levels. Each preset gives no less than the one before it. Eva stores
 * only the level of each service, so a preset name can never disagree with the levels.
 */

/**
 * The access levels of each Google service, lowest first, from `auth/permissions.py` of `workspace-mcp`.
 * Each level holds the levels below it. Change them together with `workspaceMcpVersion`.
 * The config schema reads them. This file imports nothing, so the web page loads only these lists.
 */
export const googleAccessLevels = {
  calendar: ["readonly", "full"],
  drive: ["readonly", "full"],
  contacts: ["readonly", "full"],
  tasks: ["readonly", "manage", "full"],
  gmail: ["readonly", "organize", "drafts", "send", "full"],
} as const;

type GoogleService = keyof typeof googleAccessLevels;
type GoogleAccess = { readonly [S in GoogleService]: (typeof googleAccessLevels)[S][number] };

export const googleServiceLabels: Readonly<Record<GoogleService, string>> = {
  calendar: "Calendar",
  drive: "Drive",
  contacts: "Contacts",
  tasks: "Tasks",
  gmail: "Gmail",
};

/** What each level lets Eva do, in plain words. */
export const googleLevelLabels: { readonly [S in GoogleService]: Readonly<Record<GoogleAccess[S], string>> } = {
  calendar: { readonly: "Read only", full: "Read and change" },
  drive: { readonly: "Read only", full: "Read and change" },
  contacts: { readonly: "Read only", full: "Read and change" },
  tasks: { readonly: "Read only", manage: "Read and change, but not delete", full: "Read, change and delete" },
  gmail: {
    readonly: "Read only",
    organize: "Read and sort, such as labels and archive",
    drafts: "Read, sort and write drafts",
    send: "Read, sort, write drafts and send",
    full: "Everything, including the mail settings",
  },
};

export interface GoogleAccessPreset {
  readonly id: "read" | "lists" | "drafts" | "everything";
  readonly label: string;
  readonly access: GoogleAccess;
}

export const googleAccessPresets: readonly GoogleAccessPreset[] = [
  {
    id: "read",
    label: "Read only",
    access: { calendar: "readonly", drive: "readonly", contacts: "readonly", tasks: "readonly", gmail: "readonly" },
  },
  {
    id: "lists",
    label: "Keep my lists: change events, contacts and tasks, and sort mail",
    access: { calendar: "full", drive: "readonly", contacts: "full", tasks: "manage", gmail: "organize" },
  },
  {
    id: "drafts",
    label: "Change and draft: also change files and write drafts",
    access: { calendar: "full", drive: "full", contacts: "full", tasks: "full", gmail: "drafts" },
  },
  {
    id: "everything",
    label: "Everything, such as send mail",
    access: { calendar: "full", drive: "full", contacts: "full", tasks: "full", gmail: "full" },
  },
];

/** The preset with the same levels for each service that is on, or null for a custom choice. */
export function matchingGoogleAccessPreset(
  access: GoogleAccess,
  services: readonly GoogleService[],
): GoogleAccessPreset | null {
  return (
    googleAccessPresets.find((preset) => services.every((service) => preset.access[service] === access[service])) ??
    null
  );
}

/** The services with one turned on or off, in the order of `googleAccessLevels`. */
export function withGoogleService(
  services: readonly GoogleService[],
  service: GoogleService,
  on: boolean,
): GoogleService[] {
  const order = Object.keys(googleAccessLevels) as GoogleService[];
  return order.filter((each) => (each === service ? on : services.includes(each)));
}
