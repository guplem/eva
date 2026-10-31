/**
 * The bar above an open file on the Files page, for a text file and for an image, a sound or a
 * film: the size, the actions of the file, the button that makes the file large, and its menu.
 */
import { useEffect, useState, type ReactElement, type ReactNode } from "react";
import { readAppearance } from "./appearance.ts";
import { useBackLayer } from "./back-layer-hook.ts";
import { useIsPhone } from "./ChatHeader.tsx";
import { sizeWords } from "./file-paths.ts";
import { Icon } from "./icons.tsx";
import { MoreMenu, type MenuItem } from "./Menu.tsx";

export function FileBar({
  size,
  large,
  onLarge,
  items,
  children,
}: {
  readonly size: number;
  readonly large: boolean;
  readonly onLarge: (large: boolean) => void;
  /** The menu items of this file. The bar adds the large item at the end. */
  readonly items: readonly MenuItem[];
  /** The actions that show in the bar, such as Edit. */
  readonly children?: ReactNode;
}): ReactElement {
  // The large file fills the screen, so the Back button makes it small first.
  useBackLayer(large, () => onLarge(false));
  useEffect(() => {
    if (!large) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape" && !event.defaultPrevented) onLarge(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [large, onLarge]);

  const isPhone = useIsPhone();
  /** The Appearance setting changes on the Settings page, so the file reads it once, as it opens. */
  const [oneFolder] = useState(() => readAppearance().filesView === "single");
  // A phone and the one folder view show no folder columns, so the file fills the page already.
  const canLarge = !isPhone && !oneFolder;
  const largeLabel = large ? "Make the file small" : "Make the file large";
  const largeIcon = large ? "shrink" : "expand";
  const largeItem: MenuItem = { label: largeLabel, icon: largeIcon, onChoose: () => onLarge(!large) };
  const allItems = canLarge ? [...items, largeItem] : items;
  return (
    <div className="files-file-bar">
      <span className="files-size">{sizeWords(size)}</span>
      <div className="files-file-actions">
        {/* The menu has the same item, but a person makes the file large often, so it is one tap away. */}
        {canLarge && (
          <button
            className="icon-button"
            aria-label={largeLabel}
            data-tooltip={largeLabel}
            onClick={() => onLarge(!large)}
          >
            <Icon name={largeIcon} />
          </button>
        )}
        {children}
        <MoreMenu items={allItems} label="File actions" />
      </div>
    </div>
  );
}
