/**
 * Eva's own line icons, drawn for her: no icon library. The EVE design reference
 * (`const P` in docs/design/eve/reference.html) holds the same drawings: change both together.
 * Emoji look different on each system and ignore the theme, so the page draws its own icons.
 */
import type { ReactElement } from "react";

const drawings = {
  chat: <path d="M20.5 12a8 8 0 0 1-11.7 7.1L4 20l1-4.4A8 8 0 1 1 20.5 12z" />,
  folder: <path d="M3 7.5A2 2 0 0 1 5 5.5h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
  briefcase: (
    <>
      <rect x="3.5" y="7.5" width="17" height="12" rx="2" />
      <path d="M9 7.5V6a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 6v1.5M3.5 12.5h17" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  gear: (
    <>
      <path d="M3.88 16.7A9.29 9.29 0 0 1 2.94 14.42l1.57-1.97a7.65 7.65 0 0 1 0-.9l-1.57-1.97a9.32 9.32 0 0 1 .94-2.28l2.5-.28a7.59 7.59 0 0 1 .64-.64l.28-2.5A9.29 9.29 0 0 1 9.58 2.94l1.97 1.57a7.65 7.65 0 0 1 .9 0l1.97-1.57a9.32 9.32 0 0 1 2.28.94l.28 2.5a7.59 7.59 0 0 1 .64.64l2.5.28a9.29 9.29 0 0 1 .94 2.28l-1.57 1.97a7.65 7.65 0 0 1 0 .9l1.57 1.97a9.32 9.32 0 0 1-.94 2.28l-2.5.28a7.59 7.59 0 0 1-.64.64l-.28 2.5a9.29 9.29 0 0 1-2.28.94l-1.97-1.57a7.65 7.65 0 0 1-.9 0l-1.97 1.57a9.32 9.32 0 0 1-2.28-.94l-.28-2.5a7.59 7.59 0 0 1-.64-.64z" />
      <circle cx="12" cy="12" r="3.75" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M20 20l-4.2-4.2" />
    </>
  ),
  send: <path d="M12 19V5M6 11l6-6 6 6" />,
  clip: <path d="M20 11.5l-8 8a5 5 0 0 1-7-7l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7l-8.4 8.4a1.7 1.7 0 0 1-2.4-2.4l7.6-7.6" />,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  x: <path d="M6 6l12 12M18 6L6 18" />,
  file: (
    <>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
    </>
  ),
  pen: <path d="M4 20h4L19 9l-4-4L4 16z" />,
  term: (
    <>
      <rect x="3" y="4.5" width="18" height="15" rx="3" />
      <path d="M7 10l3 2.5L7 15M12.5 15H17" />
    </>
  ),
  fork: (
    <>
      <circle cx="6" cy="5.5" r="2" />
      <circle cx="18" cy="5.5" r="2" />
      <circle cx="12" cy="18.5" r="2" />
      <path d="M6 7.5v1.5a3 3 0 0 0 3 3h6a3 3 0 0 0 3-3V7.5M12 12v4.5" />
    </>
  ),
  branch: (
    <>
      <circle cx="6" cy="6" r="2" />
      <circle cx="6" cy="18" r="2" />
      <circle cx="18" cy="8" r="2" />
      <path d="M6 8v8M18 10a6 6 0 0 1-6 6H8" />
    </>
  ),
  sync: (
    <>
      <path d="M20 12a8 8 0 0 1-14 5.3M4 12a8 8 0 0 1 14-5.3" />
      <path d="M18 3v4h-4M6 21v-4h4" />
    </>
  ),
  more: (
    <>
      <circle cx="5" cy="12" r="1.3" />
      <circle cx="12" cy="12" r="1.3" />
      <circle cx="19" cy="12" r="1.3" />
    </>
  ),
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  back: <path d="M15 5l-7 7 7 7" />,
  bolt: <path d="M13 3L5 13.5h6L10 21l8-10.5h-6z" />,
  shield: (
    <>
      <path d="M12 3l7.5 3v6c0 4.5-3.2 7.8-7.5 9-4.3-1.2-7.5-4.5-7.5-9V6z" />
      <path d="M9 12l2 2 4-4" />
    </>
  ),
  phone: (
    <>
      <rect x="7" y="2.5" width="10" height="19" rx="2.5" />
      <path d="M11 18.5h2" />
    </>
  ),
  laptop: (
    <>
      <rect x="4.5" y="5" width="15" height="10" rx="1.5" />
      <path d="M2.5 19h19" />
    </>
  ),
  alert: (
    <>
      <path d="M12 4l9 16H3z" />
      <path d="M12 10v4M12 17v.01" />
    </>
  ),
  "wifi-off": (
    <path d="M3 3l18 18M8.5 16a5 5 0 0 1 7 0M5 12.5a10 10 0 0 1 5-2.6M14.5 10a10 10 0 0 1 4.5 2.5M2 9a15 15 0 0 1 4-2.6M11 5.6A15 15 0 0 1 22 9" />
  ),
  download: <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />,
  copy: (
    <>
      <rect x="8" y="8" width="12" height="12" rx="2.5" />
      <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </>
  ),
  moon: <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />,
  bell: (
    <>
      <path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z" />
      <path d="M10 20.5a2 2 0 0 0 4 0" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17M12 3.5c2.5 2.6 2.5 14.4 0 17M12 3.5c-2.5 2.6-2.5 14.4 0 17" />
    </>
  ),
  key: (
    <>
      <circle cx="8" cy="15" r="4" />
      <path d="M11 12l8-8M16 7l2 2M14 9l2 2" />
    </>
  ),
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="15" rx="3" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </>
  ),
  down: <path d="M6 9l6 6 6-6" />,
  restart: (
    <>
      <path d="M4 12a8 8 0 1 0 2.3-5.6" />
      <path d="M4 4v4h4" />
    </>
  ),
  palette: (
    <>
      <path d="M12 18a2.25 2.25 0 0 1 2.25-2.25h4.33a2.25 2.25 0 0 0 2.19-1.75A9.05 9.05 0 0 0 21 11.92c-.04-4.95-4.14-8.97-9.09-8.92a9 9 0 0 0-8.91 9c0 3.92 2.51 6.89 6 8.12A2.25 2.25 0 0 0 12 18z" />
      <circle cx="12" cy="7.13" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="7.88" cy="9.38" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="7.88" cy="14.63" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="16.13" cy="9.38" r="1.1" fill="currentColor" stroke="none" />
    </>
  ),
  trash: (
    <path d="M4 7h16M9.5 7V4.5h5V7M6.5 7l1 12.5A1.5 1.5 0 0 0 9 21h6a1.5 1.5 0 0 0 1.5-1.5l1-12.5M10 11v6M14 11v6" />
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5M12 8v.01" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="10.5" width="14" height="10" rx="2.5" />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
    </>
  ),
  eye: (
    <>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  external: <path d="M14 4h6v6M20 4l-9 9M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" />,
  play: <path d="M8 5.5v13l10.5-6.5z" />,
  stop: <rect x="6" y="6" width="12" height="12" rx="2" />,
  user: (
    <>
      <circle cx="12" cy="8.5" r="3.5" />
      <path d="M5 20a7 7 0 0 1 14 0" />
    </>
  ),
  home: <path d="M4 10.5L12 4l8 6.5V19a1.5 1.5 0 0 1-1.5 1.5H15v-6H9v6H5.5A1.5 1.5 0 0 1 4 19z" />,
} satisfies Record<string, ReactElement>;

export type IconName = keyof typeof drawings;

export const iconNames = Object.keys(drawings) as readonly IconName[];

/**
 * One line icon in the colour of the text around it.
 * Give a `label` only when the icon says something that no text next to it says.
 */
export function Icon({
  name,
  label,
  className,
}: {
  readonly name: IconName;
  readonly label?: string;
  readonly className?: string;
}): ReactElement {
  const naming = label === undefined ? { "aria-hidden": true } : { role: "img", "aria-label": label };
  return (
    <svg
      className={className === undefined ? "icon" : `icon ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...naming}
    >
      {drawings[name]}
    </svg>
  );
}
