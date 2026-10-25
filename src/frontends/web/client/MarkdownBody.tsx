/**
 * The HTML of `toWebHtml`, with a Copy button on each code block. The HTML is a string, so it cannot
 * hold a React button: a portal puts one in each empty bar that `toWebHtml` leaves in the block.
 */
import { useLayoutEffect, useRef, useState, type ReactElement } from "react";
import { createPortal } from "react-dom";
import { CopyButton } from "./CopyButton.tsx";

interface CodeBar {
  readonly bar: HTMLElement;
  readonly code: string;
}

export function MarkdownBody({
  html,
  className,
  copy = true,
}: {
  /** HTML from `toWebHtml`, which escapes all text and adds only its own tags, so it is safe. */
  readonly html: string;
  readonly className: string;
  /** False for a live answer: each token replaces every block, so a tap could miss or copy half a block. */
  readonly copy?: boolean;
}): ReactElement {
  const body = useRef<HTMLDivElement>(null);
  const [bars, setBars] = useState<readonly CodeBar[]>([]);
  // React sets the HTML again only when the string changes. A layout effect finds the new bars
  // before the browser paints, so the buttons do not flicker.
  useLayoutEffect(() => {
    const root = body.current;
    if (root === null || !copy) {
      // A live answer comes here on each token: keep the same empty list, so React renders no more.
      setBars((old) => (old.length === 0 ? old : []));
      return;
    }
    const found = [...root.querySelectorAll<HTMLElement>(".code-box-bar")];
    setBars(found.map((bar) => ({ bar, code: bar.parentElement?.querySelector("code")?.textContent ?? "" })));
  }, [html, copy]);
  return (
    <>
      <div ref={body} className={className} dangerouslySetInnerHTML={{ __html: html }} />
      {bars.map(({ bar, code }, index) =>
        createPortal(<CopyButton text={code} name="Copy the code" iconOnly />, bar, String(index)),
      )}
    </>
  );
}
