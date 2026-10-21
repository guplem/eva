/**
 * The main navigation of the EVE shell: a nav rail on a computer and a bottom tab bar on a phone.
 * It is one element that the stylesheet places, so each destination has one accessible name.
 */
import { useEffect, useState, type ReactElement } from "react";
import { Icon } from "./icons.tsx";
import { navVisorState, tapFace, tapFaceMs, type NavVisorInput } from "./nav-visor.ts";
import { destinations, type Destination } from "./navigation.ts";
import { useSpecialDay, Visor } from "./Visor.tsx";
import { stateFaces, type Face } from "./visor-faces.ts";

interface MainNavProps extends NavVisorInput {
  readonly current: Destination;
  readonly onOpen: (destination: Destination) => void;
  readonly setupMissing: number;
}

export function MainNav(props: MainNavProps): ReactElement {
  const { current, onOpen, approvals, setupMissing } = props;
  const visor = navVisorState(props);
  // At rest, on a special day, the visor wears that day's eyes. Any state that informs comes first.
  const day = useSpecialDay();
  const festive = visor.face === stateFaces.idle ? (day?.id ?? null) : null;
  // A tap plays a playful face for a moment. Then the face of the main state comes back.
  const [tapped, setTapped] = useState<{ face: Face } | null>(null);
  useEffect(() => {
    if (tapped === null) return undefined;
    const timer = setTimeout(() => setTapped(null), tapFaceMs);
    return () => clearTimeout(timer);
  }, [tapped]);
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
      <button
        className="main-nav-visor"
        aria-label={visor.words}
        data-tooltip={visor.words}
        data-tooltip-side="right"
        onClick={() => setTapped((last) => ({ face: tapFace(Math.random, last?.face) }))}
      >
        <Visor size={36} face={tapped?.face ?? visor.face} festive={tapped === null ? festive : null} />
      </button>
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
