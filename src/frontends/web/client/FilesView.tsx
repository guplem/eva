/**
 * The Files page (issues 253 and 308): the vault's folders and the text of its files. Each folder
 * and file is a link, so the back button and a reload work as they do on any page. A wide screen
 * shows each folder of the path as a column and the open file at the right, as a Finder does. A
 * phone, or the "One folder" files view, shows the last one alone. The person can edit a text file
 * and save it in the vault, and rename a file or a folder (issue 343). A search finds a file or a
 * folder by its name, or by the text inside a file.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from "react";
import {
  api,
  ApiError,
  type BacklinksResult,
  type BrowsedPath,
  type Favorite,
  type FileEntry,
  type SearchResult,
} from "./api.ts";
import { goTo } from "./back-layers.ts";
import { Dialog } from "./Dialog.tsx";
import { readAppearance } from "./appearance.ts";
import { ColumnDivider } from "./ColumnDivider.tsx";
import { copyText } from "./CopyButton.tsx";
import { FileBar } from "./FileBar.tsx";
import { DownloadButton, DownloadWait, useDownload, type FetchFile } from "./DownloadButton.tsx";
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
import { decryptedNameOf, fileBadgeOf, nameEnds, shownMediaOf } from "./file-kinds.ts";
import { MediaPreview } from "./FileMedia.tsx";
import { Icon } from "./icons.tsx";
import { ButtonSpinner, ListSkeleton, ProgressBar } from "./Loading.tsx";
import { MoreMenu, useContextMenu, type MenuItem } from "./Menu.tsx";
import { MarkdownBody } from "./MarkdownBody.tsx";
import { SaveButton } from "./SaveButton.tsx";
import { opensNewTab } from "./new-tab.ts";
import { Toast } from "./Toast.tsx";
import { UnlockVaultForm } from "./VaultPasswordForms.tsx";
import {
  draftOf,
  dropDrafts,
  hasDraftUnder,
  hasEncryptedDraft,
  keepDraft,
  moveDrafts,
  sameText,
  type Draft,
} from "./file-drafts.ts";
import {
  entryMenuItems,
  folderBackgroundItems,
  openFileItems,
  type EntryActions,
  type EntryFacts,
  type OpenFileItems,
} from "./file-actions.ts";
import { RenameDialog } from "./ChatHeader.tsx";
import { dayOf, smartName, type SmartName } from "./smart-names.ts";
import { toWebHtml } from "./web-format.ts";

type ShownFile = Extract<BrowsedPath, { kind: "file" }>;
type SearchMatch = SearchResult["matches"][number];
/** The dialog that asks for a name: a new file or folder in a folder, or a new name for an entry. */
type Asking =
  | { readonly kind: "new"; readonly folder: string; readonly entry: "file" | "folder" }
  | { readonly kind: "rename"; readonly path: string; readonly name: string };
type Answer =
  { readonly state: "shown"; readonly answer: BrowsedPath } | { readonly state: "failed"; readonly reason: string };

export function FilesView(): ReactElement {
  const [path, setPath] = useState(() => filePathOf(window.location.hash) ?? "");
  /** The answer for each path that the page read, so a column stays while the person goes deeper. */
  const [answers, setAnswers] = useState<ReadonlyMap<string, Answer>>(new Map());
  const [large, setLarge] = useState(false);
  /** The wrap stays on or off while the person opens other files. It starts on: a phone has no room for long lines. */
  const [wrap, setWrap] = useState(true);
  /** The open dialog that asks for a name: a new file or folder, or a rename. */
  const [asking, setAsking] = useState<Asking | null>(null);
  /** A download from a menu. The key starts a new one for the same path. */
  const [downloading, setDownloading] = useState<{ path: string; folder: boolean; key: number } | null>(null);
  const [encrypting, setEncrypting] = useState(false);
  /** A short message, such as "Copied.". The count starts the toast again for the same message. */
  const [notice, setNotice] = useState<{ text: string; count: number } | null>(null);
  /** A new file opens in the editor, so the person types at once. */
  const [editOnOpen, setEditOnOpen] = useState<string | null>(null);
  const showError = useShowError();
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
  /** The width that the person dragged each folder column to, by path. A reload forgets it (issue 626). */
  const [widths, setWidths] = useState<ReadonlyMap<string, number>>(new Map());
  /** The answers of the last render, so the read below does not run again for each new answer. */
  /** The vault folder on this computer, for "Copy full path". Null until known, or when the read fails. */
  const [vaultFolder, setVaultFolder] = useState<string | null>(null);
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

  useEffect(() => {
    api.status().then(
      (status) => setVaultFolder(status.vaultPath),
      () => undefined,
    );
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
    setEditOnOpen((current) => (current === path ? current : null));
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

  const notify = (text: string): void => setNotice((current) => ({ text, count: (current?.count ?? 0) + 1 }));

  const rename = async (from: string, name: string): Promise<void> => {
    const renamed = (await api.renameFile(from, name)).path;
    if (renamed === from) return;
    moveDrafts(from, renamed);
    moved(from, renamed);
  };

  const decrypt = async (): Promise<void> => {
    const decrypted = (await api.decryptFile(path)).path;
    // The draft's version belongs to the encrypted bytes. The confirmation said that it goes.
    keepDraft(path, null, "");
    moved(path, decrypted);
  };

  /**
   * Shows the new path of an entry after a rename or an encryption. When the open path was the entry
   * or inside it, the page opens its new path.
   */
  const moved = (from: string, to: string): void => {
    // A renamed folder keeps the width that the person gave it.
    setWidths(
      (current) =>
        new Map(
          [...current].map(([known, width]) => [isUnder(known, from) ? to + known.slice(from.length) : known, width]),
        ),
    );
    // The old answers name a path that is gone, so the new path and its folder read again.
    setAnswers((current) => new Map([...current].filter(([known]) => !isUnder(known, from))));
    read(parentOf(to) ?? "");
    // The old address names nothing now, so Back must not go there.
    if (isUnder(path, from)) window.location.replace(fileAddressOf(to + path.slice(from.length)));
  };

  const encrypt = async (entryPath: string, name: string): Promise<void> => {
    // The question says what the git history keeps before the change, not after it (#1110).
    const plain = await api.plainHistory(entryPath).catch(() => null);
    const history =
      plain === true
        ? " Its old plain versions stay on the vault remote: change each key or password in it."
        : plain === false
          ? ""
          : " Its old versions stay in the git history.";
    const unsaved = draftOf(entryPath) === undefined ? "" : " Your unsaved changes are lost.";
    const question = `Encrypt ${name}? It becomes ${name}.eva-secret, and only the vault password opens it.${history}${unsaved}`;
    if (!window.confirm(question)) return;
    setEncrypting(true);
    try {
      const encrypted = (await api.encryptFile(entryPath)).path;
      // An unsaved edit is plain text with no mark of an encrypted file. The confirmation said that it goes.
      keepDraft(entryPath, null, "");
      moved(entryPath, encrypted);
    } catch (caught) {
      showError(caught);
    } finally {
      setEncrypting(false);
    }
  };

  const remove = async (entryPath: string, name: string, folder: boolean): Promise<void> => {
    const what = folder ? `the folder ${name} and everything in it` : name;
    const unsaved = hasDraftUnder(entryPath);
    const question = `Delete ${what}? The vault's history keeps the last saved version.${unsaved ? " Your unsaved changes are lost." : ""}`;
    if (!window.confirm(question)) return;
    try {
      await api.deleteFile(entryPath);
    } catch (caught) {
      showError(caught);
      return;
    }
    dropDrafts(entryPath);
    setAnswers((current) => new Map([...current].filter(([known]) => !isUnder(known, entryPath))));
    const folderPath = parentOf(entryPath) ?? "";
    read(folderPath);
    api.favorites().then(setFavorites, () => undefined);
    notify(`Deleted ${name}.`);
    // The open entry is gone, so the page shows its folder, and Back does not lead to it.
    if (isUnder(path, entryPath)) window.location.replace(fileAddressOf(folderPath));
  };

  const actions: EntryActions = {
    newEntry: (folder, kind) => setAsking({ kind: "new", folder, entry: kind }),
    rename: (entryPath, name) => setAsking({ kind: "rename", path: entryPath, name }),
    duplicate: (entryPath) => {
      api.duplicateFile(entryPath).then(
        (copy) => {
          read(parentOf(copy.path) ?? "");
          notify(`Made ${copy.path.split("/").pop() ?? copy.path}.`);
        },
        (caught: unknown) => showError(caught),
      );
    },
    remove: (entryPath, name, folder) => void remove(entryPath, name, folder),
    copy: (text) => {
      copyText(text).then(
        () => notify("Copied."),
        (caught: unknown) => showError(caught),
      );
    },
    download: (entryPath, folder) => setDownloading({ path: entryPath, folder, key: Date.now() }),
    encrypt: (entryPath, name) => void encrypt(entryPath, name),
    favorite: (entryPath, on) => {
      api.setFavorite(entryPath, on).then(setFavorites, (caught: unknown) => showError(caught));
    },
  };

  /** The facts of an entry for its menu. The favorites are null until read, so no star shows. */
  const factsOf = (entryPath: string, name: string, kind: EntryFacts["kind"]): EntryFacts => ({
    path: entryPath,
    name,
    kind,
    favorite: favorites === null ? null : favorites.some((favorite) => favorite.path === entryPath),
    vaultFolder,
  });

  const menuOf: MenuOf = (entryPath, name, kind, open) => entryMenuItems(factsOf(entryPath, name, kind), actions, open);

  const create = async (folder: string, name: string, kind: "file" | "folder"): Promise<void> => {
    const made = (await api.createFile(folder, name, kind)).path;
    read(folder);
    if (kind === "file") setEditOnOpen(made);
    goTo(fileAddressOf(made));
  };

  const parent = parentOf(path);
  const last = answers.get(path);
  const fileIsOpen = last?.state === "shown" && last.answer.kind !== "folder";
  // The answer's path is the tidy one that the core stores, so the star matches the favorite.
  const shownPath = last?.state === "shown" ? last.answer.path : null;
  const openName = crumbs[crumbs.length - 1]?.name ?? "";
  // A text file and a media file show their menu in their own bar. Any other entry shows it here.
  const headerKind: EntryFacts["kind"] | null =
    last?.state !== "shown"
      ? null
      : last.answer.kind === "folder"
        ? "folder"
        : last.answer.kind === "encrypted"
          ? "encrypted"
          : last.answer.kind === "unreadable" && shownMediaOf(path, last.answer) === null
            ? "file"
            : null;
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
          {shownPath !== null && shownPath !== "" && (
            <StarButton key={`star:${shownPath}`} path={shownPath} favorites={favorites} onChange={setFavorites} />
          )}
          {headerKind !== null && (
            <MoreMenu
              items={entryMenuItems(factsOf(path, openName, headerKind), actions)}
              label={headerKind === "folder" ? "Folder actions" : "File actions"}
            />
          )}
        </div>
        {asking !== null && (
          <RenameDialog
            key={asking.kind === "new" ? `new:${asking.folder}:${asking.entry}` : `rename:${asking.path}`}
            heading={
              asking.kind === "new" ? (asking.entry === "file" ? "New file" : "New folder") : `Rename ${asking.name}`
            }
            label={asking.kind === "new" ? "Name" : "New name"}
            original={asking.kind === "new" ? "" : asking.name}
            onSave={(name) =>
              asking.kind === "new" ? create(asking.folder, name, asking.entry) : rename(asking.path, name)
            }
            onEnd={() => setAsking(null)}
            onChanged={() => Promise.resolve()}
          />
        )}
        {downloading !== null && (
          <MenuDownload
            key={downloading.key}
            path={downloading.path}
            folder={downloading.folder}
            onEnd={() => setDownloading(null)}
          />
        )}
        {encrypting && (
          <Toast message="Encrypting and saving the file…" role={null}>
            <ProgressBar label="Encrypting and saving the file…" />
          </Toast>
        )}
        {notice !== null && <Toast key={notice.count} message={notice.text} onClose={() => setNotice(null)} />}
        {/* The large file gets the whole page, so the search and the favorites step aside. */}
        {!large && (
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
        )}
        {query.trim() !== "" ? (
          <SearchResults query={query.trim()} inside={inside} smart={smart} />
        ) : (
          <>
            {!large && <FavoriteBar favorites={favorites} openPath={shownPath} smart={smart} onChange={setFavorites} />}
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
                  wrap={wrap}
                  onWrap={setWrap}
                  onSaved={onSaved}
                  onDecrypt={decrypt}
                  onTryAgain={() => setAttempt((count) => count + 1)}
                  menuOf={menuOf}
                  backgroundMenu={folderBackgroundItems(crumb.path, actions)}
                  startEditing={editOnOpen === crumb.path}
                  width={widths.get(crumb.path) ?? null}
                  onWidth={(width) =>
                    setWidths((current) => {
                      const next = new Map(current);
                      if (width === null) next.delete(crumb.path);
                      else next.set(crumb.path, width);
                      return next;
                    })
                  }
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
          {matches.map((match) => (
            <MatchRow key={match.path} match={match} smart={smart} />
          ))}
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

/** One found file or folder: its name, its folder and the line that matched, as a link that opens it. */
function MatchRow({
  match,
  smart,
  onOpen,
}: {
  readonly match: SearchMatch;
  readonly smart: boolean;
  /** Opens the match instead of the plain link, such as from a dialog that must close first. */
  readonly onOpen?: () => void;
}): ReactElement {
  const shown = shownNameOf(match.name, smart, { title: match.title, badge: match.kind === "file" });
  const spoken = shownNameOf(match.name, smart, { title: match.title }).name;
  const folder = parentOf(match.path) ?? "";
  return (
    <li>
      <a
        className="files-entry"
        href={fileAddressOf(match.path)}
        data-tooltip={match.path}
        onClick={
          onOpen === undefined
            ? undefined
            : (event) => {
                // A Ctrl click keeps the link of the browser, so the note opens in a new tab.
                if (opensNewTab(event)) return;
                event.preventDefault();
                onOpen();
              }
        }
      >
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
}

type Backlinks =
  | { readonly state: "waiting" }
  | { readonly state: "shown"; readonly result: BacklinksResult }
  | { readonly state: "failed"; readonly reason: string };

/**
 * The button with the number of notes that link to the open file (#992). A press lists them in a
 * dialog, which a phone shows as a sheet. A press on a note opens it.
 */
function BacklinksButton({ path, smart }: { readonly path: string; readonly smart: boolean }): ReactElement {
  const [backlinks, setBacklinks] = useState<Backlinks>({ state: "waiting" });
  const [open, setOpen] = useState(false);
  useEffect(() => {
    // A slow answer for a file that the person left never shows.
    let current = true;
    api.fileBacklinks(path).then(
      (result) => current && setBacklinks({ state: "shown", result }),
      (error: unknown) =>
        current && setBacklinks({ state: "failed", reason: error instanceof Error ? error.message : String(error) }),
    );
    return () => {
      current = false;
    };
  }, [path]);
  const count =
    backlinks.state === "shown"
      ? `${String(backlinks.result.links.length)}${backlinks.result.complete ? "" : "+"}`
      : backlinks.state === "failed"
        ? "!"
        : "";
  const label =
    backlinks.state === "shown"
      ? `Notes that link here: ${count}`
      : backlinks.state === "failed"
        ? "Notes that link here: Eva could not find them"
        : "Finding the notes that link here";
  return (
    <>
      <button
        className="files-backlinks"
        aria-label={label}
        data-tooltip={label}
        aria-busy={backlinks.state === "waiting"}
        onClick={() => setOpen(true)}
      >
        {backlinks.state === "waiting" ? <ButtonSpinner /> : <Icon name="link" />}
        {count}
      </button>
      {open && (
        <Dialog label="Linked from" onClose={() => setOpen(false)} scrimCloses={true}>
          <h2>Linked from</h2>
          {backlinks.state === "waiting" && <ListSkeleton label="Finding the notes that link here…" rows={3} />}
          {backlinks.state === "failed" && (
            <div role="alert" className="callout danger">
              {backlinks.reason}
            </div>
          )}
          {backlinks.state === "shown" &&
            (backlinks.result.links.length === 0 ? (
              <p className="empty">No note links to this file.</p>
            ) : (
              <ul className="files-list files-backlinks-list" aria-label="Notes that link here">
                {backlinks.result.links.map((link) => (
                  <MatchRow
                    key={link.path}
                    match={{ ...link, kind: "file" }}
                    smart={smart}
                    onOpen={() => {
                      setOpen(false);
                      goTo(fileAddressOf(link.path));
                    }}
                  />
                ))}
              </ul>
            ))}
          {backlinks.state === "shown" && !backlinks.result.complete && (
            <div role="status" className="callout">
              Eva stopped at the first notes. More notes can link here.
            </div>
          )}
        </Dialog>
      )}
    </>
  );
}

/** Builds the one menu of an entry. The open file passes its own items. */
type MenuOf = (path: string, name: string, kind: EntryFacts["kind"], open?: OpenFileItems) => MenuItem[];

interface ColumnProps {
  readonly path: string;
  readonly name: string;
  readonly answer: Answer | undefined;
  readonly isLast: boolean;
  readonly openChild: string | null;
  readonly smart: boolean;
  readonly large: boolean;
  readonly onLarge: (large: boolean) => void;
  readonly wrap: boolean;
  readonly onWrap: (wrap: boolean) => void;
  readonly onSaved: (saved: BrowsedPath) => void;
  /** Decrypts the open `.eva-secret` file, and opens its new path. */
  readonly onDecrypt: () => Promise<void>;
  readonly onTryAgain: () => void;
  /** The width that the person dragged a folder column to, or null for the usual width. */
  readonly width: number | null;
  readonly onWidth: (width: number | null) => void;
  readonly menuOf: MenuOf;
  /** The menu of a press beside the rows of this folder. */
  readonly backgroundMenu: readonly MenuItem[];
  /** True for a file that the person just made, so it opens in the editor. */
  readonly startEditing: boolean;
}

/** The narrowest folder column, as the `min-width` of `.files-pane` in `files.css`. */
const columnMinWidth = 180;

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
  wrap,
  onWrap,
  onSaved,
  onDecrypt,
  onTryAgain,
  width,
  onWidth,
  menuOf,
  backgroundMenu,
  startEditing,
}: ColumnProps): ReactElement | null {
  // A folder that reads again keeps its width, so the row does not jump while it loads.
  const place = `${isLast ? "files-pane" : "files-pane files-parent"}${width === null ? "" : " resized"}`;
  const sized = width === null ? undefined : ({ "--files-width": `${String(width)}px` } as CSSProperties);
  const background = useContextMenu(backgroundMenu, `Actions for ${name}`);
  if (answer === undefined)
    return (
      <div className={place} style={sized}>
        <ListSkeleton label="Loading the folder…" rows={5} shape="files" />
      </div>
    );
  if (answer.state === "failed")
    return (
      <div className={place} style={sized}>
        <div role="alert" className="callout danger callout-action">
          <span>{answer.reason}</span>
          <button onClick={onTryAgain}>Try again</button>
        </div>
      </div>
    );
  const shown = answer.answer;
  if (shown.kind === "folder")
    return (
      // A right click beside the rows makes a new file or folder here. Each row keeps its own menu.
      <div className={place} style={sized} {...background.props}>
        <FolderList
          path={path}
          name={name}
          entries={shown.entries}
          openChild={openChild}
          smart={smart}
          menuOf={menuOf}
        />
        <ColumnDivider label={`Resize the column ${name}`} minWidth={columnMinWidth} onWidth={onWidth} />
        {background.menu}
      </div>
    );
  if (!isLast) return null;
  // A file that Eva may not download, such as a secrets file, never shows either.
  const media = shownMediaOf(path, shown);
  if (media !== null && (shown.kind === "unreadable" || shown.kind === "file"))
    // The size is in the key, so a file that changes on disk shows its new bytes.
    return (
      <MediaPreview
        key={`${path}:${String(shown.size)}`}
        path={path}
        size={shown.size}
        media={media}
        large={large}
        onLarge={onLarge}
        menu={(open) => menuOf(path, name, "file", open)}
      />
    );
  if (shown.kind === "encrypted")
    return (
      <EncryptedFile
        key={path}
        path={path}
        size={shown.size}
        large={large}
        onLarge={onLarge}
        wrap={wrap}
        onWrap={onWrap}
        smart={smart}
        onDecrypt={onDecrypt}
      />
    );
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
  return (
    <FilePreview
      key={path}
      file={shown}
      large={large}
      onLarge={onLarge}
      wrap={wrap}
      onWrap={onWrap}
      onSaved={onSaved}
      smart={smart}
      menu={(open) => menuOf(path, name, "file", open)}
      startEditing={startEditing}
    />
  );
}

type Opened =
  | { readonly state: "loading" }
  | { readonly state: "locked"; readonly hasKey: boolean }
  | { readonly state: "failed"; readonly reason: string }
  | { readonly state: "text"; readonly file: ShownFile }
  | { readonly state: "binary" };

/**
 * A file that the vault keeps encrypted (#707). This tab opens it after an unlock with the vault
 * password. The text stays in this page only: no list, cache or event holds it.
 */
function EncryptedFile({
  path,
  size,
  large,
  onLarge,
  wrap,
  onWrap,
  smart,
  onDecrypt,
}: {
  readonly path: string;
  readonly size: number;
  readonly large: boolean;
  readonly onLarge: (large: boolean) => void;
  readonly wrap: boolean;
  readonly onWrap: (wrap: boolean) => void;
  readonly smart: boolean;
  readonly onDecrypt: () => Promise<void>;
}): ReactElement {
  const showError = useShowError();
  const [opened, setOpened] = useState<Opened>({ state: "loading" });
  const [decrypting, setDecrypting] = useState(false);
  const fileName = path.split("/").pop() ?? "file";
  const name = decryptedNameOf(fileName);
  // Only the end that the Encrypt action adds: another pattern's file keeps its rules in Settings.
  const decryptable = name !== fileName;

  const decrypt = async (): Promise<void> => {
    // The menu item stays live while a decrypt runs: a second one would only fail.
    if (decrypting) return;
    const unsaved = draftOf(path) === undefined ? "" : " Your unsaved changes are lost.";
    const question = `Decrypt ${fileName}? It becomes ${name}, a plain file, and its plain text goes to the vault remote at the next save.${unsaved}`;
    if (!window.confirm(question)) return;
    setDecrypting(true);
    try {
      await onDecrypt();
    } catch (caught) {
      showError(caught);
      setDecrypting(false);
      // The core forgot this device's key, such as after 8 hours: the unlock form shows again.
      if (caught instanceof ApiError && caught.code === "vault_locked") showLocked();
    }
  };

  const textFile = useCallback(
    (text: string, version: string): ShownFile => ({
      kind: "file",
      path,
      size: new Blob([text]).size,
      text,
      version,
      editable: true,
    }),
    [path],
  );

  const showLocked = (): void => {
    // The core forgot this device's key, such as after 8 hours. A draft stays: only a deliberate lock drops it.
    setOpened({ state: "locked", hasKey: true });
  };

  const open = useCallback(async (): Promise<void> => {
    try {
      const status = await api.vaultSecrets();
      if (!status.unlocked) {
        setOpened({ state: "locked", hasKey: status.hasKey });
        return;
      }
      const file = await api.openEncryptedFile(path);
      setOpened(
        file.kind === "text" ? { state: "text", file: textFile(file.text, file.version) } : { state: "binary" },
      );
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === "vault_locked") showLocked();
      else setOpened({ state: "failed", reason: caught instanceof Error ? caught.message : String(caught) });
    }
  }, [path, textFile]);

  useEffect(() => {
    void open();
  }, [open]);

  const lock = async (): Promise<void> => {
    if (hasEncryptedDraft() && !window.confirm("Lock this tab? Your unsaved changes to encrypted files are lost."))
      return;
    setOpened({ state: "loading" });
    try {
      const status = await api.lockVault();
      setOpened({ state: "locked", hasKey: status.hasKey });
    } catch (caught) {
      setOpened({ state: "failed", reason: caught instanceof Error ? caught.message : String(caught) });
    }
  };

  const download: FetchFile = async () => {
    const file = await api.openEncryptedFile(path);
    return file.kind === "text"
      ? { name, blob: new Blob([file.text], { type: "text/plain" }) }
      : { name, blob: file.blob };
  };

  if (opened.state === "loading")
    return (
      <div className="files-pane files-preview">
        <ListSkeleton label="Opening the encrypted file…" rows={3} shape="files" />
      </div>
    );
  if (opened.state === "failed")
    return (
      <div className="files-pane files-preview">
        <div role="alert" className="callout danger callout-action">
          <span>{opened.reason}</span>
          <button onClick={() => void open()}>Try again</button>
        </div>
      </div>
    );
  if (opened.state === "locked")
    return (
      <div className="files-pane files-preview">
        <div role="status" className="callout">
          <Icon name="lock" /> This file is encrypted. <span className="files-size">({sizeWords(size)})</span>
        </div>
        <UnlockVaultForm hasKey={opened.hasKey} onUnlocked={() => void open()} />
      </div>
    );
  if (opened.state === "binary")
    return (
      <div className="files-pane files-preview">
        <div role="status" className="callout">
          <Icon name="lock" /> This encrypted file is not text, so it opens as a download.{" "}
          <span className="files-size">({sizeWords(size)})</span>
        </div>
        <DownloadButton path={path} folder={false} label={name} fetchFile={download} />
        {decryptable && (
          <button className="ghost" aria-busy={decrypting} disabled={decrypting} onClick={() => void decrypt()}>
            {decrypting ? <ButtonSpinner /> : <Icon name="lock" />}
            Decrypt
          </button>
        )}
        {decrypting && <ProgressBar label="Decrypting and saving the file…" />}
        <button className="ghost" onClick={() => void lock()}>
          <Icon name="lock" />
          Lock
        </button>
      </div>
    );
  const source: FileSource = {
    load: async () => {
      const file = await api.openEncryptedFile(path);
      if (file.kind !== "text") throw new Error("This file is no longer text.");
      return textFile(file.text, file.version);
    },
    save: async (version, text) => {
      await api.saveEncryptedFile(path, version, text);
      return source.load();
    },
    download,
    items: [
      ...(decryptable ? [{ label: "Decrypt", icon: "lock" as const, onChoose: () => void decrypt() }] : []),
      { label: "Lock encrypted files", icon: "lock", onChoose: () => void lock() },
    ],
  };
  return (
    <>
      <FilePreview
        file={opened.file}
        large={large}
        onLarge={onLarge}
        wrap={wrap}
        onWrap={onWrap}
        onSaved={(saved) => {
          if (saved.kind === "file") setOpened({ state: "text", file: saved });
        }}
        source={source}
        smart={smart}
      />
      {/* The menu that started it is gone, so the wait shows at the bottom of the screen. */}
      {decrypting && (
        <Toast message="Decrypting and saving the file…" role={null}>
          <ProgressBar label="Decrypting and saving the file…" />
        </Toast>
      )}
    </>
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
  menuOf,
}: {
  readonly path: string;
  readonly name: string;
  readonly entries: readonly FileEntry[];
  readonly openChild: string | null;
  readonly smart: boolean;
  readonly menuOf: MenuOf;
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
              <EntryLink
                entryPath={childPath(path, entry.name)}
                items={menuOf(
                  childPath(path, entry.name),
                  entry.name,
                  entry.kind === "folder"
                    ? "folder"
                    : entry.name.toLowerCase().endsWith(".eva-secret")
                      ? "encrypted"
                      : "file",
                )}
                label={`Actions for ${entry.name}`}
                current={entry.name === openChild}
                realName={realName}
              >
                {entry.kind === "folder" ? <Icon name="folder" /> : <FileIcon name={entry.name} />}
                <FileName shown={shown} spoken={spoken} />
                {entry.size !== null && <span className="files-size">{sizeWords(entry.size)}</span>}
              </EntryLink>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * A row of a folder. A right click or a long press opens the entry's menu, the same menu as the ⋯
 * button of the open entry (#1117). Each copy item copies the name on disk, with its extension, not
 * the smart name that the row shows.
 */
function EntryLink({
  entryPath,
  current,
  realName,
  items,
  label,
  children,
}: {
  readonly entryPath: string;
  readonly current: boolean;
  readonly realName: string | undefined;
  readonly items: readonly MenuItem[];
  readonly label: string;
  readonly children: ReactNode;
}): ReactElement {
  const { props, menu } = useContextMenu(items, label);
  return (
    <>
      <a
        className="files-entry"
        href={fileAddressOf(entryPath)}
        aria-current={current ? "true" : undefined}
        data-tooltip={realName}
        {...props}
      >
        {children}
      </a>
      {menu}
    </>
  );
}

/**
 * A download that a menu started. The menu closes at once, so the wait and a problem show in a
 * toast at the bottom of the screen.
 */
function MenuDownload({
  path,
  folder,
  onEnd,
}: {
  readonly path: string;
  readonly folder: boolean;
  readonly onEnd: () => void;
}): ReactElement | null {
  const download = useDownload(path);
  // A ref, not state: a second run of the effect in the same render must not start a second download.
  const started = useRef(false);
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void download.start().finally(() => setDone(true));
  }, [download]);
  if (download.problem !== null) return <Toast message={download.problem} role="alert" onClose={onEnd} />;
  if (!done) {
    const label = folder ? "Packing the folder…" : "Downloading…";
    return (
      <Toast message={label} role={null}>
        <ProgressBar label={label} share={download.share} />
      </Toast>
    );
  }
  return null;
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

interface FilePreviewProps {
  readonly file: ShownFile;
  readonly large: boolean;
  readonly onLarge: (large: boolean) => void;
  readonly wrap: boolean;
  readonly onWrap: (wrap: boolean) => void;
  readonly onSaved: (saved: BrowsedPath) => void;
  /** Where the text comes from and goes to, for a file that is not a plain vault file. */
  readonly source?: FileSource;
  /** True when the person picked the smart file names, for the list of notes that link here. */
  readonly smart: boolean;
  /** Builds the whole menu of the file from its own items. Without it, the menu holds only those. */
  readonly menu?: (open: OpenFileItems) => MenuItem[];
  /** True for a file that the person just made, so it opens in the editor. */
  readonly startEditing?: boolean;
}

/** The routes of a file that the vault keeps encrypted (#707). Each one needs this tab's unlock. */
interface FileSource {
  readonly load: () => Promise<BrowsedPath>;
  readonly save: (version: string, text: string) => Promise<BrowsedPath>;
  readonly download: FetchFile;
  /** More items of the file's menu, such as Lock. */
  readonly items?: readonly MenuItem[];
}

const plainSource = (path: string): FileSource => ({
  load: () => api.files(path),
  save: (version, text) => api.saveFile(path, version, text),
  download: (onShare) => api.downloadFile(path, onShare),
});

function FilePreview({
  file,
  large,
  onLarge,
  wrap,
  onWrap,
  onSaved,
  source,
  smart,
  menu,
  startEditing = false,
}: FilePreviewProps): ReactElement {
  const files = source ?? plainSource(file.path);
  const [plain, setPlain] = useState(false);
  /** The edit, or null outside the editor. */
  const [draft, setDraftState] = useState<Draft | null>(
    () => draftOf(file.path) ?? (startEditing && file.editable ? { text: file.text, version: file.version } : null),
  );
  const [problem, setProblem] = useState<{ readonly text: string; readonly changed: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  /** The editor closes at a save, so its button cannot show the check: the bar says it. */
  const [saved, setSaved] = useState(false);
  /** True when the core forgot the unlock of an encrypted file that this preview shows (#707). */
  const [locked, setLocked] = useState(false);
  const setDraft = (next: Draft | null, onDisk = file.text): void => {
    keepDraft(file.path, next === null ? null : { ...next, encrypted: source !== undefined }, onDisk);
    setDraftState(next);
  };
  const view = viewOf(file.path);

  const unsaved = draft !== null && !sameText(draft.text, file.text);

  const download = useDownload(file.path, files.download);
  const viewItems: MenuItem[] = [];
  if (draft === null && (view === "markdown" || view === "json" || view === "image")) {
    const formatted = view === "image" ? "Show image" : "Show formatted";
    viewItems.push({ label: plain ? formatted : "Show plain text", icon: "code", onChoose: () => setPlain(!plain) });
  }
  // A text area wraps by itself, so the editor needs no wrap item.
  if (draft === null) {
    viewItems.push({
      label: wrap ? "Do not wrap long lines" : "Wrap long lines",
      icon: "wrap",
      onChoose: () => onWrap(!wrap),
    });
  }
  const open: OpenFileItems = { view: viewItems, download: () => void download.start(), security: files.items ?? [] };
  const items = menu === undefined ? openFileItems(open) : menu(open);

  const save = async (): Promise<boolean> => {
    if (draft === null) return false;
    setBusy(true);
    setProblem(null);
    try {
      onSaved(await files.save(draft.version, draft.text));
      setDraft(null);
      setSaved(true);
      return true;
    } catch (caught) {
      const changed = caught instanceof ApiError && caught.code === "file_changed";
      if (forgotUnlock(caught)) return false;
      setProblem({ text: caught instanceof Error ? caught.message : String(caught), changed });
      return false;
    } finally {
      setBusy(false);
    }
  };

  /**
   * The core forgot this device's unlock, such as after 8 hours, while the person edits an encrypted
   * file. The edit stays, and the password form shows beside it.
   */
  const forgotUnlock = (caught: unknown): boolean => {
    if (source === undefined || !(caught instanceof ApiError) || caught.code !== "vault_locked") return false;
    setLocked(true);
    return true;
  };

  const loadAgain = async (): Promise<void> => {
    setProblem(null);
    try {
      const answer = await files.load();
      onSaved(answer);
      if (answer.kind === "file") setDraft({ text: answer.text, version: answer.version }, answer.text);
    } catch (caught) {
      if (forgotUnlock(caught)) return;
      setProblem({ text: caught instanceof Error ? caught.message : String(caught), changed: true });
    }
  };

  return (
    <section className="files-pane files-preview files-file" aria-label="File text">
      <FileBar
        size={file.size}
        large={large}
        onLarge={onLarge}
        items={items}
        // The text area of the editor copies by itself.
        copy={draft === null ? () => copyText(file.text) : null}
      >
        {/* It stays while the person edits, so a Cancel or a Save does not walk the vault again. */}
        <BacklinksButton path={file.path} smart={smart} />
        {draft === null ? (
          <>
            {saved && (
              <span role="status" className="files-size">
                <Icon name="check" /> Saved
              </span>
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
      </FileBar>
      <div className="files-wait">
        <DownloadWait download={download} folder={false} />
      </div>
      {locked && (
        <div className="files-problem">
          <div role="status" className="callout warning">
            This tab is locked again. Type the vault password, then save again. Your text stays.
          </div>
          <UnlockVaultForm hasKey={true} onUnlocked={() => setLocked(false)} />
        </div>
      )}
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
        <FileText path={file.path} text={file.text} plain={plain} wrap={wrap} />
      )}
    </section>
  );
}

function FileText({
  path,
  text,
  plain,
  wrap,
}: {
  readonly path: string;
  readonly text: string;
  readonly plain: boolean;
  readonly wrap: boolean;
}): ReactElement {
  const view = viewOf(path);
  const textClass = wrap ? "files-text wrap" : "files-text";
  if (view === "image")
    return plain ? (
      <CodeText path={path} text={text} className={textClass} />
    ) : (
      <SvgImage key={text} path={path} text={text} />
    );
  if (plain || view === "plain") return <pre className={textClass}>{text}</pre>;
  if (view === "markdown") {
    const { frontMatter, body } = splitFrontMatter(text);
    return (
      <>
        {frontMatter !== null && <pre className={`${textClass} files-front-matter`}>{frontMatter}</pre>}
        <MarkdownBody
          html={toWebHtml(body)}
          className={wrap ? "answer-body files-markdown wrap" : "answer-body files-markdown"}
        />
      </>
    );
  }
  return <CodeText path={path} text={view === "json" ? (prettyJson(text) ?? text) : text} className={textClass} />;
}

/**
 * An SVG file drawn from the text that the page holds (#1064). An `<img>` runs no script of the
 * SVG, so a file of the vault cannot run code in Eva's page.
 */
function SvgImage({ path, text }: { readonly path: string; readonly text: string }): ReactElement {
  const [broken, setBroken] = useState(false);
  const address = useMemo(() => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`, [text]);
  const name = path.split("/").pop() ?? path;
  if (broken)
    return (
      <div role="status" className="callout warning files-problem">
        The browser cannot draw this SVG. Choose Show plain text to read it.
      </div>
    );
  return (
    <div className="files-media">
      <img src={address} alt={name} onError={() => setBroken(true)} />
    </div>
  );
}

function CodeText({
  path,
  text,
  className,
}: {
  readonly path: string;
  readonly text: string;
  readonly className: string;
}): ReactElement {
  return (
    <pre className={className}>
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
