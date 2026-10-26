/**
 * The main navigation of the EVE shell: a nav rail on a computer and a bottom tab bar on a phone.
 * It is one element that the stylesheet places, so each destination has one accessible name.
 */
import { useEffect, useState, type ReactElement } from "react";
import { Icon } from "./icons.tsx";
import {
  navVisorProjectEyes,
  navVisorState,
  tapFace,
  tapFaceMs,
  visorSignal,
  type NavVisorInput,
} from "./nav-visor.ts";
import { destinations, notificationCenter, type Destination } from "./navigation.ts";
import { useSpecialDay } from "./FestiveDay.tsx";
import { Visor } from "./Visor.tsx";
import { stateFaces, type Face } from "./visor-faces.ts";

interface MainNavProps extends NavVisorInput {
  readonly current: Destination;
  readonly isPhone: boolean;
  readonly onOpen: (destination: Destination) => void;
  readonly setupMissing: number;
  /** An unread problem is an error, so the visor's crosses pulse. */
  readonly unreadError: boolean;
  /** An unread entry of the history, or a setup step that is left. */
  readonly news: boolean;
}

export function MainNav(props: MainNavProps): ReactElement {
  const { current, onOpen, approvals, setupMissing } = props;
  const visor = navVisorState(props);
  const signal = visorSignal({ ...props, centerOpen: current === notificationCenter });
  // Only the crossed face pulses: an approval or an offline face would only borrow the red.
  const alarm = signal.alarm && visor.face === stateFaces.broken;
  // The visible label "Eva" starts the name, so a voice command that says it finds the button.
  // The count is in the words. The dot, which has no words, adds its own.
  const name = `Eva: ${visor.words}${signal.dot ? ". Something new waits" : ""}`;
  const projectEyes = navVisorProjectEyes(current, props.isPhone);
  // At rest, on a special day, the visor wears that day's eyes. Any state that informs comes first,
  // and so do the Project eyes: they are the phone's only sign of the mode.
  const day = useSpecialDay();
  const festive = visor.face === stateFaces.idle && !projectEyes ? (day?.id ?? null) : null;
  // A tap opens the center and plays a playful face for a moment. Then the face of the main state comes back.
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
        className={`nav-button nav-${destination.id}`}
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
  // The visor opens the notification center. On a phone it takes the place of Settings, which the center links to.
  return (
    <nav className="main-nav" aria-label="Main">
      <button
        className="main-nav-visor"
        aria-label={name}
        aria-current={current === notificationCenter ? "page" : undefined}
        data-tooltip={visor.words}
        data-tooltip-side="right"
        onClick={() => {
          setTapped((last) => ({ face: tapFace(Math.random, last?.face) }));
          onOpen(notificationCenter);
        }}
      >
        <span className="nav-icon">
          <Visor
            size={36}
            face={tapped?.face ?? visor.face}
            festive={tapped === null ? festive : null}
            alarm={tapped === null && alarm}
            projectEyes={projectEyes}
          />
          {signal.count > 0 && (
            <span className={`nav-badge${props.unreadError ? " bad" : ""}`} aria-hidden="true">
              {signal.count}
            </span>
          )}
          {signal.dot && <span className="nav-dot" aria-hidden="true" />}
        </span>
        <span className="nav-label" aria-hidden="true">
          Eva
        </span>
      </button>
      {destinations.filter((destination) => destination.id !== "settings").map(button)}
      <span className="nav-spacer" />
      {destinations.filter((destination) => destination.id === "settings").map(button)}
    </nav>
  );
}

/**
 * Opens the chat or project list. Only a phone shows it, because a computer always shows the list.
 * A dot tells a phone that the hidden list has an unread chat.
 */
export function ShowListButton({
  onClick,
  unread = false,
}: {
  readonly onClick: () => void;
  readonly unread?: boolean;
}): ReactElement {
  return (
    <button
      className="menu-button icon-button"
      aria-label={unread ? "Show the list (unread)" : "Show the list"}
      onClick={onClick}
    >
      <Icon name="menu" />
      {unread && <span className="unread-dot" />}
    </button>
  );
}

/** The arrow to the page above, such as from a chat to its project. */
export function BackButton({
  label,
  onClick,
  className = "",
}: {
  readonly label: string;
  readonly onClick: () => void;
  readonly className?: string;
}): ReactElement {
  return (
    <button className={`icon-button ${className}`} aria-label={label} onClick={onClick}>
      <Icon name="back" />
    </button>
  );
}
