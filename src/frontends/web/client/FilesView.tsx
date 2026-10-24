/**
 * The Files page (issues 253 and 308): the vault's folders and the text of its files. Each folder
 * and file is a link, so the back button and a reload work as they do on any page. A wide screen
 * shows each folder of the path as a column and the open file at the right, as a Finder does. A
 * phone, or the "One folder" files view, shows the last one alone. The person can edit a text file
 * and save it in the vault, and rename a file or a folder (issue 343). A search finds a file or a
 * folder by its name, or by the text inside a file.
 */
import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import { api, ApiError, type BrowsedPath, type Favorite, type FileEntry, type SearchResult } from "./api.ts";
import { readAppearance } from "./appearance.ts";
import { useShowError } from "./error-toast.tsx";
import { codeTokens, prettyJson, viewOf } from "./code-view.ts";
import {
  childPath,
  fileAddressOf,
  filePathOf,
  isUnder,
  parentOf,
  pathCrumbs,
  sizeWords,
  splitFrontMatter,
} from "./file-paths.ts";
import { fileBadgeOf, nameEnds } from "./file-kinds.ts";
import { Icon } from "./icons.tsx";
import { ListSkeleton, ProgressBar } from "./Loading.tsx";
import { RenameForm } from "./RenameForm.tsx";
import { SaveButton } from "./SaveButton.tsx";
import { dayOf, smartName, type SmartName } from "./smart-names.ts";
import { toWebHtml } from "./web-format.ts";

type ShownFile = Extract<BrowsedPath, { kind: "file" }>;
type Answer =
  { readonly state: "shown"; readonly answer: BrowsedPath } | { readonly state: "failed"; readonly reason: string };

export function FilesView(): ReactElement {
  const [path, setPath] = useState(() => filePathOf(window.location.hash) ?? "");
  /** The answer for each path that the page read, so a column stays while the person goes deeper. */
  const [answers, setAnswers] = useState<ReadonlyMap<string, Answer>>(new Map());
  const [large, setLarge] = useState(false);
  /** The new name in the rename field, or null when the field is closed. */
  const [naming, setNaming] = useState<string | null>(null);
  /** A tap on the same link changes no address, so a failed read needs its own way to run again. */
  const [attempt, setAttempt] = useState(0);
  const columns = useRef<HTMLDivElement>(null);
  /** Null until the first read. A failed read shows no bar: the folders still work without it. */
  const [favorites, setFavorites] = useState<readonly Favorite[] | null>(null);
  /** The Appearance setting changes on the Settings page, so the page reads it once, as it opens. */
  const [smart] = useState(() => readAppearance().fileNames === "smart");
  /** The search field's text. A path that opens closes the search, so the folders show again. */
  const [query, setQuery] = useState("");
  const [inside, setInside] = useState(false);
  /** The answers of the last render, so the read below does not run again for each new answer. */
  const known = useRef(answers);
  known.current = answers;

  useEffect(() => {
    const onHashChange = (): void => {
      const next = filePathOf(window.location.hash);
      if (next !== null) setPath(next);
      setQuery("");
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  // An agent or another device can change the favorites, so each new path reads them again.
  useEffect(() => {
    api.favorites().then(setFavorites, () => setFavorites((current) => current ?? []));
  }, [path]);

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
  // The root keeps its name "Vault": it has no real name to tidy.
  const shownCrumbs = crumbs.map((crumb, index) => {
    const parentAnswer = index === 0 ? undefined : answers.get(crumbs[index - 1]?.path ?? "");
    const title =
      parentAnswer?.state === "shown" && parentAnswer.answer.kind === "folder"
        ? parentAnswer.answer.entries.find((entry) => entry.name === crumb.name)?.title
        : undefined;
    const shown = smart && index > 0 ? smartName(crumb.name, { title }) : { name: crumb.name, date: null };
    return { ...crumb, shown };
  });
  const lastCrumb = shownCrumbs[shownCrumbs.length - 1];
  const lastDate = lastCrumb?.shown.date ?? null;
  useEffect(() => {
    setLarge(false);
    setNaming(null);
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

  const rename = async (name: string): Promise<void> => {
    const renamed = (await api.renameFile(path, name)).path;
    if (renamed === path) return;
    moveDrafts(path, renamed);
    // The old answers name a path that is gone, so the new path and its folder read again.
    setAnswers((current) => new Map([...current].filter(([known]) => !isUnder(known, path))));
    const folder = parentOf(renamed);
    if (folder !== null) read(folder);
    // The old address names nothing now, so Back must not go there.
    window.location.replace(fileAddressOf(renamed));
  };

  const parent = parentOf(path);
  const last = answers.get(path);
  const fileIsOpen = last?.state === "shown" && last.answer.kind !== "folder";
  // The answer's path is the tidy one that the core stores, so the star matches the favorite.
  const shownPath = last?.state === "shown" ? last.answer.path : null;
  return (
    <div className="main">
      <div className={large ? "files-page large" : "files-page"}>
        <div className="files-header">
          {parent !== null && (
            <a className="files-up icon-button" href={fileAddressOf(parent)} aria-label="Up one folder">
              <Icon name="back" />
            </a>
          )}
          {naming !== null ? (
            <RenameForm
              label={`New name of ${crumbs[crumbs.length - 1]?.name ?? ""}`}
              draft={naming}
              onDraft={setNaming}
              onSave={rename}
              onEnd={() => setNaming(null)}
            />
          ) : (
            <nav className="files-crumbs" aria-label="Folder path">
              {shownCrumbs.map((crumb, index) =>
                index === shownCrumbs.length - 1 ? (
                  <h1 key={crumb.path} aria-current="page">
                    {crumb.shown.name}
                  </h1>
                ) : (
                  <span key={crumb.path} className="files-crumb">
                    <a
                      href={fileAddressOf(crumb.path)}
                      data-tooltip={crumb.shown.name === crumb.name ? undefined : crumb.name}
                    >
                      {crumb.shown.name}
                    </a>
                    <span aria-hidden="true">/</span>
                  </span>
                ),
              )}
              {lastDate !== null && <span className="pill files-date">{lastDate}</span>}
              {/* A touch screen shows no tooltip, so the real name stays in view under the smart one. */}
              {lastCrumb !== undefined && lastCrumb.shown.name !== lastCrumb.name && (
                <span className="files-real-name">
                  <span className="visually-hidden">Real name: </span>
                  {lastCrumb.name}
                </span>
              )}
            </nav>
          )}
          {naming === null && path !== "" && last?.state === "shown" && (
            <button
              className="files-rename icon-button"
              aria-label={`Rename ${crumbs[crumbs.length - 1]?.name ?? ""}`}
              data-tooltip="Rename"
              onClick={() => setNaming(crumbs[crumbs.length - 1]?.name ?? "")}
            >
              <Icon name="pen" />
            </button>
          )}
          {naming === null && shownPath !== null && shownPath !== "" && (
            <StarButton key={`star:${shownPath}`} path={shownPath} favorites={favorites} onChange={setFavorites} />
          )}
          {naming === null && last?.state === "shown" && last.answer.kind === "folder" && (
            <DownloadButton key={path} path={path} folder={true} />
          )}
        </div>
        <div className="files-search">
          {/* A button must not sit in a label, so only the icon and the text box share the label. */}
          <div className="search-field">
            <label className="files-search-text">
              <Icon name="search" />
              <input
                type="search"
                aria-label="Search the vault"
                placeholder="Search the vault"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <button
              type="button"
              className="choice-chip files-search-inside"
              aria-label="Search inside files"
              aria-pressed={inside}
              data-tooltip="Also search the text of each file"
              onClick={() => setInside((on) => !on)}
            >
              {inside && <Icon name="check" className="choice-tick" />}
              Inside files
            </button>
          </div>
        </div>
        {query.trim() !== "" ? (
          <SearchResults query={query.trim()} inside={inside} smart={smart} />
        ) : (
          <>
            <FavoriteBar favorites={favorites} openPath={shownPath} smart={smart} onChange={setFavorites} />
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
                  smart={smart}
                  large={large}
                  onLarge={setLarge}
                  onSaved={onSaved}
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
          </>
        )}
      </div>
    </div>
  );
}

type Search =
  | { readonly state: "waiting" }
  | { readonly state: "shown"; readonly result: SearchResult }
  | { readonly state: "failed"; readonly reason: string };

/** The wait after the last key, so a search runs once per word and not once per letter. */
const searchPause = 300;

/** The matches of the search, each a link that opens the file or the folder. */
function SearchResults({
  query,
  inside,
  smart,
}: {
  readonly query: string;
  readonly inside: boolean;
  readonly smart: boolean;
}): ReactElement {
  const [search, setSearch] = useState<Search>({ state: "waiting" });
  useEffect(() => {
    setSearch({ state: "waiting" });
    // A slow answer for an old query never replaces the answer for the new one.
    let current = true;
    const timer = setTimeout(() => {
      api.searchFiles(query, inside).then(
        (result) => current && setSearch({ state: "shown", result }),
        (error: unknown) =>
          current && setSearch({ state: "failed", reason: error instanceof Error ? error.message : String(error) }),
      );
    }, searchPause);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [query, inside]);
  if (search.state === "waiting")
    return (
      <div className="files-pane">
        <ListSkeleton label="Searching the vault…" rows={6} />
      </div>
    );
  if (search.state === "failed")
    return (
      <div role="alert" className="callout danger">
        {search.reason}
      </div>
    );
  const { matches, complete } = search.result;
  return (
    <div className="files-pane files-search-results">
      {matches.length === 0 ? (
        <div className="empty">
          {inside
            ? "No file or folder holds this text."
            : "No file or folder has this name. Try a search inside files."}
        </div>
      ) : (
        <ul className="files-list" aria-label="Search results">
          {matches.map((match) => {
            const shown = shownNameOf(match.name, smart, { title: match.title, badge: match.kind === "file" });
            const spoken = shownNameOf(match.name, smart, { title: match.title }).name;
            const folder = parentOf(match.path) ?? "";
            return (
              <li key={match.path}>
                <a className="files-entry" href={fileAddressOf(match.path)} data-tooltip={match.path}>
                  {match.kind === "folder" ? <Icon name="folder" /> : <FileIcon name={match.name} />}
                  <span className="files-search-match">
                    <span className="files-search-name">
                      <FileName shown={shown} spoken={spoken} />
                    </span>
                    {folder !== "" && <span className="files-search-path">{folder}</span>}
                    {match.line !== undefined && (
                      <span className="files-search-line">
                        <span className="visually-hidden">Line {match.line.number}: </span>
                        {match.line.text}
                      </span>
                    )}
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
      )}
      {!complete && (
        <div role="status" className="callout">
          Eva stopped at the first matches. Type more words to find fewer.
        </div>
      )}
    </div>
  );
}

interface ColumnProps {
  readonly path: string;
  readonly name: string;
  readonly answer: Answer | undefined;
  readonly isLast: boolean;
  readonly openChild: string | null;
  readonly smart: boolean;
  readonly large: boolean;
  readonly onLarge: (large: boolean) => void;
  readonly onSaved: (saved: BrowsedPath) => void;
  readonly onTryAgain: () => void;
}

/** One folder of the path, or the open file. A phone shows only the last column. */
function Column({
  path,
  name,
  answer,
  isLast,
  openChild,
  smart,
  large,
  onLarge,
  onSaved,
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
        <FolderList path={path} name={name} entries={shown.entries} openChild={openChild} smart={smart} />
      </div>
    );
  if (!isLast) return null;
  if (shown.kind === "unreadable")
    return (
      <div className="files-pane files-preview">
        <div role="status" className="callout warning">
          {shown.reason} <span className="files-size">({sizeWords(shown.size)})</span>
        </div>
        {shown.downloadable && <DownloadButton key={path} path={path} folder={false} />}
      </div>
    );
  // A new file starts outside the editor, with its own view.
  return <FilePreview key={path} file={shown} large={large} onLarge={onLarge} onSaved={onSaved} />;
}

/**
 * Saves a file, or a folder as one zip, on the person's device. A browser saves one file per
 * link, so a folder needs the zip. The zip has no compression, so Eva builds it fast.
 */
function DownloadButton({
  path,
  folder,
  iconOnly = false,
}: {
  readonly path: string;
  readonly folder: boolean;
  /** A full file bar has room for an icon only, as the size button beside it. */
  readonly iconOnly?: boolean;
}): ReactElement {
  const [share, setShare] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const start = async (): Promise<void> => {
    setBusy(true);
    setShare(null);
    setProblem(null);
    try {
      const { name, blob } = await api.downloadFile(path, setShare);
      const address = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = address;
      link.download = name;
      link.click();
      // Safari starts the save after the click returns, so the address must live a while.
      setTimeout(() => URL.revokeObjectURL(address), 60_000);
    } catch (caught) {
      setProblem(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };
  const label = folder ? "Download as zip" : "Download";
  return (
    <div className="files-download">
      <button
        className={iconOnly ? "icon-button" : "ghost"}
        onClick={() => void start()}
        disabled={busy}
        aria-label={folder ? "Download this folder as a zip file" : "Download this file"}
        data-tooltip={iconOnly ? label : undefined}
      >
        <Icon name="download" />
        {!iconOnly && <span className="files-download-label">{label}</span>}
      </button>
      {busy && <ProgressBar label={folder ? "Packing the folder…" : "Downloading…"} share={share} />}
      {problem !== null && (
        <div role="alert" className="callout danger">
          {problem}
        </div>
      )}
    </div>
  );
}

/** Adds the open file or folder to the favorites, or removes it. A filled star marks a favorite. */
function StarButton({
  path,
  favorites,
  onChange,
}: {
  readonly path: string;
  readonly favorites: readonly Favorite[] | null;
  readonly onChange: (favorites: readonly Favorite[]) => void;
}): ReactElement | null {
  const showError = useShowError();
  const [busy, setBusy] = useState(false);
  if (favorites === null) return null;
  const isFavorite = favorites.some((favorite) => favorite.path === path);
  const toggle = async (): Promise<void> => {
    setBusy(true);
    try {
      onChange(await api.setFavorite(path, !isFavorite));
    } catch (caught) {
      showError(caught);
    } finally {
      setBusy(false);
    }
  };
  const label = isFavorite ? "Remove from favorites" : "Add to favorites";
  return (
    <button
      className={isFavorite ? "files-star icon-button favorite" : "files-star icon-button"}
      aria-label={label}
      aria-pressed={isFavorite}
      data-tooltip={label}
      disabled={busy}
      onClick={() => void toggle()}
    >
      <Icon name="star" />
    </button>
  );
}

/**
 * The favorites, first on the page, so a note that the person opens often is one tap away. A
 * favorite that was moved or deleted stays, with a button to remove it.
 */
function FavoriteBar({
  favorites,
  openPath,
  smart,
  onChange,
}: {
  readonly favorites: readonly Favorite[] | null;
  readonly openPath: string | null;
  readonly smart: boolean;
  readonly onChange: (favorites: readonly Favorite[]) => void;
}): ReactElement | null {
  const showError = useShowError();
  if (favorites === null || favorites.length === 0) return null;
  const remove = async (path: string): Promise<void> => {
    try {
      onChange(await api.setFavorite(path, false));
    } catch (caught) {
      showError(caught);
    }
  };
  return (
    <nav className="files-favorites" aria-label="Favorites">
      <ul>
        {favorites.map((favorite) => {
          // The date stays, so two dated notes with the same name never look the same.
          const shown = shownNameOf(favorite.name, smart, { title: favorite.title });
          return (
            <li key={favorite.path}>
              {favorite.kind === "missing" ? (
                <span className="files-favorite missing" data-tooltip={favorite.path}>
                  <Icon name="alert" />
                  <span className="files-name">{favorite.name}</span>
                  <span className="files-size">Missing</span>
                  <button
                    className="icon-button"
                    aria-label={`Remove ${favorite.name} from favorites`}
                    onClick={() => void remove(favorite.path)}
                  >
                    <Icon name="x" />
                  </button>
                </span>
              ) : (
                <a
                  className="files-favorite"
                  href={fileAddressOf(favorite.path)}
                  data-tooltip={favorite.path}
                  aria-current={favorite.path === openPath ? "page" : undefined}
                >
                  <Icon name={favorite.kind === "folder" ? "folder" : "file"} />
                  <span className="files-name">{shown.name}</span>
                  {shown.date !== null && <span className="pill files-date">{dayOf(shown.date)}</span>}
                </a>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function FolderList({
  path,
  name,
  entries,
  openChild,
  smart,
}: {
  readonly path: string;
  readonly name: string;
  readonly entries: readonly FileEntry[];
  readonly openChild: string | null;
  readonly smart: boolean;
}): ReactElement {
  const list = useRef<HTMLUListElement>(null);
  // A link from a favorite or another page can open an entry far down a long folder, so its row scrolls into sight.
  useEffect(() => {
    const element = list.current;
    const open = element?.querySelector('[aria-current="true"]');
    if (element === null || open === null || open === undefined) return;
    const box = element.getBoundingClientRect();
    const row = open.getBoundingClientRect();
    if (row.top >= box.top && row.bottom <= box.bottom) return;
    // Only the list scrolls: scrollIntoView would also move the page and the row of columns.
    element.scrollTop += row.top - box.top - (box.height - row.height) / 2;
  }, [openChild, entries]);
  if (entries.length === 0) return <div className="empty">This folder is empty.</div>;
  return (
    <ul className="files-list" ref={list} aria-label={`Contents of ${name}`}>
      {entries.map((entry) => {
        // Only a file row shows a type badge, so only a file can drop its extension.
        const shown = shownNameOf(entry.name, smart, { title: entry.title, badge: entry.kind === "file" });
        // The badge is hidden from a screen reader, so the spoken name keeps the extension.
        const spoken = shownNameOf(entry.name, smart, { title: entry.title }).name;
        const realName = shown.name === entry.name ? undefined : entry.name;
        return (
          <li key={entry.name}>
            {entry.kind === "other" ? (
              <span className="files-entry other" data-tooltip={realName}>
                <Icon name="info" />
                <FileName shown={shown} spoken={spoken} />
                <span className="files-size">Does not open</span>
              </span>
            ) : (
              <a
                className="files-entry"
                href={fileAddressOf(childPath(path, entry.name))}
                aria-current={entry.name === openChild ? "true" : undefined}
                data-tooltip={realName}
              >
                {entry.kind === "folder" ? <Icon name="folder" /> : <FileIcon name={entry.name} />}
                <FileName shown={shown} spoken={spoken} />
                {entry.size !== null && <span className="files-size">{sizeWords(entry.size)}</span>}
              </a>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** The smart name of the Appearance setting, or the real name with no date. */
function shownNameOf(real: string, smart: boolean, options: Parameters<typeof smartName>[1]): SmartName {
  return smart ? smartName(real, options) : { name: real, date: null };
}

/** A file with a known short extension shows it on a small page, in the colour of its type. */
function FileIcon({ name }: { readonly name: string }): ReactElement {
  const badge = fileBadgeOf(name);
  if (badge === null) return <Icon name="file" />;
  return (
    <span className={`files-badge type-${badge.tone}`} aria-hidden="true">
      {badge.label}
    </span>
  );
}

/**
 * A name on one line. When it does not fit, the start, the middle or the end gives way to "…", as
 * the Appearance setting says. The open file shows its whole name in the path above.
 */
function FileName({ shown, spoken }: { readonly shown: SmartName; readonly spoken: string }): ReactElement {
  const { head, tail } = nameEnds(shown.name);
  return (
    <>
      <span className="files-name">
        {/* A flex box splits the name in two words for a screen reader, so it reads the whole name instead. */}
        <span className="visually-hidden">{spoken}</span>
        {/* The isolate keeps the letters in order when a cut at the start turns the box right to left. */}
        <span className="files-name-text" dir="ltr" aria-hidden="true">
          <span className="files-name-head">{head}</span>
          <span className="files-name-tail">{tail}</span>
        </span>
      </span>
      {shown.date !== null && <span className="pill files-date">{dayOf(shown.date)}</span>}
    </>
  );
}

interface Draft {
  readonly text: string;
  /** The version that the edit started from, so a save after a change on disk answers `file_changed`. */
  readonly version: string;
}

/**
 * The changed drafts by path. They live outside the page, so a tap on another file, another page
 * or Back keeps the edit, and the file opens in its editor again.
 */
const drafts = new Map<string, Draft>();
let leaveGuard = false;

/** A browser text area gives LF only, so a Windows file must not look changed. */
const sameText = (first: string, second: string): boolean =>
  first.replaceAll("\r\n", "\n") === second.replaceAll("\r\n", "\n");

function keepDraft(path: string, draft: Draft | null, onDisk: string): void {
  if (draft === null || sameText(draft.text, onDisk)) drafts.delete(path);
  else drafts.set(path, draft);
  if (leaveGuard) return;
  leaveGuard = true;
  // A reload or a closed tab would drop the drafts, so the browser asks first.
  window.addEventListener("beforeunload", (event) => {
    if (drafts.size > 0) event.preventDefault();
  });
}

/** A renamed file or folder takes its drafts, and the drafts of the files inside it, to the new path. */
function moveDrafts(from: string, to: string): void {
  for (const [path, draft] of [...drafts]) {
    if (!isUnder(path, from)) continue;
    drafts.delete(path);
    drafts.set(to + path.slice(from.length), draft);
  }
}

interface FilePreviewProps {
  readonly file: ShownFile;
  readonly large: boolean;
  readonly onLarge: (large: boolean) => void;
  readonly onSaved: (saved: BrowsedPath) => void;
}

function FilePreview({ file, large, onLarge, onSaved }: FilePreviewProps): ReactElement {
  const [plain, setPlain] = useState(false);
  /** The edit, or null outside the editor. */
  const [draft, setDraftState] = useState<Draft | null>(() => drafts.get(file.path) ?? null);
  const [problem, setProblem] = useState<{ readonly text: string; readonly changed: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  /** The editor closes at a save, so its button cannot show the check: the bar says it. */
  const [saved, setSaved] = useState(false);
  const setDraft = (next: Draft | null, onDisk = file.text): void => {
    keepDraft(file.path, next, onDisk);
    setDraftState(next);
  };
  const view = viewOf(file.path);

  useEffect(() => {
    if (!large) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onLarge(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [large, onLarge]);

  const unsaved = draft !== null && !sameText(draft.text, file.text);

  const save = async (): Promise<boolean> => {
    if (draft === null) return false;
    setBusy(true);
    setProblem(null);
    try {
      onSaved(await api.saveFile(file.path, draft.version, draft.text));
      setDraft(null);
      setSaved(true);
      return true;
    } catch (caught) {
      const changed = caught instanceof ApiError && caught.code === "file_changed";
      setProblem({ text: caught instanceof Error ? caught.message : String(caught), changed });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const loadAgain = async (): Promise<void> => {
    setProblem(null);
    try {
      const answer = await api.files(file.path);
      onSaved(answer);
      if (answer.kind === "file") setDraft({ text: answer.text, version: answer.version }, answer.text);
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
              {saved && (
                <span role="status" className="files-size">
                  <Icon name="check" /> Saved
                </span>
              )}
              {(view === "markdown" || view === "json") && (
                <button className="ghost" onClick={() => setPlain(!plain)}>
                  {plain ? "Show formatted" : "Show plain text"}
                </button>
              )}
              {file.editable ? (
                <button
                  onClick={() => {
                    setSaved(false);
                    setDraft({ text: file.text, version: file.version });
                  }}
                >
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
          <DownloadButton path={file.path} folder={false} iconOnly={true} />
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
          value={draft.text}
          spellCheck={false}
          autoFocus
          onChange={(event) => setDraft({ ...draft, text: event.target.value })}
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
