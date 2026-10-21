/**
 * The one menu of the page. `MenuList` draws the items of every menu, such as "More actions".
 * `useContextMenu` opens the same list at the pointer on a right click, or on a long press on a
 * phone. Only an element with Eva actions blocks the browser's own menu, so text keeps copy and paste.
 */
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { Icon, type IconName } from "./icons.tsx";
import { placeMenu, type MenuPlace, type Point } from "./menu-place.ts";

export interface MenuItem {
  readonly label: string;
  readonly icon: IconName;
  readonly danger?: boolean;
  readonly onChoose: () => void;
}

/** A touch that rests this long opens the menu, as a long press does in a phone's own apps. */
export const longPressMs = 500;
/** A finger that moves further than this scrolls, so the long press stops. */
const longPressSlop = 10;

interface MenuListProps {
  readonly items: readonly MenuItem[];
  /** The name that a screen reader reads for the menu, such as "Chat actions". */
  readonly label: string;
  readonly className: string;
  readonly style?: CSSProperties;
  readonly listRef?: RefObject<HTMLDivElement | null>;
  /** `refocus` is true when the focus must go back to the element that opened the menu. */
  readonly onClose: (refocus: boolean) => void;
}

/** The items, with the keys of a menu: the arrows, Home, End, Escape and Tab. */
export function MenuList({ items, label, className, style, listRef, onClose }: MenuListProps): ReactElement {
  const own = useRef<HTMLDivElement>(null);
  const menu = listRef ?? own;

  useEffect(() => {
    menu.current?.querySelector("button")?.focus();
  }, [menu]);

  /** Moves the focus by `step` items, or to the first or the last item. */
  const moveFocus = (step: number | "first" | "last"): void => {
    const buttons = [...(menu.current?.querySelectorAll("button") ?? [])];
    const current = buttons.findIndex((button) => button === document.activeElement);
    const next =
      step === "first" ? 0 : step === "last" ? buttons.length - 1 : (current + step + buttons.length) % buttons.length;
    buttons[next]?.focus();
  };

  const onKeyDown = (event: ReactKeyboardEvent): void => {
    // Tab leaves the menu, so the menu closes. The focus goes back to the opener first,
    // so Tab moves on from there, not from the top of the page.
    if (event.key === "Tab") {
      onClose(true);
      return;
    }
    if (event.key === "Escape") onClose(true);
    else if (event.key === "ArrowDown") moveFocus(1);
    else if (event.key === "ArrowUp") moveFocus(-1);
    else if (event.key === "Home") moveFocus("first");
    else if (event.key === "End") moveFocus("last");
    else return;
    event.preventDefault();
    event.stopPropagation();
  };

  return (
    <div className={`menu ${className}`} role="menu" aria-label={label} ref={menu} style={style} onKeyDown={onKeyDown}>
      {items.map((item) => (
        <button
          key={item.label}
          role="menuitem"
          className={item.danger === true ? "danger" : undefined}
          onClick={() => {
            onClose(false);
            item.onChoose();
          }}
        >
          <Icon name={item.icon} /> {item.label}
        </button>
      ))}
    </div>
  );
}

/** Calls `onDismiss` on a press outside `root`, for as long as `open` is true. */
export function useDismissOutside(open: boolean, root: RefObject<HTMLElement | null>, onDismiss: () => void): void {
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;
  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (event: PointerEvent): void => {
      if (!(event.target instanceof Node) || root.current?.contains(event.target) !== true) dismiss.current();
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open, root]);
}

/** The props that an element with a context menu takes. */
export interface ContextMenuProps {
  readonly "data-context-menu": true;
  readonly onContextMenu: (event: ReactMouseEvent<HTMLElement>) => void;
  readonly onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  readonly onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  readonly onPointerUp: () => void;
  readonly onPointerCancel: () => void;
  readonly onClickCapture: (event: ReactMouseEvent<HTMLElement>) => void;
}

/**
 * Gives an element a context menu. Spread `props` on the element, and draw `menu` next to it.
 * A right click, the menu key, Shift+F10 and a long press open it.
 */
export function useContextMenu(
  items: readonly MenuItem[],
  label: string,
): { readonly props: ContextMenuProps; readonly menu: ReactElement | null } {
  const [opened, setOpened] = useState<{ readonly at: Point; readonly opener: HTMLElement } | null>(null);
  const press = useRef<{ readonly at: Point; readonly timer: ReturnType<typeof setTimeout> } | null>(null);
  // The touch that opened the menu also ends in a click, and that click must not open the item.
  const dropClick = useRef(false);

  const stopPress = (): void => {
    if (press.current !== null) clearTimeout(press.current.timer);
    press.current = null;
  };
  useEffect(() => stopPress, []);

  const open = (at: Point, opener: HTMLElement): void => {
    stopPress();
    setOpened({ at, opener });
  };

  const props: ContextMenuProps = {
    "data-context-menu": true,
    onContextMenu: (event) => {
      event.preventDefault();
      const opener = event.currentTarget;
      // The menu key and Shift+F10 give no pointer place, so the menu opens under the element.
      if (event.clientX === 0 && event.clientY === 0) {
        const box = opener.getBoundingClientRect();
        open({ x: box.left, y: box.bottom }, opener);
      } else {
        open({ x: event.clientX, y: event.clientY }, opener);
      }
    },
    onPointerDown: (event) => {
      dropClick.current = false;
      // Android sends a contextmenu event on a long press. Safari on an iPhone sends none, so a timer opens it.
      if (event.pointerType !== "touch") return;
      stopPress();
      const opener = event.currentTarget;
      const at = { x: event.clientX, y: event.clientY };
      press.current = {
        at,
        timer: setTimeout(() => {
          dropClick.current = true;
          open(at, opener);
        }, longPressMs),
      };
    },
    onPointerMove: (event) => {
      const start = press.current?.at;
      if (start === undefined) return;
      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > longPressSlop) stopPress();
    },
    onPointerUp: stopPress,
    onPointerCancel: stopPress,
    onClickCapture: (event) => {
      if (!dropClick.current) return;
      dropClick.current = false;
      event.preventDefault();
      event.stopPropagation();
    },
  };

  const menu =
    opened === null ? null : (
      <ContextMenu
        items={items}
        label={label}
        at={opened.at}
        onClose={(refocus) => {
          setOpened(null);
          if (refocus) opened.opener.focus();
        }}
      />
    );
  return { props, menu };
}

/** The list at a point of the screen. It closes on a press outside it, a scroll or a resize. */
function ContextMenu({
  items,
  label,
  at,
  onClose,
}: {
  readonly items: readonly MenuItem[];
  readonly label: string;
  readonly at: Point;
  readonly onClose: (refocus: boolean) => void;
}): ReactElement {
  const list = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<MenuPlace | null>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useDismissOutside(true, list, () => onClose(false));

  useEffect(() => {
    // The menu has a fixed place, so it would stay behind when the page moves.
    const onMove = (): void => close.current(false);
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, []);

  // Measure before the paint, so the menu never shows at a wrong place.
  useLayoutEffect(() => {
    if (list.current === null) return;
    const size = list.current.getBoundingClientRect();
    const viewport = { width: document.documentElement.clientWidth, height: window.innerHeight };
    setPlace(placeMenu(at, size, viewport));
  }, [at]);

  return createPortal(
    <MenuList
      items={items}
      label={label}
      className="context-menu"
      listRef={list}
      // Not "visibility: hidden": the list takes the focus before the measure, and a hidden button cannot.
      style={place === null ? { opacity: 0 } : { left: place.left, top: place.top }}
      onClose={onClose}
    />,
    document.body,
  );
}
