/**
 * The search that an `@` opens in the message box of an Assistant chat (issue 657): the projects
 * first, then the vault files that match the typed word. A tap or Enter writes the mention.
 */
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactElement,
  type RefObject,
} from "react";
import { api } from "./api.ts";
import { Icon } from "./icons.tsx";
import { ProgressBar } from "./Loading.tsx";
import {
  insertMention,
  mentionNotes,
  mentionProjectOf,
  mentionQueryAt,
  mentionToken,
  mentionWordEnd,
  pickedProjects,
  type MentionKind,
  type MentionProject,
  type MentionQuery,
} from "./mentions.ts";

/** The projects with a chat that runs now. The Chats page gives them, so they come first in the search. */
export const ProjectsInUse = createContext<readonly string[]>([]);

/** A phone shows a few items of each kind above the keyboard. The person types more to find others. */
const shownProjects = 5;
const shownFiles = 5;
/** A search for each key stroke would make the core walk the vault again and again. */
const fileSearchPauseMs = 200;

interface MentionOption {
  readonly kind: MentionKind;
  /** The project id or the vault path, which the mention names. */
  readonly name: string;
  readonly title: string;
  readonly detail: string;
}

interface MentionPicker {
  /** The floating search, or null when no `@` is typed. */
  readonly menu: ReactElement | null;
  /** The parts of the message box that tell a screen reader about the search. */
  readonly boxProps: {
    readonly "aria-controls": string | undefined;
    readonly "aria-activedescendant": string | undefined;
    readonly "aria-autocomplete": "list";
    /** A tap outside the box closes the search: a phone has no Escape key. */
    readonly onBlur: () => void;
  };
  /** True when the key moved in the search or picked an item, so the box does nothing else with it. */
  readonly onKeyDown: (event: ReactKeyboardEvent<HTMLTextAreaElement>) => boolean;
  /** Reads the caret again, after a change of the text or a move of the caret. */
  readonly follow: () => void;
  /** The notes for Eva about the mentions of a text. */
  readonly notes: (text: string) => string[];
}

export function useMentionPicker(
  enabled: boolean,
  box: RefObject<HTMLTextAreaElement | null>,
  text: string,
  setText: (text: string) => void,
): MentionPicker {
  const inUse = useContext(ProjectsInUse);
  const [query, setQuery] = useState<MentionQuery | null>(null);
  // Escape closes the search until the person types another `@`.
  const [dismissed, setDismissed] = useState<number | null>(null);
  const [projects, setProjects] = useState<readonly MentionProject[] | null>(null);
  const [files, setFiles] = useState<{ readonly query: string; readonly options: readonly MentionOption[] } | null>(
    null,
  );
  const [active, setActive] = useState(0);
  const listId = useId();
  const open = enabled && query !== null && query.start !== dismissed;

  // A text from the project page names a project before any search ran, so its note needs the list too.
  const needsList = enabled && projects === null && text.includes("@project:");
  // Each open reads the list again, so a project made meanwhile shows. The old list shows until then.
  useEffect(() => {
    if (!open && !needsList) return;
    let current = true;
    api
      .projects("", "")
      .then((found) => {
        if (current) setProjects(found.map(mentionProjectOf));
      })
      // The search still finds files, and a note names the folder of the vault layout.
      .catch(() => {
        if (current) setProjects((known) => known ?? []);
      });
    return () => {
      current = false;
    };
  }, [open, needsList]);

  const word = open ? query.query : "";
  useEffect(() => {
    if (!open || word === "") return;
    let current = true;
    const timer = setTimeout(() => {
      api
        .searchFiles(word, false)
        .then((result) => {
          if (!current) return;
          const options = result.matches
            .filter((match) => match.kind === "file")
            .slice(0, shownFiles)
            .map((match) => ({ kind: "file" as const, name: match.path, title: match.name, detail: match.path }));
          setFiles({ query: word, options });
        })
        .catch(() => {
          if (current) setFiles({ query: word, options: [] });
        });
    }, fileSearchPauseMs);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [open, word]);

  const projectOptions: MentionOption[] = pickedProjects(projects ?? [], inUse, word, shownProjects).map((project) => ({
    kind: "project",
    name: project.id,
    title: project.title,
    detail: project.id,
  }));
  const fileOptions = files?.query === word ? files.options : [];
  const searchingFiles = word !== "" && files?.query !== word;
  const options = [...projectOptions, ...fileOptions];
  const activeIndex = Math.min(active, Math.max(0, options.length - 1));

  const follow = (): void => {
    const element = box.current;
    if (element === null) return;
    const next = mentionQueryAt(element.value, element.selectionStart);
    if (next?.start !== query?.start || next?.query !== query?.query) setActive(0);
    setQuery(next);
    if (next === null) setDismissed(null);
  };

  const pick = (option: MentionOption): void => {
    const element = box.current;
    if (element === null || query === null) return;
    // A pick in the middle of a word replaces the whole word, so no rest of an older mention stays.
    const end = mentionWordEnd(text, element.selectionStart);
    const placed = insertMention(text, query.start, end, mentionToken(option.kind, option.name));
    setText(placed.text);
    setQuery(null);
    // The box shows the new text on the next render, so the caret moves after it.
    requestAnimationFrame(() => {
      element.focus();
      element.setSelectionRange(placed.caret, placed.caret);
    });
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>): boolean => {
    // An input method's Enter or arrow picks its own word, not a mention.
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- Safari marks an input method's key only with this code.
    if (!open || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return false;
    if (event.key === "Escape") {
      event.preventDefault();
      setDismissed(query.start);
      return true;
    }
    if (options.length === 0) return false;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((activeIndex + step + options.length) % options.length);
      return true;
    }
    const chosen = options[activeIndex];
    if ((event.key === "Enter" || event.key === "Tab") && !event.shiftKey && chosen !== undefined) {
      event.preventDefault();
      pick(chosen);
      return true;
    }
    return false;
  };

  const optionId = (index: number): string => `${listId}-${String(index)}`;
  const item = (option: MentionOption, index: number): ReactElement => (
    <button
      key={`${option.kind}:${option.name}`}
      id={optionId(index)}
      type="button"
      role="option"
      aria-selected={index === activeIndex}
      className={index === activeIndex ? "on" : undefined}
      tabIndex={-1}
      // The box keeps the focus, so the person goes on typing after a tap.
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => pick(option)}
    >
      <Icon name={option.kind === "project" ? "briefcase" : "file"} />
      <span className="mention-text">
        <span className="mention-title">{option.title}</span>
        <span className="mention-detail">{option.detail}</span>
      </span>
    </button>
  );

  const menu = open ? (
    <div className="menu mention-menu" id={listId} role="listbox" aria-label="Mention a project or a file">
      <div className="mention-group">
        <span className="mention-group-name" aria-hidden="true">
          Projects
        </span>
        {projects === null ? (
          <ProgressBar label="Eva lists the projects" />
        ) : projectOptions.length === 0 ? (
          <span className="mention-empty">No project matches.</span>
        ) : (
          <div className="mention-group" role="group" aria-label="Projects">
            {projectOptions.map((option, index) => item(option, index))}
          </div>
        )}
      </div>
      <div className="mention-group">
        <span className="mention-group-name" aria-hidden="true">
          Files
        </span>
        {word === "" ? (
          <span className="mention-empty">Type a part of the name to find a file.</span>
        ) : searchingFiles ? (
          <ProgressBar label="Eva looks for the files" />
        ) : fileOptions.length === 0 ? (
          <span className="mention-empty">No file matches.</span>
        ) : (
          <div className="mention-group" role="group" aria-label="Files">
            {fileOptions.map((option, index) => item(option, projectOptions.length + index))}
          </div>
        )}
      </div>
    </div>
  ) : null;

  return {
    menu,
    boxProps: {
      "aria-controls": open ? listId : undefined,
      "aria-activedescendant": open && options.length > 0 ? optionId(activeIndex) : undefined,
      "aria-autocomplete": "list",
      onBlur: () => setQuery(null),
    },
    onKeyDown,
    follow,
    notes: (sent) => (enabled ? mentionNotes(sent, projects ?? []) : []),
  };
}
