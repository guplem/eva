/**
 * The main navigation of the EVE shell: a nav rail on a computer and a bottom tab bar on a phone.
 * It is one element that the stylesheet places, so each destination has one accessible name.
 */
import { useEffect, useState, useSyncExternalStore, type ReactElement } from "react";
import { Icon } from "./icons.tsx";
import { navChoice, onNavChoiceChange, shownDestinations } from "./nav-choice.ts";
import {
  bellName,
  navVisorProjectEyes,
  navVisorState,
  tapFace,
  tapFaceMs,
  type NavVisorInput,
  type VisorSignal,
} from "./nav-visor.ts";
import { currentNavButton, navBadges, type Destination, type NavEntry } from "./navigation.ts";
import { useSpecialDay } from "./FestiveDay.tsx";
import { Visor } from "./Visor.tsx";
import { stateFaces, type Face } from "./visor-faces.ts";

interface MainNavProps extends NavVisorInput {
  readonly current: Destination;
  /** The home page, the New chat page of Chats, shows: the visor is the current button (#761). */
  readonly homeShown: boolean;
  readonly isPhone: boolean;
  readonly onOpen: (destination: Destination) => void;
  /** A tap on the visor opens the home page (#761). */
  readonly onHome: () => void;
  readonly setupMissing: number;
  /** An unread problem is an error, so the count is red. */
  readonly unreadError: boolean;
  /** The count and the dot of the visor. The bell of the home page shows the same signal. */
  readonly signal: VisorSignal;
  /** The Assistant chats with an answer that the person did not see. */
  readonly unreadChats: number;
  /** The Project chats with an answer that the person did not see. */
  readonly unreadProjectChats: number;
}

export function MainNav(props: MainNavProps): ReactElement {
  const { current, onOpen, approvals, setupMissing, signal } = props;
  const visor = navVisorState(props);
  const shownButton = currentNavButton(current, props.homeShown);
  const offline = !props.isConnected;
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
  // A tap opens the home page and plays a playful face for a moment. Then the face of the main state comes back.
  const [tapped, setTapped] = useState<{ face: Face } | null>(null);
  useEffect(() => {
    if (tapped === null) return undefined;
    const timer = setTimeout(() => setTapped(null), tapFaceMs);
    return () => clearTimeout(timer);
  }, [tapped]);
  const badges = navBadges({
    approvals,
    setupMissing,
    unreadChats: props.unreadChats,
    unreadProjectChats: props.unreadProjectChats,
  });
  const shown = shownDestinations(useSyncExternalStore(onNavChoiceChange, navChoice), props.isPhone);
  const button = (destination: NavEntry): ReactElement => {
    const badge = badges[destination.id];
    return (
      <button
        key={destination.id}
        className={`nav-button nav-${destination.id}`}
        data-tooltip={destination.label}
        data-tooltip-side="right"
        aria-current={destination.id === shownButton ? "page" : undefined}
        onClick={() => onOpen(destination.id)}
      >
        <span className="nav-icon">
          <Icon name={destination.icon} />
        </span>
        <span className="nav-label">{destination.label}</span>
        {badge !== undefined && (
          <span className={`nav-badge${badge.tone === "news" ? " news" : ""}`}>
            {badge.count}
            <span className="visually-hidden"> {badge.words}</span>
          </span>
        )}
      </button>
    );
  };
  // The visor opens the home page (#761). On a phone it is the last tab, and the home page has a gear for Settings.
  // On a computer, Settings stays out of the part that scrolls, so a low window still shows it (#911).
  return (
    <nav className="main-nav" aria-label="Main">
      <button
        className="main-nav-visor"
        aria-label={name}
        aria-current={shownButton === "visor" ? "page" : undefined}
        data-tooltip={visor.words}
        data-tooltip-side="right"
        onClick={() => {
          // A playful face would hide that Eva does not answer.
          if (!offline) setTapped((last) => ({ face: tapFace(Math.random, last?.face) }));
          props.onHome();
        }}
      >
        <span className="nav-icon">
          <Visor
            size={36}
            face={tapped?.face ?? visor.face}
            festive={tapped === null ? festive : null}
            alarm={tapped === null && alarm}
            projectEyes={projectEyes}
            offline={offline && tapped === null}
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
      <div className="main-nav-scroll">{shown.filter((destination) => destination.id !== "settings").map(button)}</div>
      {shown.filter((destination) => destination.id === "settings").map(button)}
    </nav>
  );
}

/**
 * The buttons at the right of the home page's header (#761). The bell opens the notification center,
 * with the count and the dot of the visor. A phone shows a Settings tab only when the person chooses it,
 * so it always shows a gear too.
 */
export function HomeButtons({
  signal,
  unreadError,
  isPhone,
  onNotifications,
  onSettings,
}: {
  readonly signal: VisorSignal;
  readonly unreadError: boolean;
  readonly isPhone: boolean;
  readonly onNotifications: () => void;
  readonly onSettings: () => void;
}): ReactElement {
  return (
    <div className="home-buttons">
      <button
        className="icon-button home-bell"
        aria-label={bellName(signal)}
        data-tooltip="Notifications"
        onClick={onNotifications}
      >
        <Icon name="bell" />
        {signal.count > 0 && (
          <span className={`nav-badge${unreadError ? " bad" : ""}`} aria-hidden="true">
            {signal.count}
          </span>
        )}
        {signal.dot && <span className="nav-dot" aria-hidden="true" />}
      </button>
      {isPhone && (
        <button className="icon-button" aria-label="Settings" data-tooltip="Settings" onClick={onSettings}>
          <Icon name="gear" />
        </button>
      )}
    </div>
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

/**
 * The arrow to the page above, such as from a chat to its project. With `text`, the button also
 * names that page, such as "Projects", so it shows on a computer too (#840).
 */
export function BackButton({
  label,
  onClick,
  className = "",
  text,
}: {
  readonly label: string;
  readonly onClick: () => void;
  readonly className?: string;
  readonly text?: string;
}): ReactElement {
  return (
    <button
      className={`${text === undefined ? "icon-button" : "back-named"} ${className}`}
      aria-label={label}
      onClick={onClick}
    >
      <Icon name="back" />
      {text}
    </button>
  );
}
