/**
 * The main navigation of the EVE shell: a nav rail on a computer and a bottom tab bar on a phone.
 * It is one element that the stylesheet places, so each destination has one accessible name.
 */
import type { ReactElement } from "react";
import { Icon } from "./icons.tsx";
import { destinations, type Destination } from "./navigation.ts";
import { Visor } from "./Visor.tsx";
import { stateFaces } from "./visor-faces.ts";

interface MainNavProps {
  readonly current: Destination;
  readonly onOpen: (destination: Destination) => void;
  /** The approvals that wait, of any chat. */
  readonly approvals: number;
  readonly setupMissing: number;
  readonly isConnected: boolean;
}

export function MainNav({ current, onOpen, approvals, setupMissing, isConnected }: MainNavProps): ReactElement {
  // The visible badge is only a number. The hidden words say what it counts.
  const badges: Partial<Record<Destination, { count: number; words: string }>> = {
    chats: { count: approvals, words: approvals === 1 ? "approval waits" : "approvals wait" },
    settings: { count: setupMissing, words: "to set up" },
  };
  const button = (destination: (typeof destinations)[number]): ReactElement => {
    const badge = badges[destination.id];
    return (
      <button
        key={destination.id}
        className="nav-button"
        data-tooltip={destination.label}
        data-tooltip-side="right"
        aria-current={destination.id === current ? "page" : undefined}
        onClick={() => onOpen(destination.id)}
      >
        <span className="nav-icon">
          <Icon name={destination.icon} />
        </span>
        <span className="nav-label">{destination.label}</span>
        {badge !== undefined && badge.count > 0 && (
          <span className="nav-badge">
            {badge.count}
            <span className="visually-hidden"> {badge.words}</span>
          </span>
        )}
      </button>
    );
  };
  // The rail keeps Settings at its foot. The visor and the "Reconnecting…" banner say when Eva is offline.
  return (
    <nav className="main-nav" aria-label="Main">
      <span className="main-nav-visor">
        <Visor size={36} face={isConnected ? stateFaces.idle : stateFaces.offline} />
      </span>
      {destinations.filter((destination) => destination.id !== "settings").map(button)}
      <span className="nav-spacer" />
      {destinations.filter((destination) => destination.id === "settings").map(button)}
    </nav>
  );
}

/** Opens the chat or project list. Only a phone shows it, because a computer always shows the list. */
export function ShowListButton({ onClick }: { readonly onClick: () => void }): ReactElement {
  return (
    <button className="menu-button icon-button" aria-label="Show the list" onClick={onClick}>
      <Icon name="menu" />
    </button>
  );
}
