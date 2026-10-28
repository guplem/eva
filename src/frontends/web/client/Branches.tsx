/**
 * The parts that pick the branch of a chat that the page shows: the switcher at a fork point, the
 * branch map, and on a phone the header button that opens the map in a bottom sheet.
 */
import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import { createPortal } from "react-dom";
import { api, type SessionRecord } from "./api.ts";
import {
  branchMap,
  branchNames,
  branchStates,
  firstShownBranch,
  pickedBranch,
  type BranchState,
  type ForkPoint,
  type MapLine,
  type MapRow,
} from "./branch-path.ts";
import { DeleteQuestion, RenameDialog, useIsPhone } from "./ChatHeader.tsx";
import { Dialog } from "./Dialog.tsx";
import { Icon } from "./icons.tsx";
import type { LiveState } from "./live-state.ts";
import { useContextMenu, type ContextMenuProps, type MenuItem } from "./Menu.tsx";

/** The branch that the page shows, and the turn to bring into view after a pick. */
export interface ShownBranch {
  readonly id: string | null;
  /** Shows a branch. With a turn key, the page also scrolls to that turn. */
  readonly show: (sessionId: string, turnKey?: string) => void;
  /** The turn to bring into view. The count changes on each pick, so a second pick of one turn scrolls again. */
  readonly focus: { readonly key: string; readonly count: number } | null;
}

/**
 * Holds the shown branch of a chat. A chat opens on the branch that a link names, else on its
 * branch with the newest activity. The choice then stays, so an answer in another branch does not
 * move the page. A branch that appears after the chat opened, such as a new fork or a retry, shows at once.
 */
export function useShownBranch(tree: readonly SessionRecord[], linkedId: string | null = null): ShownBranch {
  const rootId = tree[0]?.id ?? null;
  const [choice, setChoice] = useState<{ rootId: string; id: string } | null>(null);
  const [focus, setFocus] = useState<ShownBranch["focus"]>(null);
  // The count only grows, also across chats, so a new pick never looks like one that the view handled.
  const picks = useRef(0);
  const known = useRef<{ rootId: string | null; ids: ReadonlySet<string> }>({ rootId: null, ids: new Set() });
  // The view clears the link in the same render that opens its chat, so the hook keeps it until the tree has it.
  const link = useRef<string | null>(null);
  const idsKey = tree.map((session) => session.id).join(" ");

  useEffect(() => {
    if (linkedId !== null) link.current = linkedId;
    const [root, ...rest] = tree;
    if (root === undefined) return;
    const linked = link.current !== null && tree.some((session) => session.id === link.current) ? link.current : null;
    if (linked !== null) {
      link.current = null;
      setChoice({ rootId: root.id, id: linked });
    } else if (known.current.rootId === root.id) {
      const [first, ...others] = tree.filter((session) => !known.current.ids.has(session.id));
      if (first !== undefined) setChoice({ rootId: root.id, id: firstShownBranch([first, ...others]).id });
    } else {
      setChoice({ rootId: root.id, id: firstShownBranch([root, ...rest]).id });
    }
    if (known.current.rootId !== root.id) setFocus(null);
    known.current = { rootId: root.id, ids: new Set(tree.map((session) => session.id)) };
    // Only a new link or a change of the ids runs it: a new turn in a branch must not move the choice.
  }, [idsKey, linkedId]);

  const show = useCallback(
    (sessionId: string, turnKey?: string) => {
      if (rootId !== null) setChoice({ rootId, id: sessionId });
      if (turnKey !== undefined) {
        picks.current += 1;
        setFocus({ key: turnKey, count: picks.current });
      }
    },
    [rootId],
  );

  const [root, ...rest] = tree;
  const chosen = choice !== null && choice.rootId === rootId && tree.some((session) => session.id === choice.id);
  const id = chosen ? choice.id : root === undefined ? null : firstShownBranch([root, ...rest]).id;
  return { id, show, focus };
}

/**
 * The state of each branch that waits for the person, runs a turn, or has an answer that the
 * person did not see. The shown branch is never unread: the page shows its answers.
 */
export function useBranchStates(
  tree: readonly SessionRecord[],
  shownId: string | null,
  approvals: readonly { readonly sessionId: string }[],
  live: LiveState,
): ReadonlyMap<string, BranchState> {
  return branchStates(
    tree,
    shownId,
    new Set(approvals.map((approval) => approval.sessionId)),
    new Set(Object.keys(live.steps)),
  );
}

const stateWords: Record<BranchState, string> = {
  waiting: "waits for you",
  running: "works",
  unread: "has a new answer",
};
const stateTags: Record<BranchState, string> = { waiting: "Waits", running: "Works", unread: "New" };

/** "‹ Fork 1 · 2 of 3 ›" at a fork point. It says when another branch here waits or works. */
export function BranchSwitcher({
  point,
  names,
  states,
  label,
  onShow,
}: {
  readonly point: ForkPoint<SessionRecord>;
  readonly names: ReadonlyMap<string, string>;
  readonly states: ReadonlyMap<string, BranchState>;
  /** Such as "Branches after answer 2". */
  readonly label: string;
  readonly onShow: (sessionId: string) => void;
}): ReactElement {
  const count = point.branches.length;
  const position = Math.max(
    0,
    point.branches.findIndex((branch) => branch.id === point.shownId),
  );
  const step = (by: number): void => {
    const branch = point.branches[(position + by + count) % count];
    if (branch !== undefined) onShow(branch.id);
  };
  const busy = point.branches.find((branch) => branch.id !== point.shownId && states.has(branch.id));
  const busyState = busy === undefined ? undefined : states.get(busy.id);
  return (
    <div className="branch-switch">
      <div className="branch-switcher" role="group" aria-label={label}>
        <button className="icon-button" aria-label="Previous branch" onClick={() => step(-1)}>
          <Icon name="back" />
        </button>
        <span className="branch-switcher-name" aria-live="polite">
          <Icon name="fork" />
          {names.get(point.shownId)} · {position + 1} of {count}
        </span>
        <button className="icon-button" aria-label="Next branch" onClick={() => step(1)}>
          <Icon name="back" className="flip" />
        </button>
      </div>
      {busy !== undefined && busyState !== undefined && (
        <span className={`pill dot ${busyState === "waiting" ? "warn" : "idle"}`}>
          {names.get(busy.id)} {stateWords[busyState]}
        </span>
      )}
    </div>
  );
}

/** Lane spacing of the map, in the units of its drawing. */
const laneGap = 14;
const rowHeight = 52;
const middle = rowHeight / 2;

function laneX(lane: number): number {
  return 9 + lane * laneGap;
}

/** The tree as a small graph: one row for each turn and one lane for each branch. The shown path takes the accent. */
export function BranchMap({
  tree,
  shownId,
  states,
  onPick,
}: {
  readonly tree: readonly SessionRecord[];
  readonly shownId: string;
  readonly states: ReadonlyMap<string, BranchState>;
  readonly onPick: (row: MapRow) => void;
}): ReactElement {
  const map = branchMap(tree, shownId);
  const lastRows = new Map(map.rows.map((row) => [row.sessionId, row.key]));
  const width = laneX(Math.max(map.lanes - 1, 0)) + 9;
  const names = branchNames(tree);
  return (
    <ol className="branch-map" aria-label="Branches">
      {map.rows.map((row) => (
        <BranchRow
          key={row.key}
          row={row}
          width={width}
          fork={row.forkHead ? tree.find((session) => session.id === row.sessionId) : undefined}
          forkName={names.get(row.sessionId) ?? "the fork"}
          state={lastRows.get(row.sessionId) === row.key ? states.get(row.sessionId) : undefined}
          onPick={onPick}
        />
      ))}
    </ol>
  );
}

/**
 * The context menu of a fork: Open when the place gives it, then Rename and Delete fork (issue 637).
 * Spread `props` on the fork's element, and draw `parts` next to it. With no fork, the element keeps
 * the browser's menu, as it has no Eva action.
 */
export function useForkMenu(
  fork: SessionRecord | undefined,
  forkName: string,
  onOpen?: () => void,
): { readonly props: ContextMenuProps | Record<string, never>; readonly parts: ReactElement } {
  const [asking, setAsking] = useState<"rename" | "delete" | null>(null);
  // A closed dialog gives the focus back to the row, so a keyboard or a screen reader keeps its place.
  const opener = useRef<HTMLElement | null>(null);
  const end = (): void => {
    setAsking(null);
    // A deleted fork has no row any more.
    if (opener.current?.isConnected === true) opener.current.focus();
  };
  const items: MenuItem[] = [
    ...(onOpen === undefined ? [] : [{ label: "Open", icon: "chat" as const, onChoose: onOpen }]),
    { label: "Rename", icon: "pen", onChoose: () => setAsking("rename") },
    { label: "Delete fork", icon: "trash", danger: true, onChoose: () => setAsking("delete") },
  ];
  const { props, menu } = useContextMenu(items, `Actions of ${forkName}`);
  const menuProps: ContextMenuProps = {
    ...props,
    onContextMenu: (event) => {
      opener.current = event.currentTarget;
      props.onContextMenu(event);
    },
    onPointerDown: (event) => {
      opener.current = event.currentTarget;
      props.onPointerDown(event);
    },
  };
  // The fork_named and session_deleted events reload the list, on this page and on every other one.
  const endAfterEvent = (): Promise<void> => {
    end();
    return Promise.resolve();
  };
  const dialog =
    fork === undefined ? null : asking === "rename" ? (
      <RenameDialog
        heading={`Rename ${forkName}`}
        label="Fork name"
        original={forkName}
        onSave={(name) => api.nameFork(fork.id, name)}
        onEnd={end}
        onChanged={endAfterEvent}
      />
    ) : asking === "delete" ? (
      // The page then shows another branch.
      <DeleteQuestion chat={fork} fork={forkName} onKeep={end} onChanged={endAfterEvent} />
    ) : null;
  const parts = (
    <>
      {menu}
      {/* On a phone, the open chat list is a layer of its own. The body puts the dialog above every other layer. */}
      {dialog !== null && createPortal(dialog, document.body)}
    </>
  );
  return { props: fork === undefined ? {} : menuProps, parts };
}

/** One row of the map. The first row of a fork has the fork's menu. */
function BranchRow({
  row,
  width,
  fork,
  forkName,
  state,
  onPick,
}: {
  readonly row: MapRow;
  readonly width: number;
  readonly fork: SessionRecord | undefined;
  readonly forkName: string;
  readonly state: BranchState | undefined;
  readonly onPick: (row: MapRow) => void;
}): ReactElement {
  const { props: menuProps, parts } = useForkMenu(fork, forkName);
  return (
    <li>
      {parts}
      <button
        className={row.onPath ? "branch-row on-path" : "branch-row"}
        aria-current={row.current ? "true" : undefined}
        data-tooltip={`${row.text} · ${row.label}`}
        onClick={() => onPick(row)}
        {...menuProps}
      >
        <MapLanes row={row} width={width} />
        <span className="branch-row-text">
          <span className="branch-row-message">{row.text}</span>
          <span className="branch-row-label">{row.label}</span>
        </span>
        {state !== undefined && (
          <span className={`pill dot ${state === "waiting" ? "warn" : "idle"}`}>{stateTags[state]}</span>
        )}
      </button>
    </li>
  );
}

function MapLanes({ row, width }: { readonly row: MapRow; readonly width: number }): ReactElement {
  const segment = (x: number, from: number, to: number, line: MapLine): ReactElement | null =>
    line === "none" ? null : <line className={line} x1={x} y1={from} x2={x} y2={to} />;
  const dot = row.current ? "current" : row.onPath ? "hot" : "plain";
  return (
    <svg
      className="branch-lanes"
      width={width}
      height={rowHeight}
      viewBox={`0 0 ${String(width)} ${String(rowHeight)}`}
      aria-hidden="true"
    >
      {row.lines.map((line) => (
        <g key={line.lane}>
          {segment(laneX(line.lane), 0, middle, line.up)}
          {segment(laneX(line.lane), middle, rowHeight, line.down)}
        </g>
      ))}
      {row.bends.map((bend) => {
        const to = laneX(bend.to);
        return (
          <path
            key={bend.to}
            className={bend.hot ? "hot" : "plain"}
            d={`M ${String(laneX(row.lane))} ${String(middle)} H ${String(to - 8)} Q ${String(to)} ${String(middle)} ${String(to)} ${String(middle + 8)} V ${String(rowHeight)}`}
          />
        );
      })}
      <circle className={dot} cx={laneX(row.lane)} cy={middle} r={5} />
    </svg>
  );
}

/** The map column of a computer. A phone hides it and opens the map from the header. */
export function BranchMapColumn(props: Parameters<typeof BranchMap>[0]): ReactElement {
  return (
    <nav className="branch-map-column" aria-label="Branch map">
      <h2>Branches</h2>
      <BranchMap {...props} />
    </nav>
  );
}

/** The header button of a phone that opens the branch map in a bottom sheet. A chat with no fork has none. */
export function BranchesButton({
  tree,
  shown,
  states,
}: {
  readonly tree: readonly SessionRecord[];
  readonly shown: ShownBranch;
  readonly states: ReadonlyMap<string, BranchState>;
}): ReactElement | null {
  const isPhone = useIsPhone();
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => {
    setOpen(false);
    button.current?.focus();
  }, []);
  if (!isPhone || tree.length < 2 || shown.id === null) return null;
  const shownId = shown.id;
  const waiting = [...states.values()].includes("waiting");
  return (
    <>
      <button
        ref={button}
        className="icon-button branches-button"
        aria-label={`Branches, ${String(tree.length)}${waiting ? ", one waits for you" : ""}`}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        <Icon name="fork" />
        {waiting && <span className="unread-dot warn" />}
      </button>
      {open && (
        <Dialog label="Branches" onClose={close} scrimCloses>
          <div className="branches-sheet">
            <h2>Branches</h2>
            <p className="branches-sheet-hint">Tap a branch to show it. Each one keeps its own answers.</p>
            <BranchMap
              tree={tree}
              shownId={shownId}
              states={states}
              onPick={(row) => {
                pickRow(shown, shownId, row);
                close();
              }}
            />
          </div>
        </Dialog>
      )}
    </>
  );
}

/** A row on the shown path only scrolls to its turn. Another row shows its branch too. */
export function pickRow(shown: ShownBranch, shownId: string, row: MapRow): void {
  shown.show(pickedBranch(shownId, row), row.key);
}
