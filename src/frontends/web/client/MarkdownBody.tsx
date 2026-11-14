/**
 * The HTML of `toWebHtml`, with a Copy button on each code block. The HTML is a string, so it cannot
 * hold a React button: a portal puts one in each empty bar that `toWebHtml` leaves in the block.
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactElement } from "react";
import { createPortal } from "react-dom";
import { api } from "./api.ts";
import { CopyButton } from "./CopyButton.tsx";
import { filePathOf } from "./file-paths.ts";
import { missingPathsChecker } from "./vault-link-check.ts";

interface CodeBar {
  readonly bar: HTMLElement;
  readonly code: string;
}

/** One check for the whole page, so each path costs one request. */
const missingPaths = missingPathsChecker(api.existingFiles);

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
  useEffect(() => {
    const root = body.current;
    if (root === null) return;
    const links = [...root.querySelectorAll<HTMLAnchorElement>("a.vault-link")].flatMap((link) => {
      const path = filePathOf(link.getAttribute("href") ?? "");
      return path === null ? [] : [{ link, path }];
    });
    if (links.length === 0) return;
    let current = true;
    void missingPaths(links.map(({ path }) => path)).then((missing) => {
      // A new HTML string replaced these links, and its own effect checks the new ones.
      if (!current) return;
      for (const { link, path } of links) if (missing.has(path)) link.replaceWith(...link.childNodes);
    });
    return () => {
      current = false;
    };
  }, [html]);
  return (
    <>
      <div ref={body} className={className} dangerouslySetInnerHTML={{ __html: html }} />
      {bars.map(({ bar, code }, index) =>
        createPortal(<CopyButton text={code} name="Copy the code" iconOnly />, bar, String(index)),
      )}
    </>
  );
}
