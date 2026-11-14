/**
 * A middle click or a Ctrl click on a navigation button opens its page in a new tab, as on a link (#935).
 * The controls stay buttons: a link would change their look, and some have their own right-click menu.
 */

/** The parts of a mouse event that decide where a page opens. */
export interface TabClick {
  readonly button: number;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  preventDefault(): void;
}

/** Opens an address in a new tab. A test gives a fake. */
export type OpenTab = (address: string) => void;

/** A middle click, or a Ctrl click (Cmd on a Mac), opens a new tab, as the browser does for a link. */
export function opensNewTab(event: TabClick): boolean {
  return event.button === 1 || (event.button === 0 && (event.ctrlKey || event.metaKey));
}

const openInBrowserTab: OpenTab = (address) => {
  window.open(new URL(address, window.location.href).href, "_blank", "noopener");
};

export interface TabLinkProps {
  readonly onClick: (event: TabClick) => void;
  readonly onAuxClick: (event: TabClick) => void;
  readonly onMouseDown: (event: TabClick) => void;
}

/**
 * Props for a button that opens the page at `address`. A plain click runs `onOpen` in this tab.
 * A middle click or a Ctrl click opens the address in a new tab instead.
 */
export function tabLinkProps(address: string, onOpen: () => void, openTab: OpenTab = openInBrowserTab): TabLinkProps {
  return {
    onClick: (event) => {
      if (!opensNewTab(event)) {
        onOpen();
        return;
      }
      event.preventDefault();
      openTab(address);
    },
    onAuxClick: (event) => {
      if (event.button !== 1) return;
      event.preventDefault();
      openTab(address);
    },
    // A middle press starts the scroll mode of the browser on Windows, over the new tab.
    onMouseDown: (event) => {
      if (event.button === 1) event.preventDefault();
    },
  };
}
