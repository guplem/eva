/**
 * Small line icons drawn on a 24 px grid. Each takes the text color, so it follows the theme.
 * An icon is decoration: the text beside it carries the meaning, so a screen reader skips it.
 */
import type { ReactElement } from "react";

export type IconName =
  | "check"
  | "alert"
  | "optional"
  | "chevron-right"
  | "chevron-left"
  | "search"
  | "setup"
  | "engines"
  | "vault"
  | "connections"
  | "access"
  | "personalize"
  | "updates"
  | "copy"
  | "logout"
  | "home";

const paths: Readonly<Record<IconName, ReactElement>> = {
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  alert: <path d="M12 6.5v7M12 17v.5" />,
  optional: <path d="M8 12h8" />,
  "chevron-right": <path d="M9.5 6l6 6-6 6" />,
  "chevron-left": <path d="M14.5 6l-6 6 6 6" />,
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4.5 4.5" />
    </>
  ),
  setup: (
    <>
      <path d="M4 6.5l1.5 1.5 3-3M4 12.5l1.5 1.5 3-3" />
      <path d="M11.5 6.5h8.5M11.5 12.5h8.5M11.5 18.5h8.5" />
      <circle cx="6" cy="18.5" r="1.5" />
    </>
  ),
  engines: (
    <>
      <rect x="6" y="6" width="12" height="12" rx="2" />
      <path d="M10 2.5v3.5M14 2.5v3.5M10 18v3.5M14 18v3.5M2.5 10H6M2.5 14H6M18 10h3.5M18 14h3.5" />
    </>
  ),
  vault: <path d="M3.5 7.5a2 2 0 0 1 2-2H10l2 2.5h6.5a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />,
  connections: (
    <>
      <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
      <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
    </>
  ),
  access: (
    <>
      <rect x="7" y="2.5" width="10" height="19" rx="2.5" />
      <path d="M11 18h2" />
    </>
  ),
  personalize: <path d="M12 3.5l2.1 5.4 5.4 2.1-5.4 2.1-2.1 5.4-2.1-5.4-5.4-2.1 5.4-2.1z" />,
  updates: (
    <>
      <path d="M19.5 12a7.5 7.5 0 0 1-13.2 4.9" />
      <path d="M4.5 12a7.5 7.5 0 0 1 13.2-4.9" />
      <path d="M18 3.5v4h-4M6 20.5v-4h4" />
    </>
  ),
  copy: (
    <>
      <rect x="8.5" y="8.5" width="11" height="11" rx="2" />
      <path d="M15.5 8.5V6.5a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2" />
    </>
  ),
  home: <path d="M4 11l8-7 8 7v8.5a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1z" />,
  logout: (
    <>
      <path d="M14 4.5H7a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h7" />
      <path d="M10.5 12h10M17 8.5l3.5 3.5-3.5 3.5" />
    </>
  ),
};

export function Icon({ name, className }: { readonly name: IconName; readonly className?: string }): ReactElement {
  return (
    <svg
      className={className === undefined ? "icon" : `icon ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {paths[name]}
    </svg>
  );
}
