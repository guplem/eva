/**
 * The Files page (issue 253): the vault's folders and the text of its files, read only. Each
 * folder and file is a link, so the back button and a reload work as they do on any page.
 */
import { useEffect, useState, type ReactElement } from "react";
import { api, type BrowsedPath, type FileEntry } from "./api.ts";
import {
  childPath,
  fileAddressOf,
  filePathOf,
  isMarkdown,
  parentOf,
  pathCrumbs,
  sizeWords,
  splitFrontMatter,
} from "./file-paths.ts";
import { Icon } from "./icons.tsx";
import { toWebHtml } from "./web-format.ts";
import { ListSkeleton } from "./Loading.tsx";

export function FilesView(): ReactElement {
  const [path, setPath] = useState(() => filePathOf(window.location.hash) ?? "");
  /** The answer with the path that asked for it: the core tidies a path, such as `./Projects`. */
  const [shown, setShown] = useState<{ asked: string; answer: BrowsedPath } | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [plain, setPlain] = useState(false);
  /** A tap on the same link changes no address, so a failed read needs its own way to run again. */
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const onHashChange = (): void => {
      const next = filePathOf(window.location.hash);
      if (next !== null) setPath(next);
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    // A slow answer for a path that the person already left must not replace the new one.
    let isLatest = true;
    setFailure(null);
    setPlain(false);
    api.files(path).then(
      (answer) => {
        if (isLatest) setShown({ asked: path, answer });
      },
      (error: unknown) => {
        if (!isLatest) return;
        setShown(null);
        setFailure(error instanceof Error ? error.message : String(error));
      },
    );
    return () => {
      isLatest = false;
    };
  }, [path, attempt]);

  const parent = parentOf(path);
  // A file of the folder that the person left must not show under the new path.
  const current = shown?.asked === path ? shown.answer : null;
  return (
    <div className="main">
      <div className="files-page">
        <div className="files-header">
          {parent !== null && (
            <a className="files-up icon-button" href={fileAddressOf(parent)} aria-label="Up one folder">
              <Icon name="back" />
            </a>
          )}
          <nav className="files-crumbs" aria-label="Folder path">
            {pathCrumbs(path).map((crumb, index, crumbs) =>
              index === crumbs.length - 1 ? (
                <h1 key={crumb.path} aria-current="page">
                  {crumb.name}
                </h1>
              ) : (
                <span key={crumb.path} className="files-crumb">
                  <a href={fileAddressOf(crumb.path)}>{crumb.name}</a>
                  <span aria-hidden="true">/</span>
                </span>
              ),
            )}
          </nav>
        </div>
        <div className="files-column">
          {failure !== null && (
            <div role="alert" className="callout danger callout-action">
              <span>{failure}</span>
              <button onClick={() => setAttempt((count) => count + 1)}>Try again</button>
            </div>
          )}
          {failure === null && current === null && <ListSkeleton label="Loading the folder…" rows={8} />}
          {failure === null && current?.kind === "folder" && <FolderList path={path} entries={current.entries} />}
          {failure === null && current?.kind === "unreadable" && (
            <div role="status" className="callout warning">
              {current.reason} <span className="files-size">({sizeWords(current.size)})</span>
            </div>
          )}
          {failure === null && current?.kind === "file" && (
            <FileText path={path} text={current.text} size={current.size} plain={plain} onPlain={setPlain} />
          )}
        </div>
      </div>
    </div>
  );
}

function FolderList({
  path,
  entries,
}: {
  readonly path: string;
  readonly entries: readonly FileEntry[];
}): ReactElement {
  if (entries.length === 0) return <div className="empty">This folder is empty.</div>;
  return (
    <ul className="files-list" aria-label="Folder contents">
      {entries.map((entry) => (
        <li key={entry.name}>
          {entry.kind === "other" ? (
            <span className="files-entry other">
              <Icon name="info" />
              <span className="files-name">{entry.name}</span>
              <span className="files-size">Does not open</span>
            </span>
          ) : (
            <a className="files-entry" href={fileAddressOf(childPath(path, entry.name))}>
              <Icon name={entry.kind === "folder" ? "folder" : "file"} />
              <span className="files-name">{entry.name}</span>
              {entry.size !== null && <span className="files-size">{sizeWords(entry.size)}</span>}
            </a>
          )}
        </li>
      ))}
    </ul>
  );
}

function FileText({
  path,
  text,
  size,
  plain,
  onPlain,
}: {
  readonly path: string;
  readonly text: string;
  readonly size: number;
  readonly plain: boolean;
  readonly onPlain: (plain: boolean) => void;
}): ReactElement {
  const markdown = isMarkdown(path);
  const { frontMatter, body } = splitFrontMatter(text);
  return (
    <section className="files-file" aria-label="File text">
      <div className="files-file-bar">
        <span className="files-size">{sizeWords(size)}</span>
        {markdown && (
          <button className="ghost" onClick={() => onPlain(!plain)}>
            {plain ? "Show formatted" : "Show plain text"}
          </button>
        )}
      </div>
      {markdown && !plain ? (
        <>
          {frontMatter !== null && <pre className="files-text files-front-matter">{frontMatter}</pre>}
          {/* toWebHtml escapes all text and adds only its own tags, so the HTML is safe. */}
          <div className="answer-body files-markdown" dangerouslySetInnerHTML={{ __html: toWebHtml(body) }} />
        </>
      ) : (
        <pre className="files-text">{text}</pre>
      )}
    </section>
  );
}
