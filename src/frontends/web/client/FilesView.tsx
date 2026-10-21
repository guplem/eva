/**
 * The Files page (issues 253 and 308): the vault's folders and the text of its files. Each folder
 * and file is a link, so the back button and a reload work as they do on any page. A wide screen
 * shows each folder of the path as a column and the open file at the right, as a Finder does. A
 * phone shows the last one alone. The person can edit a text file and save it in the vault.
 */
import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import { api, ApiError, type BrowsedPath, type FileEntry } from "./api.ts";
import { codeTokens, prettyJson, viewOf } from "./code-view.ts";
import {
  childPath,
  fileAddressOf,
  filePathOf,
  parentOf,
  pathCrumbs,
  sizeWords,
  splitFrontMatter,
} from "./file-paths.ts";
import { Icon } from "./icons.tsx";
import { ListSkeleton } from "./Loading.tsx";
import { SaveButton } from "./SaveButton.tsx";
import { toWebHtml } from "./web-format.ts";

type ShownFile = Extract<BrowsedPath, { kind: "file" }>;
type Answer =
  { readonly state: "shown"; readonly answer: BrowsedPath } | { readonly state: "failed"; readonly reason: string };

export function FilesView(): ReactElement {
  const [path, setPath] = useState(() => filePathOf(window.location.hash) ?? "");
  /** The answer for each path that the page read, so a column stays while the person goes deeper. */
  const [answers, setAnswers] = useState<ReadonlyMap<string, Answer>>(new Map());
  const [large, setLarge] = useState(false);
  /** A tap on the same link changes no address, so a failed read needs its own way to run again. */
  const [attempt, setAttempt] = useState(0);
  const columns = useRef<HTMLDivElement>(null);
  /** The answers of the last render, so the read below does not run again for each new answer. */
  const known = useRef(answers);
  known.current = answers;
  /** The path on screen, and whether its editor holds a change, for the address check below. */
  const shownPath = useRef(path);
  shownPath.current = path;
  const unsaved = useRef(false);
  const onUnsaved = useCallback((value: boolean): void => {
    unsaved.current = value;
  }, []);

  useEffect(() => {
    const onHashChange = (): void => {
      const next = filePathOf(window.location.hash);
      if (next === null || next === shownPath.current) return;
      // A tap on another file or folder must not drop an edit without a word.
      if (unsaved.current && !window.confirm("Your change to this file is not saved. Leave it?")) {
        window.history.replaceState(null, "", fileAddressOf(shownPath.current));
        return;
      }
      unsaved.current = false;
      setPath(next);
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  // Each answer goes in by the path that asked for it, so a slow answer never shows under another path.
  const read = useCallback((asked: string): void => {
    api.files(asked).then(
      (answer) => setAnswers((current) => new Map(current).set(asked, { state: "shown", answer })),
      (error: unknown) =>
        setAnswers((current) =>
          new Map(current).set(asked, {
            state: "failed",
            reason: error instanceof Error ? error.message : String(error),
          }),
        ),
    );
  }, []);

  const crumbs = pathCrumbs(path);
  useEffect(() => {
    setLarge(false);
    // The open path reads again each time, so a file shows its newest text. A parent column reads once.
    for (const crumb of pathCrumbs(path).slice(0, -1))
      if (known.current.get(crumb.path)?.state !== "shown") read(crumb.path);
    read(path);
  }, [path, attempt, read]);

  // The newest column is at the right, so a deep path scrolls there.
  const shownCount = crumbs.filter((crumb) => answers.has(crumb.path)).length;
  useEffect(() => {
    const element = columns.current;
    if (element !== null) element.scrollLeft = element.scrollWidth;
  }, [path, shownCount]);

  const onSaved = (saved: BrowsedPath): void => {
    setAnswers((current) => new Map(current).set(path, { state: "shown", answer: saved }));
    // The folder shows the new size.
    const parent = parentOf(path);
    if (parent !== null) read(parent);
  };

  const parent = parentOf(path);
  const last = answers.get(path);
  const fileIsOpen = last?.state === "shown" && last.answer.kind !== "folder";
  return (
    <div className="main">
      <div className={large ? "files-page large" : "files-page"}>
        <div className="files-header">
          {parent !== null && (
            <a className="files-up icon-button" href={fileAddressOf(parent)} aria-label="Up one folder">
              <Icon name="back" />
            </a>
          )}
          <nav className="files-crumbs" aria-label="Folder path">
            {crumbs.map((crumb, index) =>
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
        <div className="files-columns" ref={columns}>
          {crumbs.map((crumb, index) => (
            <Column
              key={crumb.path}
              path={crumb.path}
              name={crumb.name}
              answer={answers.get(crumb.path)}
              // Only the open path is the person's choice: a parent that is not a folder shows nothing.
              isLast={index === crumbs.length - 1}
              openChild={crumbs[index + 1]?.name ?? null}
              large={large}
              onLarge={setLarge}
              onSaved={onSaved}
              onUnsaved={onUnsaved}
              onTryAgain={() => setAttempt((count) => count + 1)}
            />
          ))}
          {!fileIsOpen && (
            <div className="files-pane files-placeholder" aria-hidden="true">
              <Icon name="file" />
              Open a file to see it here.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface ColumnProps {
  readonly path: string;
  readonly name: string;
  readonly answer: Answer | undefined;
  readonly isLast: boolean;
  readonly openChild: string | null;
  readonly large: boolean;
  readonly onLarge: (large: boolean) => void;
  readonly onSaved: (saved: BrowsedPath) => void;
  readonly onUnsaved: (unsaved: boolean) => void;
  readonly onTryAgain: () => void;
}

/** One folder of the path, or the open file. A phone shows only the last column. */
function Column({
  path,
  name,
  answer,
  isLast,
  openChild,
  large,
  onLarge,
  onSaved,
  onUnsaved,
  onTryAgain,
}: ColumnProps): ReactElement | null {
  const place = isLast ? "files-pane" : "files-pane files-parent";
  if (answer === undefined)
    return (
      <div className={place}>
        <ListSkeleton label="Loading the folder…" rows={8} />
      </div>
    );
  if (answer.state === "failed")
    return (
      <div className={place}>
        <div role="alert" className="callout danger callout-action">
          <span>{answer.reason}</span>
          <button onClick={onTryAgain}>Try again</button>
        </div>
      </div>
    );
  const shown = answer.answer;
  if (shown.kind === "folder")
    return (
      <div className={place}>
        <FolderList path={path} name={name} entries={shown.entries} openChild={openChild} />
      </div>
    );
  if (!isLast) return null;
  if (shown.kind === "unreadable")
    return (
      <div className="files-pane files-preview">
        <div role="status" className="callout warning">
          {shown.reason} <span className="files-size">({sizeWords(shown.size)})</span>
        </div>
      </div>
    );
  // A new file starts outside the editor, with its own view.
  return (
    <FilePreview key={path} file={shown} large={large} onLarge={onLarge} onSaved={onSaved} onUnsaved={onUnsaved} />
  );
}

function FolderList({
  path,
  name,
  entries,
  openChild,
}: {
  readonly path: string;
  readonly name: string;
  readonly entries: readonly FileEntry[];
  readonly openChild: string | null;
}): ReactElement {
  if (entries.length === 0) return <div className="empty">This folder is empty.</div>;
  return (
    <ul className="files-list" aria-label={`Contents of ${name}`}>
      {entries.map((entry) => (
        <li key={entry.name}>
          {entry.kind === "other" ? (
            <span className="files-entry other">
              <Icon name="info" />
              <span className="files-name">{entry.name}</span>
              <span className="files-size">Does not open</span>
            </span>
          ) : (
            <a
              className="files-entry"
              href={fileAddressOf(childPath(path, entry.name))}
              aria-current={entry.name === openChild ? "true" : undefined}
            >
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

interface FilePreviewProps {
  readonly file: ShownFile;
  readonly large: boolean;
  readonly onLarge: (large: boolean) => void;
  readonly onSaved: (saved: BrowsedPath) => void;
  /** Tells the page whether the editor holds a change, so a tap on another path asks first. */
  readonly onUnsaved: (unsaved: boolean) => void;
}

function FilePreview({ file, large, onLarge, onSaved, onUnsaved }: FilePreviewProps): ReactElement {
  const [plain, setPlain] = useState(false);
  /** The text in the editor, or null outside it. */
  const [draft, setDraft] = useState<string | null>(null);
  const [problem, setProblem] = useState<{ readonly text: string; readonly changed: boolean } | null>(null);
  /** A ref, not state: a double tap comes before the next render, and two saves of one version clash. */
  const saving = useRef(false);
  const [busy, setBusy] = useState(false);
  const view = viewOf(file.path);

  useEffect(() => {
    if (!large) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onLarge(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [large, onLarge]);

  // An edit that is not saved must not vanish with a reload or a closed tab.
  const unsaved = draft !== null && draft !== file.text;
  useEffect(() => {
    onUnsaved(unsaved);
    if (!unsaved) return;
    const onLeave = (event: BeforeUnloadEvent): void => event.preventDefault();
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, [unsaved, onUnsaved]);

  const save = async (): Promise<boolean> => {
    if (draft === null || saving.current) return false;
    saving.current = true;
    setBusy(true);
    setProblem(null);
    try {
      onSaved(await api.saveFile(file.path, file.version, draft));
      setDraft(null);
      return true;
    } catch (caught) {
      const changed = caught instanceof ApiError && caught.code === "file_changed";
      setProblem({ text: caught instanceof Error ? caught.message : String(caught), changed });
      return false;
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };

  const loadAgain = async (): Promise<void> => {
    setProblem(null);
    try {
      const answer = await api.files(file.path);
      onSaved(answer);
      if (answer.kind === "file") setDraft(answer.text);
    } catch (caught) {
      setProblem({ text: caught instanceof Error ? caught.message : String(caught), changed: true });
    }
  };

  return (
    <section className="files-pane files-preview files-file" aria-label="File text">
      <div className="files-file-bar">
        <span className="files-size">{sizeWords(file.size)}</span>
        <div className="files-file-actions">
          {draft === null ? (
            <>
              {(view === "markdown" || view === "json") && (
                <button className="ghost" onClick={() => setPlain(!plain)}>
                  {plain ? "Show formatted" : "Show plain text"}
                </button>
              )}
              {file.editable ? (
                <button onClick={() => setDraft(file.text)}>
                  <Icon name="pen" />
                  Edit
                </button>
              ) : (
                <span className="files-size">
                  <Icon name="lock" /> Read only: Eva hid a secret in it
                </span>
              )}
            </>
          ) : (
            <>
              <button className="ghost" onClick={() => setDraft(null)}>
                Cancel
              </button>
              <SaveButton className="primary" onSave={save} disabled={!unsaved || busy}>
                Save
              </SaveButton>
            </>
          )}
          <button
            className="files-large-button icon-button"
            aria-label={large ? "Make the file small" : "Make the file large"}
            aria-pressed={large}
            data-tooltip={large ? "Make small" : "Make large"}
            onClick={() => onLarge(!large)}
          >
            <Icon name={large ? "shrink" : "expand"} />
          </button>
        </div>
      </div>
      {problem !== null && (
        <div role="alert" className="callout danger callout-action files-problem">
          <span>{problem.text}</span>
          {problem.changed && <button onClick={() => void loadAgain()}>Load again</button>}
        </div>
      )}
      {draft !== null ? (
        <textarea
          className="files-editor"
          aria-label={`Text of ${file.path}`}
          value={draft}
          spellCheck={false}
          autoFocus
          onChange={(event) => setDraft(event.target.value)}
        />
      ) : (
        <FileText path={file.path} text={file.text} plain={plain} />
      )}
    </section>
  );
}

function FileText({
  path,
  text,
  plain,
}: {
  readonly path: string;
  readonly text: string;
  readonly plain: boolean;
}): ReactElement {
  const view = viewOf(path);
  if (plain || view === "plain") return <pre className="files-text">{text}</pre>;
  if (view === "markdown") {
    const { frontMatter, body } = splitFrontMatter(text);
    return (
      <>
        {frontMatter !== null && <pre className="files-text files-front-matter">{frontMatter}</pre>}
        {/* toWebHtml escapes all text and adds only its own tags, so the HTML is safe. */}
        <div className="answer-body files-markdown" dangerouslySetInnerHTML={{ __html: toWebHtml(body) }} />
      </>
    );
  }
  return <CodeText path={path} text={view === "json" ? (prettyJson(text) ?? text) : text} />;
}

function CodeText({ path, text }: { readonly path: string; readonly text: string }): ReactElement {
  return (
    <pre className="files-text">
      <code>
        {codeTokens(path, text).map((token, index) =>
          token.kind === "plain" ? (
            token.text
          ) : (
            <span key={index} className={`code-${token.kind}`}>
              {token.text}
            </span>
          ),
        )}
      </code>
    </pre>
  );
}
