/**
 * The page that a chat pins (#1130). A wide window shows it in a column at the right of the chat,
 * with a divider for its width. A phone and a narrow window show it as a bar above the message box,
 * and a tap opens it in full screen. Both show the same frame as the bubble, with the same rules.
 */
import {
  useCallback,
  useEffect,
  useState,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from "react";
import { ColumnDivider } from "./ColumnDivider.tsx";
import { useShowError } from "./error-toast.tsx";
import { Icon } from "./icons.tsx";
import { ChatPages, useChatPages, useChatPageState } from "./page-context.ts";
import { PageFrame, PageFullScreen } from "./PageFrame.tsx";
import {
  chatMinWidth,
  pageName,
  pinnedDefaultWidth,
  pinnedLayout,
  pinnedMinWidth,
  type PinnedLayout,
} from "./page-frames.ts";

/** Each browser keeps its own width, as for a column of the Files page: a view choice, not a setting. */
const widthKey = "eva-pinned-page-width";
/** The width of the chat list beside a chat on a computer. Keep it in step with `.layout` in `styles.css`. */
const listWidth = 300;
/** The widths of a phone: the pinned page is always the bar there. Keep it in step with the phone rules. */
const phoneQuery = "(max-width: 760px)";

function keptWidth(): number {
  try {
    const kept = Number(localStorage.getItem(widthKey));
    return Number.isFinite(kept) && kept >= pinnedMinWidth ? kept : pinnedDefaultWidth;
  } catch {
    return pinnedDefaultWidth;
  }
}

/** Where the pinned page shows in the chat layout, and the width that the person chose. */
export function usePinnedLayout(layout: RefObject<HTMLElement | null>): PinnedLayout & {
  /** The widest column that still leaves the chat its width. */
  readonly maxWidth: number;
  readonly onWidth: (width: number | null) => void;
} {
  const [width, setWidth] = useState(keptWidth);
  const [layoutWidth, setLayoutWidth] = useState(0);
  const [phone, setPhone] = useState(() => window.matchMedia(phoneQuery).matches);
  useEffect(() => {
    const element = layout.current;
    if (element === null) return undefined;
    const observer = new ResizeObserver(() => setLayoutWidth(element.clientWidth));
    observer.observe(element);
    setLayoutWidth(element.clientWidth);
    const query = window.matchMedia(phoneQuery);
    const onChange = (): void => setPhone(query.matches);
    query.addEventListener("change", onChange);
    return () => {
      observer.disconnect();
      query.removeEventListener("change", onChange);
    };
  }, [layout]);
  const onWidth = useCallback((next: number | null): void => {
    const chosen = next ?? pinnedDefaultWidth;
    setWidth(chosen);
    try {
      if (next === null) localStorage.removeItem(widthKey);
      else localStorage.setItem(widthKey, String(chosen));
    } catch {
      // The width still applies until the page reloads.
    }
  }, []);
  const place = pinnedLayout({ layout: phone ? 0 : layoutWidth, list: listWidth, column: width, inspector: true });
  return { ...place, maxWidth: Math.max(pinnedMinWidth, layoutWidth - listWidth - chatMinWidth), onWidth };
}

/** A key that changes when a turn of the chat or of one of its forks ends. */
export function turnsKey(
  tree: readonly { readonly id: string; readonly turns: readonly unknown[]; readonly lastTurnAt: string | null }[],
): string {
  return tree.map((session) => `${session.id}:${String(session.turns.length)}:${session.lastTurnAt ?? ""}`).join(" ");
}

/**
 * The pages of a chat that pins nothing, such as a Project chat: a Project chat gets no prompt of
 * Eva, so only Save shows. Its frames still load their page again after each turn.
 */
export function UnpinnedChatPages({
  tree,
  children,
}: {
  readonly tree: Parameters<typeof turnsKey>[0];
  readonly children: ReactNode;
}): ReactElement {
  return <ChatPages.Provider value={useChatPageState(turnsKey(tree), null, null)}>{children}</ChatPages.Provider>;
}

/** The column at the right of the chat. Its header names the page and unpins it. */
export function PinnedColumn({
  path,
  width,
  maxWidth,
  onWidth,
}: {
  readonly path: string;
  readonly width: number;
  /** The widest column that still leaves the chat its width. */
  readonly maxWidth: () => number;
  readonly onWidth: (width: number | null) => void;
}): ReactElement {
  const name = pageName(path);
  return (
    <aside
      className="pinned-page"
      aria-label={`Pinned page: ${name}`}
      style={{ "--pinned-width": `${String(width)}px` } as CSSProperties}
    >
      <ColumnDivider
        label="Width of the pinned page"
        side="left"
        minWidth={pinnedMinWidth}
        maxSize={maxWidth}
        sizeVariable="--pinned-width"
        onWidth={onWidth}
      />
      <header className="pinned-page-header">
        <Icon name="pin" />
        <h2 title={path}>{name}</h2>
        <UnpinButton name={name} />
      </header>
      {/* A new pin is a new page, so its frame starts again. */}
      <PageFrame key={path} path={path} place="column" />
    </aside>
  );
}

/** The bar above the message box. A tap opens the page in full screen. */
export function PinnedBar({ path }: { readonly path: string }): ReactElement {
  const [full, setFull] = useState(false);
  const close = useCallback(() => setFull(false), []);
  const name = pageName(path);
  return (
    <div className="pinned-bar" role="group" aria-label="Pinned page">
      <button
        type="button"
        className="pinned-bar-open"
        aria-label={`Open ${name} in full screen`}
        onClick={() => setFull(true)}
      >
        <Icon name="pin" />
        <span className="pinned-bar-name">{name}</span>
        <Icon name="expand" />
      </button>
      <UnpinButton name={name} />
      {full && <PageFullScreen path={path} page={null} onClose={close} />}
    </div>
  );
}

function UnpinButton({ name }: { readonly name: string }): ReactElement | null {
  const { onPin, onChanged } = useChatPages();
  const showError = useShowError();
  const [busy, setBusy] = useState(false);
  if (onPin === null) return null;
  const unpin = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      await onPin(null);
      onChanged();
    } catch (caught) {
      showError(caught);
      setBusy(false);
    }
  };
  return (
    <button
      type="button"
      className="icon-button"
      aria-label={`Unpin ${name}`}
      data-tooltip="Unpin. The page stays saved."
      aria-busy={busy}
      onClick={() => void unpin()}
    >
      <Icon name="x" />
    </button>
  );
}
