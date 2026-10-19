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
  return (
    <nav className="main-nav" aria-label="Main">
      <span className="main-nav-visor">
        <Visor size={36} face={isConnected ? stateFaces.idle : stateFaces.offline} />
      </span>
      {destinations.map((destination) => {
        const badge = badges[destination.id];
        return (
          <button
            key={destination.id}
            className="nav-button"
            title={destination.label}
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
      })}
      <span className="nav-spacer" />
      <span
        className={`online-dot${isConnected ? "" : " offline"}`}
        role="img"
        aria-label={isConnected ? "Eva is online" : "Eva does not answer"}
        title={isConnected ? "Eva is online" : "Eva does not answer"}
      />
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

/** The header of a phone page that has no header of its own, so the list is always in reach. */
export function PhoneListHeader({
  title,
  onShowList,
}: {
  readonly title?: string;
  readonly onShowList: () => void;
}): ReactElement {
  return (
    <div className="main-header phone-only">
      <ShowListButton onClick={onShowList} />
      {title !== undefined && <h1>{title}</h1>}
    </div>
  );
}
