/**
 * The standard waits of the web page. A wait inside a card shows a `ProgressBar`. A wait for
 * content that fills a large area shows a skeleton with the shape of that content.
 */
import type { CSSProperties, ReactElement, ReactNode } from "react";

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
 * The box of a skeleton. The shapes are hidden from a screen reader, which reads the sentence
 * instead. A skeleton inside a larger one has no sentence of its own.
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
      <div className="skeleton-shapes" aria-hidden="true">
        {children}
      </div>
    </div>
  );
}

/** One grey line of text. The width varies, so the lines look like real text. */
function Line({ width, className = "" }: { readonly width: string; readonly className?: string }): ReactElement {
  const style: CSSProperties = { width };
  return <span className={`skeleton-line ${className}`} style={style} />;
}

const lineWidths = ["72%", "54%", "64%", "46%", "80%", "58%"];

/** The names of a facts list are short words, such as "Eva" or "git". */
const nameWidths = ["40px", "64px", "52px", "72px", "48px"];

function widthAt(index: number): string {
  return lineWidths[index % lineWidths.length] ?? "60%";
}

/** The rows of a `facts` list, such as the Versions card: a short name, then a value. */
export function FactsSkeleton({ label, rows }: { readonly label: string; readonly rows: number }): ReactElement {
  return (
    <Skeleton label={label} className="facts-skeleton">
      {Array.from({ length: rows }, (_, index) => (
        <span key={index} className="skeleton-fact">
          <Line width={nameWidths[index % nameWidths.length] ?? "64px"} />
          <Line width={widthAt(index)} />
        </span>
      ))}
    </Skeleton>
  );
}

/** The items of a side list, such as the chat list: a title, a time and a line of text. */
export function ListSkeleton({ label, rows = 6 }: { readonly label?: string; readonly rows?: number }): ReactElement {
  return (
    <Skeleton label={label} className="list-skeleton">
      {Array.from({ length: rows }, (_, index) => (
        <span key={index} className="skeleton-item">
          <Line width={widthAt(index)} className="title" />
          <Line width="32px" className="time" />
          <Line width={widthAt(index + 3)} />
        </span>
      ))}
    </Skeleton>
  );
}

/** A chat: a question of the person, then an answer of Eva beside her visor, twice. */
export function ConversationSkeleton({ label }: { readonly label?: string }): ReactElement {
  return (
    <Skeleton label={label} className="conversation-skeleton">
      {[0, 1].map((turn) => (
        <span key={turn} className="skeleton-turn">
          <span className="skeleton-bubble user">
            <Line width={turn === 0 ? "180px" : "120px"} />
          </span>
          <span className="skeleton-answer">
            <span className="skeleton-visor" />
            <span className="skeleton-bubble answer">
              <Line width="92%" />
              <Line width="80%" />
              <Line width={turn === 0 ? "56%" : "68%"} />
            </span>
          </span>
        </span>
      ))}
    </Skeleton>
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
      {Array.from({ length: cards }, (_, index) => (
        <span key={index} className="skeleton-card">
          <Line width={index % 2 === 0 ? "36%" : "28%"} className="title" />
          <Line width={widthAt(index + 4)} />
          <span className="skeleton-block" />
        </span>
      ))}
    </Skeleton>
  );
}

/**
 * The first load of the page, before Eva answers: the navigation, then the shape of the page
 * that opens. A chat page shows the list and a chat, a project page the list and cards, and
 * any other page its cards.
 */
export function AppSkeleton({ page }: { readonly page: "chat" | "list" | "cards" }): ReactElement {
  return (
    <Skeleton label="Loading Eva…" className="app">
      <div className="main-nav">
        <span className="main-nav-visor">
          <span className="skeleton-visor large" />
        </span>
        {[0, 1, 2, 3].map((index) => (
          <span key={index} className="skeleton-nav-button" />
        ))}
      </div>
      <div className="app-body">
        {page === "cards" ? (
          <div className="main">
            <div className="page-skeleton">
              <CardsSkeleton />
            </div>
          </div>
        ) : (
          <div className={page === "list" ? "layout list-home" : "layout"}>
            <div className="sidebar has-list">
              <div className="sidebar-list">
                <ListSkeleton />
              </div>
            </div>
            <div className="main">
              {page === "chat" ? (
                <ConversationSkeleton />
              ) : (
                <div className="page-skeleton">
                  <CardsSkeleton cards={2} />
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </Skeleton>
  );
}
