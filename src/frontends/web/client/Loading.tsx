/**
 * The standard waits of the web page. A wait inside a card shows a `ProgressBar`. A button that
 * waits also shows a `ButtonSpinner`. A wait for content that fills a large area shows a
 * skeleton with the shape of that content.
 */
import { Fragment, type CSSProperties, type ReactElement, type ReactNode } from "react";
import { Icon } from "./icons.tsx";
import { destinations, notificationCenter, type Destination } from "./navigation.ts";
import { settingsSections } from "./settings-routes.ts";

/**
 * A pill bar with the sentence of the wait. A known share (0 to 1) fills the bar and shows the
 * percentage. With no share, lines run across the bar, so the person sees that the work goes on.
 */
export function ProgressBar({
  label,
  share = null,
}: {
  readonly label: string;
  readonly share?: number | null;
}): ReactElement {
  const percent = share === null ? null : Math.round(Math.min(1, Math.max(0, share)) * 100);
  return (
    <div className="progress">
      <div className="progress-text">
        {/* Only the sentence is a status: a percentage that changes each second would talk too much. */}
        <span role="status">{label}</span>
        {percent !== null && (
          <span className="progress-percent" aria-hidden="true">
            {percent}%
          </span>
        )}
      </div>
      <div
        className={percent === null ? "progress-track running" : "progress-track"}
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        {...(percent === null ? {} : { "aria-valuenow": percent })}
      >
        <span className="progress-fill" style={percent === null ? undefined : { width: `${String(percent)}%` }} />
      </div>
    </div>
  );
}

/**
 * The wait inside a button, before its label. A known share (0 to 1) fills the ring, as a
 * `ProgressBar` fills its track. With no share, an arc turns. The label of the button and the
 * `ProgressBar` below it give the words, so a screen reader skips the ring.
 */
export function ButtonSpinner({ share = null }: { readonly share?: number | null }): ReactElement {
  const percent = share === null ? null : Math.round(Math.min(1, Math.max(0, share)) * 100);
  return (
    <svg
      className={percent === null ? "button-spinner running" : "button-spinner"}
      viewBox="0 0 16 16"
      aria-hidden="true"
    >
      <circle className="button-spinner-track" cx="8" cy="8" r="6" />
      {/* A path length of 100 makes the dash of the arc equal to the percentage. */}
      <circle
        className="button-spinner-arc"
        cx="8"
        cy="8"
        r="6"
        pathLength={100}
        strokeDasharray={`${String(percent ?? 28)} 100`}
      />
    </svg>
  );
}

/**
 * The box of a skeleton. The shapes are hidden from a screen reader, which reads the sentence
 * instead, and they take no focus. A skeleton inside a larger one has no sentence of its own.
 *
 * A skeleton reuses the frame of its page: the same elements and classes, so the page CSS puts
 * each part where the real part goes. Only the content is grey. A part that stands for a real
 * part names it in `data-copies`, and `test/e2e/skeletons.spec.ts` checks that both have one place.
 */
function Skeleton({
  label,
  className,
  children,
}: {
  readonly label: string | undefined;
  readonly className: string;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <div className={`skeleton ${className}`} aria-busy="true">
      {label !== undefined && (
        <span className="visually-hidden" role="status">
          {label}
        </span>
      )}
      <div className="skeleton-shapes" aria-hidden="true" inert>
        {children}
      </div>
    </div>
  );
}

/** The real part that a skeleton part stands for, and the edges that must match. All four by default. */
function copies(selector: string, edges?: string): Record<string, string> {
  return edges === undefined ? { "data-copies": selector } : { "data-copies": selector, "data-edges": edges };
}

/** One grey line of text. The width varies, so the lines look like real text. */
function Line({ width, className = "" }: { readonly width: string; readonly className?: string }): ReactElement {
  const style: CSSProperties = { width };
  return <span className={`skeleton-line ${className}`} style={style} />;
}

/** A grey line one text line high in the font around it, so its box has the height of the real text. */
function Text({ width }: { readonly width: string }): ReactElement {
  return (
    <span className="skeleton-text">
      <Line width={width} />
    </span>
  );
}

/**
 * A grey word or icon that is not data, such as a menu label. Its content is invisible, so it
 * has the size of the real word. A grey control, such as a button, is the real element with the
 * `skeleton-ghost` class: it takes the exact size of the real control.
 */
function Ghost({
  className = "",
  children,
}: {
  readonly className?: string;
  readonly children?: ReactNode;
}): ReactElement {
  return <span className={`skeleton-ghost ${className}`}>{children}</span>;
}

const lineWidths = ["72%", "54%", "64%", "46%", "80%", "58%"];

/** The names of a facts list are short words, such as "Eva" or "git". */
const nameWidths = ["40px", "64px", "52px", "72px", "48px"];

/** The names of files and folders in a folder card. */
const fileNameWidths = ["56px", "72px", "48px", "88px", "64px"];

/** The values of a facts list are short too: a version, "Not installed", or a version with a button. */
const valueWidths = ["44px", "52px", "140px", "76px", "48px", "120px"];

function widthAt(index: number): string {
  return lineWidths[index % lineWidths.length] ?? "60%";
}

/** A title or a name is short, and its width in px, because it sits in a row that takes the width of its content. */
function nameWidthAt(index: number): string {
  return nameWidths[index % nameWidths.length] ?? "64px";
}

function indexesOf(count: number): number[] {
  return Array.from({ length: count }, (_, index) => index);
}

/** The rows of a `facts` list, such as the Versions card: a short name, then a value. */
export function FactsSkeleton({ label, rows }: { readonly label: string; readonly rows: number }): ReactElement {
  return (
    <Skeleton label={label} className="facts-skeleton">
      {indexesOf(rows).map((index) => (
        <span key={index} className="skeleton-fact">
          <Line width={nameWidthAt(index)} />
          <Line width={valueWidths[index % valueWidths.length] ?? "64px"} />
        </span>
      ))}
    </Skeleton>
  );
}

/**
 * The items of a list. Each shape copies one list: `chats` the chat list, `projects` the project
 * cards, `files` the card of a folder, and `plain` any other list, such as the releases.
 */
export function ListSkeleton({
  label,
  rows = 6,
  shape = "plain",
}: {
  readonly label?: string;
  readonly rows?: number;
  readonly shape?: "plain" | "chats" | "projects" | "files";
}): ReactElement {
  const indexes = indexesOf(rows);
  return (
    <Skeleton label={label} className={`list-skeleton ${shape}`}>
      {shape === "chats" && (
        <div className="chat-group" {...copies(".chat-group", "left top right")}>
          <h3>
            <Text width="44px" />
          </h3>
          {indexes.map((index) => (
            <span
              key={index}
              className="list-item chat-item"
              {...(index === 0 ? copies(".chat-item", "left top right") : {})}
            >
              <span className="chat-item-title">
                <Text width={widthAt(index)} />
              </span>
              <span className="chat-item-time">
                <Text width="24px" />
              </span>
              <span className="chat-item-preview">
                <Text width={widthAt(index + 3)} />
              </span>
            </span>
          ))}
        </div>
      )}
      {/* The row of tag filters above the cards comes with the projects, so the top of a card can move. */}
      {shape === "projects" &&
        indexes.map((index) => (
          <span key={index} className="project-card" {...(index === 0 ? copies(".project-card", "left right") : {})}>
            <span className="card-row">
              <b>
                <Text width={index % 2 === 0 ? "88px" : "72px"} />
              </b>
              <Ghost className="pill">Active</Ghost>
            </span>
            <span className="card-row muted">
              <Text width="80px" />
            </span>
          </span>
        ))}
      {shape === "files" && (
        <ul className="files-list" {...copies(".files-list", "left top right")}>
          {indexes.map((index) => (
            <li key={index}>
              <span className="files-entry" {...(index === 0 ? copies(".files-entry") : {})}>
                <Ghost className="icon" />
                <Text width={fileNameWidths[index % fileNameWidths.length] ?? "64px"} />
              </span>
            </li>
          ))}
        </ul>
      )}
      {shape === "plain" &&
        indexes.map((index) => (
          <span key={index} className="skeleton-item">
            <Line width={widthAt(index)} className="title" />
            <Line width="32px" className="time" />
            <Line width={widthAt(index + 3)} />
          </span>
        ))}
    </Skeleton>
  );
}

/** The buttons under each answer of Eva. */
const answerActions = ["Retry", "Fork", "Copy"];

/**
 * A chat: a question of the person, then an answer of Eva, twice, and the message box. It uses
 * the classes of the chat, so the visor sits at the bottom of the answer, as in the chat.
 */
function ConversationSkeleton(): ReactElement {
  return (
    <div className="branches">
      <div className="branch">
        {[0, 1].map((turn) => (
          <Fragment key={turn}>
            <div className="msg me">
              <div className="message user" {...(turn === 0 ? copies(".message.user", "top right") : {})}>
                <div className="who">
                  <Text width="22px" />
                </div>
                <Text width={turn === 0 ? "180px" : "120px"} />
              </div>
            </div>
            <div className="msg">
              <span className="mk s skeleton-visor" {...(turn === 0 ? copies(".msg .mk") : {})} />
              <div className="message answer" {...(turn === 0 ? copies(".message.answer", "left top") : {})}>
                <div className="step-fold">
                  <button className="steps-line skeleton-ghost" disabled>
                    <Icon name="check" />
                    <span className="steps-last">
                      <span className="pill step-pill">Command</span>
                    </span>
                  </button>
                </div>
                {/* The first answer is short, as most answers are, so its visor sits where the real one does. */}
                <div className="answer-body">
                  {turn === 1 && <Text width="88%" />}
                  <Text width={turn === 0 ? "56%" : "68%"} />
                </div>
                <div className="answer-actions">
                  {answerActions.map((action) => (
                    <button key={action} className="ghost" disabled>
                      <Ghost className="icon" />
                      <Ghost>{action}</Ghost>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </Fragment>
        ))}
        <div className="composer">
          <div className="composer-box" {...copies(".composer-box")}>
            <span className="skeleton-composer-text">
              <Text width="96px" />
            </span>
            <div className="composer-row">
              <Ghost className="icon composer-icon" />
              <Ghost className="composer-chip" />
              <span className="grow" />
              <button className="send skeleton-ghost" disabled {...copies(".composer .send")} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** A column of cards, such as the settings: a title, a description and a body. */
export function CardsSkeleton({
  label,
  cards = 3,
}: {
  readonly label?: string;
  readonly cards?: number;
}): ReactElement {
  return (
    <Skeleton label={label} className="cards-skeleton">
      {indexesOf(cards).map((index) => (
        <span key={index} className="skeleton-card">
          <Line width={index % 2 === 0 ? "36%" : "28%"} className="title" />
          <Line width={widthAt(index + 4)} />
          <span className="skeleton-block" />
        </span>
      ))}
    </Skeleton>
  );
}

/** The Settings page: the list of sections, the header with the search, and the cards. */
export function SettingsSkeleton({ label }: { readonly label?: string }): ReactElement {
  return (
    <Skeleton label={label} className="main settings-main">
      <div className="settings-shell">
        <div className="settings-nav" {...copies(".settings-nav")}>
          {["Overview", ...settingsSections.map((section) => section.title)].map((title, index) => (
            <button
              key={title}
              className="nav-item"
              disabled
              {...(index === 0 ? copies(".settings-nav .nav-item", "left top right") : {})}
            >
              <Ghost className="icon" />
              <Ghost>{title}</Ghost>
            </button>
          ))}
        </div>
        <div className="settings-content">
          <header className="settings-header" {...copies(".settings-header", "left top right")}>
            <h1>
              <Text width="120px" />
            </h1>
            <label className="search-field skeleton-ghost" {...copies(".settings-header .search-field")}>
              <Icon name="search" />
              <input disabled placeholder="Search settings" />
            </label>
            <button className="restart-button skeleton-ghost" disabled {...copies(".restart-button")}>
              <Icon name="restart" />
              Restart Eva
            </button>
          </header>
          <div className="settings-page">
            <CardsSkeleton />
          </div>
        </div>
      </div>
    </Skeleton>
  );
}

/** The chat list, beside a chat: its title, the New button and the search. */
function ChatListSkeleton(): ReactElement {
  return (
    <div className="sidebar has-list">
      <div className="sidebar-list">
        <div className="chat-list-header" {...copies(".chat-list-header", "left top right")}>
          <h2>Chats</h2>
          <button className="primary wide-only skeleton-ghost" disabled {...copies(".chat-list-header .primary")}>
            <Icon name="plus" /> New
          </button>
        </div>
        <label className="chat-search skeleton-ghost" {...copies(".chat-search")}>
          <Icon name="search" />
          <input disabled placeholder="Search chats" />
        </label>
        <ListSkeleton shape="chats" rows={5} />
      </div>
    </div>
  );
}

/** The project list: its title, the New project button, the search and the status filters. */
function ProjectListSkeleton(): ReactElement {
  return (
    <div className="sidebar">
      <div className="list-title-row" {...copies(".list-title-row", "left top right")}>
        <h2 className="list-title">Projects</h2>
        <button className="primary skeleton-ghost" disabled {...copies(".list-title-row .primary")}>
          <Icon name="plus" /> New project
        </button>
      </div>
      <input
        className="project-search skeleton-ghost"
        disabled
        placeholder="Search projects"
        {...copies(".project-search")}
      />
      <div className="filter-chips">
        {["Active", "Idea", "Paused", "Closed"].map((status, index) => (
          <button
            key={status}
            className="filter-chip skeleton-ghost"
            disabled
            {...(index === 0 ? copies(".filter-chip") : {})}
          >
            {status}
          </button>
        ))}
      </div>
      <ListSkeleton shape="projects" rows={3} />
    </div>
  );
}

/** The header of a chat: the name of the chat, and the button that opens the list on a phone. */
function ChatHeaderSkeleton(): ReactElement {
  return (
    <div className="main-header chat-header" {...copies(".main-header")}>
      <button className="menu-button icon-button" disabled {...copies(".menu-button")}>
        <Ghost className="icon" />
      </button>
      <div className="header-text">
        <h1>
          <Text width="180px" />
        </h1>
        <div className="sub">
          <Text width="140px" />
        </div>
      </div>
    </div>
  );
}

/** The details at the right of a chat, when the person keeps them shown. */
function ChatPanelSkeleton(): ReactElement {
  return (
    <div className="chat-panel-frame open" {...copies(".chat-panel-frame")}>
      <div className="chat-panel">
        <h2>
          <Text width="72px" />
        </h2>
        {indexesOf(6).map((index) => (
          <Line key={index} width={widthAt(index)} />
        ))}
      </div>
    </div>
  );
}

/** The Files page: the folder path, the search and the first folder. */
function FilesSkeleton(): ReactElement {
  return (
    <div className="main">
      <div className="files-page">
        <div className="files-header" {...copies(".files-header", "left top right")}>
          <div className="files-crumbs">
            <h1>
              <Ghost>Vault</Ghost>
            </h1>
          </div>
          <div className="files-download">
            <button className="ghost" disabled {...copies(".files-download button")}>
              <Ghost className="icon" />
              <Ghost className="files-download-label">Download as zip</Ghost>
            </button>
          </div>
        </div>
        <div className="files-search">
          <div className="search-field skeleton-ghost" {...copies(".files-search .search-field")}>
            <label className="files-search-text">
              <Icon name="search" />
              <input disabled placeholder="Search the vault" />
            </label>
            <button className="choice-chip files-search-inside" disabled>
              Inside files
            </button>
          </div>
        </div>
        <div className="files-columns">
          <div className="files-pane">
            <ListSkeleton shape="files" rows={5} />
          </div>
        </div>
      </div>
    </div>
  );
}

/** The Schedules page: its title, the add button and the cards. */
function SchedulesSkeleton(): ReactElement {
  return (
    <div className="main">
      <div className="schedules-page">
        <div className="schedules-header" {...copies(".schedules-header", "left top right")}>
          <div className="schedules-title">
            <h1>Schedules</h1>
            <div className="schedules-subtitle">
              <Text width="160px" />
            </div>
          </div>
          <button className="primary schedules-add skeleton-ghost" disabled {...copies(".schedules-add")}>
            <Icon name="plus" />
            <span className="schedules-add-text">Add schedule</span>
          </button>
        </div>
        <div className="schedules-column">
          <CardsSkeleton cards={2} />
        </div>
      </div>
    </div>
  );
}

/** The main navigation: the visor, a button for each destination, and Settings at the end. */
function MainNavSkeleton({ current }: { readonly current: Destination }): ReactElement {
  const button = (destination: (typeof destinations)[number]): ReactElement => (
    <button
      key={destination.id}
      className={`nav-button nav-${destination.id}`}
      disabled
      aria-current={destination.id === current ? "page" : undefined}
      {...copies(`.main-nav .nav-${destination.id}`)}
    >
      <span className="nav-icon">
        <Ghost className="nav-glyph">
          <Icon name={destination.icon} />
        </Ghost>
      </span>
      <span className="nav-label">
        <Ghost>{destination.label}</Ghost>
      </span>
    </button>
  );
  return (
    <div className="main-nav">
      <button className="main-nav-visor" disabled {...copies(".main-nav-visor")}>
        <span className="nav-icon">
          <span className="mk skeleton-visor" />
        </span>
        <span className="nav-label">
          <Ghost>Eva</Ghost>
        </span>
      </button>
      {destinations.filter((destination) => destination.id !== "settings").map(button)}
      <span className="nav-spacer" />
      {destinations.filter((destination) => destination.id === "settings").map(button)}
    </div>
  );
}

/**
 * The first load of the page, before Eva answers: the navigation, then the shape of the page
 * that opens. A chat shows the chat list, the chat and, when the person keeps them shown, its details.
 */
export function AppSkeleton({
  page,
  chatPanel = false,
  project = "list",
}: {
  readonly page: Destination;
  /** The page of Projects that opens: the list, a project, or one of its chats. */
  readonly project?: "list" | "page" | "chat";
  /** The person keeps the details of a chat shown. */
  readonly chatPanel?: boolean;
}): ReactElement {
  return (
    <Skeleton label="Loading Eva…" className="app">
      <MainNavSkeleton current={page} />
      <div className="app-body">
        {page === "chats" && (
          <div className="layout">
            <ChatListSkeleton />
            <div className="main">
              <ChatHeaderSkeleton />
              <ConversationSkeleton />
            </div>
            {chatPanel && <ChatPanelSkeleton />}
          </div>
        )}
        {page === "projects" &&
          (project === "list" ? (
            <div className="layout list-home">
              <ProjectListSkeleton />
              <div className="main" />
            </div>
          ) : (
            <div className="layout">
              <ProjectListSkeleton />
              <div className="main">
                {project === "chat" ? (
                  <>
                    <ChatHeaderSkeleton />
                    <ConversationSkeleton />
                  </>
                ) : (
                  <div className="page-skeleton">
                    <CardsSkeleton cards={2} />
                  </div>
                )}
              </div>
              {project === "chat" && chatPanel && <ChatPanelSkeleton />}
            </div>
          ))}
        {page === "files" && <FilesSkeleton />}
        {page === "schedules" && <SchedulesSkeleton />}
        {page === "settings" && <SettingsSkeleton />}
        {page === notificationCenter && (
          <div className="main">
            <div className="page-skeleton">
              <CardsSkeleton />
            </div>
          </div>
        )}
      </div>
    </Skeleton>
  );
}
