/**
 * The message box of a chat: the text, the engine and model chip, and the round
 * Send button. While a turn runs and the box is empty, Send becomes Stop at the same place.
 * Eva queues a message sent during a turn, so typed text brings Send back.
 * The microphone records a voice note. Eva turns it into text on her machine and puts the text in
 * the box, so the person can fix it before they send it.
 * Without voice notes on her machine, the microphone leads to the button that installs them.
 * The clip attaches files in an Assistant chat. A pasted or dropped file attaches the same way.
 * Each file uploads when the person picks it, so Send waits for no upload.
 * The command button opens the menu of the vault's text actions, such as Polish, and saved prompts (issue 661).
 * A text action rewrites the typed text and sends nothing; Undo brings the typed text back.
 */
import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from "react";
import {
  effortLevels,
  modelAliases,
  takesEffort,
  type EffortLevel,
  type EngineName,
  type ModelAlias,
} from "../../../shared/engine-port.ts";
import { chatKind } from "../../../shared/chat-kind.ts";
import { api, type ChatBlocker, type ComposerMenuItems, type SessionRecord } from "./api.ts";
import { messageWithFiles, pastedFiles } from "./attachments.ts";
import {
  answeredModel,
  engineLock,
  composerPlaceholder,
  effortLabel,
  effortName,
  engineLabel,
  modelLabel,
  modelNote,
  restoredText,
  sendsOnEnter,
} from "./conversation-parts.ts";
import { ColumnDivider } from "./ColumnDivider.tsx";
import { composerHeightRange, heightShare, readComposerHeight, saveComposerHeight } from "./composer-height.ts";
import { autoTextHeight, foldsToOneRow } from "./composer-layout.ts";
import { playCue } from "./cues.ts";
import { useShowError } from "./error-toast.tsx";
import { Icon } from "./icons.tsx";
import { ButtonSpinner, ProgressBar } from "./Loading.tsx";
import { useMentionPicker } from "./MentionPicker.tsx";
import { MenuButton, MenuItems, type MenuItem } from "./Menu.tsx";
import { moreRepliesLabel, sendsSuggestion, shownReplies, suggestionHint } from "./suggested-replies.ts";
import { composerMenuItems, insertedText } from "./menu-text.ts";
import { setupBlock } from "./new-chat.ts";
import { prepareSendMorph, startSendMorph } from "./send-morph-player.ts";
import { UnsentTexts } from "./unsent-texts.ts";
import { clearTextSource, onTextSource, takeFocusAsk, textSourceOf } from "./text-sources.ts";
import { settingsHash } from "./settings-routes.ts";
import { recordingTime, recordingType, withHeardText } from "./voice-notes.ts";
import { goTo } from "./back-layers.ts";
import { useBackLayer } from "./back-layer-hook.ts";
import { readSendKeys } from "./send-key.ts";

/**
 * What the composer shows of a chat. A new chat has no record until its first message, so it has
 * no id and no clone yet, and takes no file of a clone.
 */
type ComposerChat = Pick<SessionRecord, "engine" | "modelAlias" | "effort" | "mode" | "parentId" | "turns"> &
  Partial<Pick<SessionRecord, "firstMessageDraft" | "id" | "clone">>;

/**
 * The id of this tab, so it skips its own changes when Eva sends them back. The tab keeps it across
 * a reload: Eva lets a tab write over its own newest text. A page on a plain http address has no
 * `crypto.randomUUID`, and the id needs no strength.
 */
const pageWriter = ((): string => {
  const key = "eva-unsent-writer";
  try {
    const kept = window.sessionStorage.getItem(key);
    if (kept !== null) return kept;
  } catch {
    // A blocked storage gives each load a new id.
  }
  const made = `page-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  try {
    window.sessionStorage.setItem(key, made);
  } catch {
    // The id still serves this load.
  }
  return made;
})();

/** The unsent text of each chat, by its draft key. Eva keeps it too, so every device shows it (issue 652). */
export const unsentTexts = new UnsentTexts(() => window.sessionStorage, {
  remote: {
    list: () => api.unsentTexts(),
    save: (key, text, keepEmpty, base) => api.saveUnsentText(key, text, keepEmpty, pageWriter, base),
  },
  timers: {
    set: (run, ms) => setTimeout(run, ms),
    clear: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
  },
  writer: pageWriter,
});

/** How the chip changes the engine of a chat that has no turn yet, and the model and effort of any chat. */
export interface ChatChoices {
  readonly setEngine: (engine: EngineName) => Promise<unknown>;
  readonly setModel: (model: ModelAlias) => Promise<unknown>;
  readonly setEffort: (effort: EffortLevel) => Promise<unknown>;
}

/** The choices of a chat that has a record: the server keeps them. */
export function storedChoices(sessionId: string): ChatChoices {
  return {
    setEngine: (engine) => api.setEngine(sessionId, engine),
    setModel: (model) => api.setModel(sessionId, model),
    setEffort: (effort) => api.setEffort(sessionId, effort),
  };
}

interface ComposerProps {
  readonly session: ComposerChat;
  readonly choices: ChatChoices;
  readonly running: boolean;
  /** Resolves false when the send failed, so the box gets its text back. */
  readonly onSend: (text: string) => Promise<boolean>;
  readonly onStop: () => void;
  readonly onChanged: () => Promise<void>;
  /** The missing setup step that stops the chat. It locks the box, because a send would fail. */
  readonly blocker: ChatBlocker | null;
  /** True when Eva's machine can turn a voice note into text. */
  readonly voiceNotes: boolean;
  /** The text of the empty box. It names who answers. */
  readonly placeholder?: string;
  /** The chat whose unsent text the box keeps, so a switch of branch and back does not lose it. */
  readonly draftKey?: string;
  /** The replies that Eva suggests (#1127). The empty box offers the first, and Tab or a tap sends it. */
  readonly suggestions?: readonly string[];
  /** A bar that stays above the box, such as the pinned page on a phone (#1130). */
  readonly above?: ReactNode;
}

export function Composer({
  session,
  choices,
  running,
  onSend,
  onStop,
  onChanged,
  blocker,
  voiceNotes,
  placeholder = composerPlaceholder(null),
  draftKey,
  suggestions = noSuggestions,
  above,
}: ComposerProps): ReactElement {
  // A chat that goes on from a summary starts with it, so the person reads it before it goes (issue 522).
  const summary = session.turns.length === 0 ? (session.firstMessageDraft ?? null) : null;
  const [text, setTypedText] = useState(
    () => (draftKey === undefined ? undefined : unsentTexts.find(draftKey)) ?? summary ?? "",
  );
  // A send awaits the core, so its failure reads the text typed since then here, not from its closure.
  const typed = useRef(text);
  /** Where the person last put the cursor, or null when they did not, as in a draft that came back. */
  const caret = useRef<{ start: number; end: number } | null>(null);
  /** True once the person typed or tapped in the box since Eva last set its text. */
  const touched = useRef(false);
  const setText = (value: string): void => {
    // A cleared summary stays cleared: without the entry, the box would start with the summary again.
    if (draftKey !== undefined) unsentTexts.set(draftKey, value, summary !== null);
    // The text of a widget is gone once the person sends it or clears it, and so is its source.
    if (draftKey !== undefined && value.trim() === "") clearTextSource(draftKey);
    typed.current = value;
    setTypedText(value);
    // A new text makes the old cursor wrong, until the person types or taps again.
    caret.current = null;
    touched.current = false;
  };
  /**
   * Puts the message of a failed send back. A chat's box can mount again during the send, so the
   * stored draft of the chat is newer than this box's text.
   */
  const restore = (failed: string): void => {
    setText(draftKey === undefined ? restoredText(failed, typed.current) : unsentTexts.restore(draftKey, failed));
    // Undo would bring back a text from before the restored message.
    setUndoText(null);
  };
  // A failed send of a box that is gone restores its text to the store, so this box follows the store.
  useEffect(() => {
    if (draftKey === undefined) return;
    const follow = (): void => {
      const stored = unsentTexts.find(draftKey) ?? summary ?? "";
      // The store also tells the box of its own changes. Only another text makes the cursor wrong.
      if (stored !== typed.current) {
        caret.current = null;
        touched.current = false;
      }
      typed.current = stored;
      setTypedText(stored);
    };
    follow();
    return unsentTexts.subscribe(draftKey, follow);
  }, [draftKey, summary]);
  const [sending, setSending] = useState(false);
  const [dropping, setDropping] = useState(false);
  // A chat in a clone keeps its files in the clone, so the core needs the chat with each upload (#706).
  const files = useAttachments(session.mode === "project" ? (session.id ?? null) : null);
  const picker = useRef<HTMLInputElement>(null);
  const heardText = useRef(false);
  // The box can show another chat when Eva hears the note, so the text goes to the chat of the newest render.
  const hear = useRef((_heard: string): void => undefined);
  hear.current = (heard) => {
    setText(withHeardText(typed.current, heard));
    heardText.current = true;
  };
  const voice = useVoiceNote((heard) => hear.current(heard));

  const menu = useComposerMenu();
  /** The text action that runs now, or null. */
  const [rewriting, setRewriting] = useState<string | null>(null);
  /** The typed text before the last text action, until the person types again. */
  const [undoText, setUndoText] = useState<string | null>(null);
  /** The number of the newest text action run. A run whose number is old ends with no change. */
  const actionRun = useRef(0);
  /** True while the large editor is open, for a text too long for the box. */
  const [expanded, setExpanded] = useState(false);
  /** True while the + menu of a folded box is open. */
  const [plusOpen, setPlusOpen] = useState(false);
  // The morph copies the page's styles. Doing it while the page rests keeps the first send smooth.
  useEffect(prepareSendMorph, []);
  // The box shows another chat now. A late answer belongs to the old chat's text, so it must not land here.
  useEffect(() => {
    actionRun.current += 1;
    caret.current = null;
    touched.current = false;
    setRewriting(null);
    setUndoText(null);
    // The large editor belongs to the old chat's text.
    setExpanded(false);
  }, [draftKey]);
  // A locked box takes no text, so it closes the large editor.
  useEffect(() => {
    if (blocker !== null) setExpanded(false);
  }, [blocker]);
  const showError = useShowError();
  const runAction = async (name: string): Promise<void> => {
    const before = text;
    actionRun.current += 1;
    const run = actionRun.current;
    setRewriting(name);
    try {
      const { text: rewritten } = await api.runTextAction(name, session.engine, before);
      if (run !== actionRun.current) return;
      setText(rewritten);
      setUndoText(before);
    } catch (caught) {
      // The box keeps the typed text, so the person loses nothing.
      if (run === actionRun.current) showError(caught);
    } finally {
      if (run === actionRun.current) setRewriting(null);
    }
  };
  const insertPrompt = (inserted: string): void => {
    // The + menu keeps the focus in the text, so the cursor is read there. With no cursor from the person, the prompt goes
    // at the end: a browser can put a restored draft's cursor at its start.
    const field = box.current;
    const live =
      field !== null && document.activeElement === field && touched.current
        ? { start: field.selectionStart, end: field.selectionEnd }
        : null;
    const selection = live ?? caret.current ?? { start: text.length, end: text.length };
    const next = insertedText(text, selection, inserted);
    setText(next.text);
    setUndoText(null);
    caret.current = { start: next.cursor, end: next.cursor };
    touched.current = true;
    // The cursor goes after the prompt, so the person types on from there.
    requestAnimationFrame(() => {
      box.current?.focus({ preventScroll: true });
      box.current?.setSelectionRange(next.cursor, next.cursor);
    });
  };

  const uploading = files.attachments.some((attachment) => attachment.note === null);
  const notes = files.attachments.flatMap((attachment) => (attachment.note === null ? [] : [attachment.note]));
  const isEmpty = text.trim() === "" && files.attachments.length === 0;

  /** The card of the box, which the send morph copies. */
  const shell = useRef<HTMLDivElement>(null);

  /** Sends the text of the box, or a suggested reply through the same path, so the outbox and the morph stay the same. */
  const send = async (reply?: string): Promise<void> => {
    const message = reply ?? messageWithFiles(text, [...mentions.notes(text), ...notes]);
    if (message === "" || uploading || sending || rewriting !== null || blocker !== null) return;
    const attached = files.attachments;
    // The picture of the box is taken before it clears, so the morph starts from what the person saw (#943).
    const morph = shell.current === null ? null : startSendMorph(shell.current);
    playCue("send");
    setSending(true);
    setText("");
    setUndoText(null);
    setExpanded(false);
    files.set([]);
    morph?.play();
    // The person must not type the message again, nor pick the files again.
    if (!(await onSend(message))) {
      morph?.cancel();
      // A reply that did not go comes back as text, so the person can send it again.
      restore(reply ?? text);
      files.set(attached);
    }
    setSending(false);
  };

  // A locked box cannot be cleared, so a running turn keeps its Stop button.
  const showStop = running && (isEmpty || blocker !== null);
  const block = blocker === null ? null : setupBlock(blocker);
  const lineId = useId();
  const hintId = useId();
  const box = useRef<HTMLTextAreaElement>(null);
  // Who wrote the text that Eva put in the box, such as a widget (#696). A fill also asks for the focus.
  const [source, setSource] = useState(() => (draftKey === undefined ? null : textSourceOf(draftKey)));
  useEffect(() => {
    if (draftKey === undefined) return undefined;
    const follow = (): void => {
      setSource(textSourceOf(draftKey));
      if (!takeFocusAsk(draftKey)) return;
      // After the render of the new text, so the cursor goes to its end.
      requestAnimationFrame(() => {
        const field = box.current;
        if (field === null) return;
        field.focus({ preventScroll: true });
        field.setSelectionRange(field.value.length, field.value.length);
      });
    };
    follow();
    return onTextSource(draftKey, follow);
  }, [draftKey]);
  const height = useComposerHeight(box, text);
  const visibleHeight = useVisibleHeight();
  // A short screen, such as a phone with its keyboard up, gets one row, and the + button opens the settings (#943).
  // The box stays folded while its + menu is open: a tablet keyboard that closes must not take the menu away.
  const folded = plusOpen || foldsToOneRow({ visibleHeight, touch: isTouchScreen(), phoneSized: isPhoneSized() });
  // The text is gone while a voice note records, so the line is measured again when it comes back.
  const lineHeight = useLineHeight(box, [folded, block === null, voice.state.phase]);
  const locked = block !== null;
  // On a computer the person types into a chat at once. On a touch screen the focus would raise the keyboard over the chat.
  useEffect(() => {
    if (locked || isTouchScreen() || isTextField(document.activeElement)) return;
    box.current?.focus({ preventScroll: true });
  }, [draftKey, locked]);
  // The box is gone while Eva turns a voice note into text, so it takes the focus when it comes back.
  useEffect(() => {
    if (voice.state.phase !== "idle" || !heardText.current) return;
    heardText.current = false;
    if (!isTouchScreen() && !isTextField(document.activeElement)) box.current?.focus({ preventScroll: true });
  }, [voice.state.phase]);
  const canRecord = block === null && voice.isSupported;
  const showMic = canRecord && isEmpty;
  // A chat in a clone gets a copy of each file in its clone (#706). A chat in a project folder, such
  // as a general or specialist chat, gets it in its project's received folder (#768). A new chat's
  // draft has no clone and no id yet. The mention picker of vault files stays off in a project folder.
  const kind = chatKind({ mode: session.mode, clone: session.clone ?? null });
  const inClone = kind === "project" && session.id !== undefined;
  const inFolder = kind === "specialist" && session.id !== undefined;
  const canAttach = kind === "assistant" || inClone || inFolder;
  const mentions = useMentionPicker((kind === "assistant" || inClone) && block === null, box, text, setText, inClone);
  // A file picked during a send that fails would be lost when the box gets its files back.
  const takesFiles = canAttach && block === null && !sending;
  const replies = shownReplies(suggestions, {
    text,
    files: files.attachments.length,
    locked: block !== null,
    busy: sending || uploading || rewriting !== null,
  });
  const suggestion = replies[0];
  if (voice.state.phase !== "idle") {
    return (
      <div className="composer">
        {above}
        <div className="composer-box">
          {voice.state.phase === "recording" ? (
            <div className="composer-row">
              <span className="recording-dot" aria-hidden="true" />
              <span role="status">Recording {recordingTime(voice.state.elapsedMs)}</span>
              <span className="grow" />
              <button className="ghost" onClick={voice.cancel}>
                <Icon name="x" />
                Cancel
              </button>
              <button
                className="send stop"
                aria-label="Stop the recording"
                data-tooltip="Stop the recording"
                onClick={voice.finish}
              >
                <Icon name="stop" />
              </button>
            </div>
          ) : (
            <ProgressBar label="Eva turns the voice note into text" />
          )}
        </div>
      </div>
    );
  }
  const keepFocus = (event: ReactPointerEvent): void => {
    // A tap on these buttons keeps the focus in the text, so a phone keyboard stays open.
    event.preventDefault();
  };
  /**
   * Sends a reply from the arrow or the list. The send removes the control that the keyboard used, and the focus
   * would fall to the page, so it goes to the text. A tap kept the focus where it was, so the keyboard stays as it is.
   */
  const sendReply = (reply: string): void => {
    const focused = document.activeElement;
    const fromControl = focused !== box.current && shell.current?.contains(focused) === true;
    void send(reply);
    if (fromControl) requestAnimationFrame(() => box.current?.focus({ preventScroll: true }));
  };
  const textActions =
    block === null
      ? composerMenuItems(menu, {
          canRewrite: text.trim() !== "",
          onAction: (name) => void runAction(name),
          onPrompt: insertPrompt,
        })
      : [];
  // The + menu holds every setting of the row, so a folded box loses none of them.
  const plusActions: MenuItem[] = [
    ...(canAttach
      ? [
          {
            label: "Attach a file",
            icon: "clip" as const,
            disabled: !takesFiles,
            onChoose: () => picker.current?.click(),
          },
        ]
      : []),
    ...textActions.map((item) => (rewriting === null ? item : { ...item, disabled: true })),
  ];
  const undoButton =
    undoText !== null && rewriting === null ? (
      <button
        className="ghost"
        data-tooltip="Bring back the text from before the text action"
        onClick={() => {
          setText(undoText);
          setUndoText(null);
        }}
      >
        <Icon name="restart" />
        Undo
      </button>
    ) : null;
  const sendButtons = (
    <>
      {showMic && (
        <button
          // Beside Stop it stays quiet; alone it takes the place of Send.
          className={showStop ? "send voice" : "send"}
          aria-label={voiceNotes ? "Record a voice note" : "Set up voice notes"}
          data-tooltip={voiceNotes ? "Record a voice note" : "Set up voice notes"}
          onClick={() => {
            // A missing button tells nothing; this one leads to the button that installs voice notes.
            if (voiceNotes) void voice.start();
            else goTo(settingsHash({ section: "updates", item: "versions" }));
          }}
        >
          <Icon name="mic" />
        </button>
      )}
      {showStop ? (
        <button className="send stop" aria-label="Stop" data-tooltip="Stop" onClick={onStop}>
          <Icon name="stop" />
        </button>
      ) : (
        !showMic && (
          <button
            className="send"
            // The send itself plays its cue, also for the Enter key.
            data-cue="none"
            aria-label="Send"
            data-tooltip="Send"
            disabled={
              sending || uploading || rewriting !== null || messageWithFiles(text, notes) === "" || block !== null
            }
            onClick={() => void send()}
          >
            <Icon name="send" />
          </button>
        )
      )}
    </>
  );
  const textStyle = {
    "--composer-auto-height": `${String(autoTextHeight(visibleHeight, lineHeight))}px`,
    ...(height.share === null ? {} : { "--composer-height": `${String(height.share * 100)}dvh` }),
  } as CSSProperties;
  return (
    <div className="composer">
      {mentions.menu}
      {above}
      <div
        ref={shell}
        className={[
          "composer-box",
          ...(dropping ? ["dropping"] : []),
          ...(folded ? ["folded"] : []),
          ...(expanded ? ["expanded"] : []),
        ].join(" ")}
        style={
          {
            "--composer-editor-height": `${String(Math.round(visibleHeight * editorShare))}px`,
            "--composer-visible-height": `${String(Math.round(visibleHeight))}px`,
          } as CSSProperties
        }
        onDragOver={(event) => {
          if (!takesFiles || !event.dataTransfer.types.includes("Files")) return;
          // Without this, the browser opens the dropped file in place of Eva.
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
          setDropping(true);
        }}
        onDragLeave={(event) => {
          // A move onto a child of the box also leaves the box itself.
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropping(false);
        }}
        onDrop={(event) => {
          setDropping(false);
          if (!takesFiles || event.dataTransfer.files.length === 0) return;
          event.preventDefault();
          files.add([...event.dataTransfer.files]);
        }}
      >
        {height.tall && !expanded && (
          <ColumnDivider
            label="Height of the text"
            side="top"
            minWidth={shortestText}
            target={() => box.current}
            sizeVariable="--composer-height"
            maxSize={() => window.innerHeight * composerHeightRange.max}
            sizeFrom={height.sizeFrom}
            onWidth={height.onHeight}
          />
        )}
        {(expanded || (block === null && height.overflows)) && (
          <button
            className="icon-button composer-expand"
            aria-label={expanded ? "Close the large editor" : "Open the large editor"}
            data-tooltip={expanded ? "Close the large editor" : "Open the large editor"}
            aria-pressed={expanded}
            onPointerDown={keepFocus}
            onClick={() => {
              setExpanded((open) => !open);
              box.current?.focus({ preventScroll: true });
            }}
          >
            <Icon name={expanded ? "shrink" : "expand"} />
          </button>
        )}
        <input
          ref={picker}
          type="file"
          multiple
          hidden
          onChange={(event) => {
            files.add([...(event.target.files ?? [])]);
            // The same file can be picked again after the person removes it.
            event.target.value = "";
          }}
        />
        <div className="composer-line">
          {folded && (
            <EngineChip
              session={session}
              choices={choices}
              running={running}
              onChanged={onChanged}
              trigger="plus"
              actions={plusActions}
              onOpenChange={setPlusOpen}
            />
          )}
          <div className="composer-field">
            {suggestion !== undefined && (
              // Before the text in the page order, so Shift+Tab from the box reaches these buttons.
              <div className="composer-suggestion">
                <span className="composer-suggestion-text" aria-hidden="true">
                  {suggestion}
                </span>
                <button
                  type="button"
                  className="composer-suggestion-send"
                  aria-label={`Send the suggested reply: ${suggestion}`}
                  data-tooltip="Send this reply (Tab)"
                  // The send itself plays its cue.
                  data-cue="none"
                  onPointerDown={keepFocus}
                  onClick={() => sendReply(suggestion)}
                >
                  <Icon name="forward" />
                  <kbd aria-hidden="true">Tab</kbd>
                </button>
                {replies.length > 1 && (
                  <MenuButton
                    className="chip composer-suggestion-more"
                    name={moreRepliesLabel(replies.length - 1)}
                    label="Suggested replies"
                    fromStart
                    above
                    keepFocus
                    items={replies.map((reply) => ({ label: reply, onChoose: () => sendReply(reply) }))}
                  >
                    +{replies.length - 1}
                  </MenuButton>
                )}
                <span id={hintId} className="visually-hidden">
                  {suggestionHint(suggestion)}
                </span>
              </div>
            )}
            <textarea
              ref={box}
              className={height.share === null ? undefined : "resized"}
              style={textStyle}
              aria-label="Message"
              aria-describedby={block !== null ? lineId : suggestion === undefined ? undefined : hintId}
              // The suggestion takes the place of the placeholder, in the same grey.
              placeholder={block !== null ? "Eva cannot answer yet" : suggestion === undefined ? placeholder : ""}
              rows={1}
              disabled={block !== null}
              // The answer of a text action takes the place of the text, so an edit meanwhile would be lost.
              readOnly={rewriting !== null}
              aria-busy={rewriting !== null}
              value={text}
              {...mentions.boxProps}
              onChange={(event) => {
                setText(event.target.value);
                setUndoText(null);
                touched.current = true;
                mentions.follow();
              }}
              onSelect={mentions.follow}
              onPointerDown={() => {
                touched.current = true;
              }}
              onBlur={(event) => {
                mentions.boxProps.onBlur();
                // A press on the menu button takes the focus. The cursor counts only when the person placed it.
                const field = event.currentTarget;
                if (touched.current) caret.current = { start: field.selectionStart, end: field.selectionEnd };
              }}
              onPaste={(event) => {
                const pasted = pastedFiles(event.clipboardData);
                if (!takesFiles || pasted.length === 0) return;
                event.preventDefault();
                files.add(pasted);
              }}
              onKeyDown={(event) => {
                touched.current = true;
                if (mentions.onKeyDown(event)) return;
                if (event.key === "Escape" && expanded) {
                  event.preventDefault();
                  setExpanded(false);
                  return;
                }
                const press = {
                  key: event.key,
                  ctrlKey: event.ctrlKey,
                  metaKey: event.metaKey,
                  shiftKey: event.shiftKey,
                  isComposing: event.nativeEvent.isComposing,
                  // eslint-disable-next-line @typescript-eslint/no-deprecated -- Safari marks an input method's Enter only with this code.
                  keyCode: event.keyCode,
                };
                const mentionOpen = mentions.boxProps["aria-controls"] !== undefined;
                const shown = suggestion !== undefined;
                if (shown && sendsSuggestion({ ...press, altKey: event.altKey }, { shown, mentionOpen })) {
                  event.preventDefault();
                  void send(suggestion);
                  return;
                }
                // Read at each press, so a choice in Settings applies in an open chat too.
                if (sendsOnEnter(press, readSendKeys())) {
                  event.preventDefault();
                  void send();
                }
              }}
            />
          </div>
          {folded && sendButtons}
        </div>
        {source !== null && (
          <ul className="composer-files" aria-label="Where the text comes from">
            <li className="chip">
              <Icon name="tiles" />
              <span className="composer-file-name">From {source}</span>
            </li>
          </ul>
        )}
        {files.attachments.length > 0 && (
          <ul className="composer-files" aria-label="Attached files">
            {files.attachments.map((attachment) => (
              <li key={attachment.key} className="chip">
                <Icon name="file" />
                <span className="composer-file-name">{attachment.name}</span>
                <button
                  className="icon-button"
                  aria-label={`Remove ${attachment.name}`}
                  data-tooltip="Remove the file"
                  onClick={() => files.remove(attachment.key)}
                >
                  <Icon name="x" />
                </button>
              </li>
            ))}
          </ul>
        )}
        {uploading && <ProgressBar label="Eva receives the file" />}
        {rewriting !== null && <ProgressBar label={`Eva runs ${rewriting} on the text`} />}
        {folded ? (
          undoButton !== null && <div className="composer-row">{undoButton}</div>
        ) : (
          <div className="composer-row">
            {canAttach && (
              <button
                className="icon-button"
                aria-label="Attach a file"
                data-tooltip="Attach a file"
                disabled={!takesFiles}
                onClick={() => picker.current?.click()}
              >
                <Icon name="clip" />
              </button>
            )}
            {block === null && menu.textActions.length + menu.savedPrompts.length > 0 && (
              <MenuButton
                className="icon-button"
                name="Text actions and saved prompts"
                label="Text actions and saved prompts"
                turnedOff={rewriting !== null}
                fromStart
                above
                items={textActions}
              >
                <Icon name="command" />
              </MenuButton>
            )}
            <EngineChip session={session} choices={choices} running={running} onChanged={onChanged} />
            {undoButton}
            <span className="grow" />
            {sendButtons}
          </div>
        )}
      </div>
      {block !== null && (
        <p className="composer-blocked" id={lineId}>
          {block.composerLine} <a href={block.address}>Open the step</a>
        </p>
      )}
    </div>
  );
}

/**
 * The engine, model and effort of the chat. A chat with no turn picks the engine here. Afterwards
 * the menu says why it is fixed: a phone has no hover, so a tooltip alone would not reach it. The
 * model changes between turns, with a note on the cost. The effort changes at any time.
 */
function EngineChip({
  session,
  choices,
  running,
  onChanged,
  trigger = "chip",
  actions = [],
  onOpenChange,
}: {
  readonly session: ComposerChat;
  readonly choices: ChatChoices;
  readonly running: boolean;
  readonly onChanged: () => Promise<void>;
  /** "plus" opens the same menu from the + button of a folded box, with the other settings of the row (#943). */
  readonly trigger?: "chip" | "plus";
  /** The other settings of the row, such as Attach a file and the text actions, above the engine. */
  readonly actions?: readonly MenuItem[];
  readonly onOpenChange?: (open: boolean) => void;
}): ReactElement {
  const [open, setOpen] = useState(false);
  useBackLayer(open, () => setOpen(false));
  const tell = useRef(onOpenChange);
  tell.current = onOpenChange;
  useEffect(() => {
    tell.current?.(open);
    // A menu that unmounts open, such as on a send, must not leave the box folded.
    return () => tell.current?.(false);
  }, [open]);
  const [found, setFound] = useState<readonly EngineName[]>([]);
  const [savingCount, setSaving] = useState(0);
  const saving = savingCount > 0;
  const root = useRef<HTMLDivElement>(null);
  const showError = useShowError();
  const lock = engineLock(session, running);
  const note = modelNote(session, running);

  useEffect(() => {
    if (!open || lock !== null) return;
    let current = true;
    api
      .setupState()
      .then((state) => {
        if (current) setFound(state.engines);
      })
      // The menu still offers the chat's own engine.
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [open, lock]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setOpen(false);
    };
    const onPointer = (event: PointerEvent): void => {
      if (!(event.target instanceof Node) || root.current?.contains(event.target) !== true) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  // Saves that overlap can end in any order, so each save waits for the one before it. The queue
  // lives here, not in the menu: the menu can close and open again during a save.
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const choose = (change: () => Promise<unknown>): Promise<boolean> => {
    setSaving((count) => count + 1);
    const saved = queue.current.then(async () => {
      try {
        await change();
        await onChanged();
        return true;
      } catch (caught) {
        showError(caught);
        return false;
      } finally {
        setSaving((count) => count - 1);
      }
    });
    queue.current = saved;
    return saved;
  };

  // The newest effort that the person picked. The slider shows it until the chat's record shows
  // it too, so a save that ends, or a refresh that comes late, never pulls the slider back.
  const [picked, setPicked] = useState<EffortLevel | null>(null);
  const effortSaves = useRef(0);
  // An effort that waits for the save before it. Keys pressed meanwhile change only this level.
  const nextEffort = useRef<EffortLevel | null>(null);
  const pickEffort = (effort: EffortLevel): void => {
    setPicked(effort);
    const queued = nextEffort.current !== null;
    nextEffort.current = effort;
    if (queued) return;
    effortSaves.current += 1;
    void choose(() => {
      const next = nextEffort.current ?? effort;
      nextEffort.current = null;
      return choices.setEffort(next);
    }).then((done) => {
      effortSaves.current -= 1;
      // A failed save leaves the chat's level as it was, and the slider shows it again.
      if (!done && effortSaves.current === 0) setPicked(null);
    });
  };
  useEffect(() => {
    if (effortSaves.current === 0) setPicked(null);
  }, [session.effort]);

  const engines = found.includes(session.engine) ? found : [session.engine, ...found];
  // A model with no effort level, such as Claude Code's Haiku, offers none (#550).
  const effortShown = takesEffort(session.engine, session.modelAlias);
  return (
    <div className="chip-picker" ref={root}>
      {trigger === "plus" ? (
        <button
          className="icon-button composer-plus"
          aria-label="Attach and settings"
          data-tooltip="Attach, text actions, engine, model and effort"
          aria-haspopup="dialog"
          aria-expanded={open}
          // The tap keeps the focus in the text, so a phone keyboard stays open.
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => setOpen((isOpen) => !isOpen)}
        >
          <Icon name="plus" />
        </button>
      ) : (
        <button
          className="chip"
          aria-haspopup="dialog"
          aria-expanded={open}
          data-tooltip={
            lock === null
              ? "Pick the engine, the model and the effort"
              : running
                ? "Pick the effort"
                : "Pick the model and the effort"
          }
          onClick={() => setOpen((isOpen) => !isOpen)}
        >
          <Icon name="bolt" />
          <span className="chip-engine">{engineLabel(session.engine)} · </span>
          {modelLabel(session.modelAlias, answeredModel(session.turns, session.modelAlias))}
          {effortShown && <span className="chip-effort">· {effortLabel(session.effort)}</span>}
          <Icon name="down" />
        </button>
      )}
      {open && (
        <div
          className={trigger === "plus" ? "chip-menu composer-menu" : "chip-menu"}
          role="dialog"
          aria-label={trigger === "plus" ? "Attach and settings" : "Engine, model and effort"}
          onPointerDown={(event) => {
            // A tap on a button keeps the focus in the text, so a phone keyboard stays open. The slider still drags.
            if (trigger === "plus" && event.target instanceof Element && event.target.closest("button") !== null)
              event.preventDefault();
          }}
        >
          {actions.length > 0 && (
            <div className="menu composer-actions" role="group" aria-label="Actions">
              <MenuItems items={actions} onChosen={() => setOpen(false)} />
            </div>
          )}
          {lock !== null ? (
            <p>{lock}</p>
          ) : (
            <div className="chip-group" role="group" aria-label="Engine">
              <span className="chip-group-name">Engine</span>
              {engines.map((engine) => (
                <button
                  key={engine}
                  className={`chip${engine === session.engine ? " on" : ""}`}
                  aria-pressed={engine === session.engine}
                  disabled={saving}
                  onClick={() => void choose(() => choices.setEngine(engine))}
                >
                  {engineLabel(engine)}
                </button>
              ))}
            </div>
          )}
          <div className="chip-group" role="group" aria-label="Model">
            <span className="chip-group-name">Model</span>
            {modelAliases.map((model) => (
              <button
                key={model}
                className={`chip${model === session.modelAlias ? " on" : ""}`}
                aria-pressed={model === session.modelAlias}
                disabled={saving || running}
                onClick={() => void choose(() => choices.setModel(model))}
              >
                {modelLabel(model)}
              </button>
            ))}
          </div>
          {note !== null && <p>{note}</p>}
          {effortShown && <EffortSlider effort={picked ?? session.effort} busy={saving} onPick={pickEffort} />}
        </div>
      )}
    </div>
  );
}

/**
 * The effort levels have an order, so one slider shows them. The name follows each move, but the
 * chat takes the level only on the native `change` event: on release, or on each key press. So a
 * drag sends one request, not one for each stop.
 */
function EffortSlider({
  effort,
  busy,
  onPick,
}: {
  readonly effort: EffortLevel;
  readonly busy: boolean;
  readonly onPick: (effort: EffortLevel) => void;
}): ReactElement {
  // The level under the finger during a drag, before the chat takes it.
  const [dragged, setDragged] = useState<EffortLevel | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const pick = useRef(onPick);
  pick.current = onPick;

  useEffect(() => {
    const slider = input.current;
    if (slider === null) return;
    const onChange = (): void => {
      const picked = effortLevels[slider.valueAsNumber];
      setDragged(null);
      if (picked !== undefined) pick.current(picked);
    };
    slider.addEventListener("change", onChange);
    return () => slider.removeEventListener("change", onChange);
  }, []);

  const shown = dragged ?? effort;
  const index = effortLevels.indexOf(shown);
  return (
    <div className="chip-group" role="group" aria-label="Effort" aria-busy={busy}>
      <span className="chip-group-name">Effort</span>
      {/* The slider is never disabled while it saves: a disabled slider drops the drag and the focus. */}
      <input
        ref={input}
        className="effort-slider"
        type="range"
        min={0}
        max={effortLevels.length - 1}
        step={1}
        value={index}
        aria-label="Effort"
        aria-valuetext={effortName(shown)}
        style={{ "--share": index / (effortLevels.length - 1) } as CSSProperties}
        onChange={(event) => setDragged(effortLevels[event.target.valueAsNumber] ?? null)}
      />
      {/* The slider already gives its name to a screen reader. */}
      <span className="effort-name" aria-hidden="true">
        {busy && <ButtonSpinner />}
        {effortName(shown)}
      </span>
    </div>
  );
}

interface Attachment {
  readonly key: number;
  readonly name: string;
  /** The line for the agent, or null while the upload runs. */
  readonly note: string | null;
}

interface Attachments {
  readonly attachments: readonly Attachment[];
  /** Uploads each file at once. A failed upload leaves the list and shows its error. */
  readonly add: (picked: readonly File[]) => void;
  readonly remove: (key: number) => void;
  readonly set: (attachments: readonly Attachment[]) => void;
}

function useAttachments(sessionId: string | null): Attachments {
  const [attachments, setAttachments] = useState<readonly Attachment[]>([]);
  const nextKey = useRef(0);
  const showError = useShowError();

  const remove = (key: number): void => setAttachments((current) => current.filter((item) => item.key !== key));

  const add = (picked: readonly File[]): void => {
    for (const file of picked) {
      const key = nextKey.current;
      nextKey.current += 1;
      setAttachments((current) => [...current, { key, name: file.name, note: null }]);
      api.attachFile(file, sessionId).then(
        // A file that the person removed during its upload stays removed.
        ({ note }) => setAttachments((current) => current.map((item) => (item.key === key ? { ...item, note } : item))),
        (caught: unknown) => {
          remove(key);
          showError(caught);
        },
      );
    }
  };

  return { attachments, add, remove, set: setAttachments };
}

type VoiceState =
  | { readonly phase: "idle" }
  | { readonly phase: "recording"; readonly elapsedMs: number }
  | { readonly phase: "transcribing" };

interface VoiceNote {
  readonly state: VoiceState;
  /** False on a page that cannot reach the microphone, such as one over plain HTTP. */
  readonly isSupported: boolean;
  readonly start: () => Promise<void>;
  /** Stops the recording and hands what Eva heard to the box. */
  readonly finish: () => void;
  readonly cancel: () => void;
}

/** Records a voice note in the browser, and hands Eva's text to `deliver`. */
function useVoiceNote(deliver: (heard: string) => void): VoiceNote {
  const [state, setState] = useState<VoiceState>({ phase: "idle" });
  const recorder = useRef<MediaRecorder | null>(null);
  const keep = useRef(false);
  const isGone = useRef(false);
  const showError = useShowError();
  // A browser gives the microphone only to a secure page: HTTPS, or this computer itself.
  const isSupported = window.isSecureContext && typeof MediaRecorder !== "undefined";

  // The microphone light must go off when the person leaves the chat.
  useEffect(() => {
    isGone.current = false;
    return () => {
      isGone.current = true;
      keep.current = false;
      recorder.current?.stop();
    };
  }, []);

  useEffect(() => {
    if (state.phase !== "recording") return;
    const startedAt = Date.now();
    const timer = setInterval(() => setState({ phase: "recording", elapsedMs: Date.now() - startedAt }), 1_000);
    return () => clearInterval(timer);
  }, [state.phase]);

  const transcribe = async (audio: Blob): Promise<void> => {
    setState({ phase: "transcribing" });
    try {
      const { text } = await api.transcribe(audio);
      if (text === "") throw new Error("Eva heard no speech in the voice note.");
      deliver(text);
    } catch (caught) {
      showError(caught);
    } finally {
      setState({ phase: "idle" });
    }
  };

  const start = async (): Promise<void> => {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      showError(new Error("The browser does not let Eva use the microphone. Allow it in the site settings."));
      return;
    }
    // The person can leave the chat while the browser asks for the microphone (#1072).
    if (isGone.current) {
      for (const track of stream.getTracks()) track.stop();
      return;
    }
    const type = recordingType((candidate) => MediaRecorder.isTypeSupported(candidate));
    const started = new MediaRecorder(stream, type === null ? undefined : { mimeType: type });
    const chunks: Blob[] = [];
    started.addEventListener("dataavailable", (event) => chunks.push(event.data));
    started.addEventListener("stop", () => {
      for (const track of stream.getTracks()) track.stop();
      recorder.current = null;
      if (keep.current) void transcribe(new Blob(chunks, { type: started.mimeType }));
      else setState({ phase: "idle" });
    });
    recorder.current = started;
    keep.current = false;
    started.start();
    setState({ phase: "recording", elapsedMs: 0 });
  };

  const stop = (send: boolean): void => {
    keep.current = send;
    recorder.current?.stop();
  };

  return { state, isSupported, start, finish: () => stop(true), cancel: () => stop(false) };
}

function isTouchScreen(): boolean {
  return window.matchMedia("(pointer: coarse)").matches;
}

/** True on a screen whose short side is a phone's, so a tablet keeps the settings row. */
function isPhoneSized(): boolean {
  return Math.min(window.screen.width, window.screen.height) < 600;
}

/** The height of the part of the page that the person sees. A phone keyboard makes it lower. */
function useVisibleHeight(): number {
  // A pinch zoom also makes the visible part smaller, so the scale gives back the window's own height.
  const read = (): number => {
    const view = window.visualViewport;
    return view === null ? window.innerHeight : view.height * view.scale;
  };
  const [height, setHeight] = useState(read);
  useEffect(() => {
    const follow = (): void => setHeight(read());
    window.visualViewport?.addEventListener("resize", follow);
    window.addEventListener("resize", follow);
    return () => {
      window.visualViewport?.removeEventListener("resize", follow);
      window.removeEventListener("resize", follow);
    };
  }, []);
  return height;
}

/** The height of one line of the text, so the box grows in whole lines. NaN until the box is on the page. */
function useLineHeight(box: RefObject<HTMLTextAreaElement | null>, changes: readonly unknown[]): number {
  const [line, setLine] = useState(Number.NaN);
  useEffect(() => {
    const element = box.current;
    if (element !== null) setLine(Number.parseFloat(getComputedStyle(element).lineHeight));
  }, [box, ...changes]);
  return line;
}

/** True for a field that takes text. The box never takes the focus from one, such as a title being renamed. */
function isTextField(element: Element | null): boolean {
  return (
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLSelectElement ||
    (element instanceof HTMLElement && element.isContentEditable) ||
    (element instanceof HTMLInputElement && !["button", "checkbox", "radio", "submit", "range"].includes(element.type))
  );
}

const noMenuItems: ComposerMenuItems = { textActions: [], savedPrompts: [] };
const noSuggestions: readonly string[] = [];

/** The vault's text actions and saved prompts. Without a vault, or on a failed read, the menu has none. */
function useComposerMenu(): ComposerMenuItems {
  const [items, setItems] = useState<ComposerMenuItems>(noMenuItems);
  useEffect(() => {
    let current = true;
    api
      .composerMenu()
      .then((loaded) => {
        if (current) setItems(loaded);
      })
      // The box works without the menu, so a failed read only hides the button.
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, []);
  return items;
}

/** A box at least this tall shows the handle, even when its text does not scroll. */
const tallText = 96;
/** The handle never makes the text shorter than two lines. */
const shortestText = 48;
/** The share of the visible window that the large editor's text takes. */
const editorShare = 0.6;

/**
 * The tallest height of the text, as a share of the window, and whether the handle shows (issue 660). A box with a
 * line or two has nothing to resize, so the handle shows only when the text scrolls or the box is tall.
 */
function useComposerHeight(
  box: RefObject<HTMLTextAreaElement | null>,
  text: string,
): {
  readonly share: number | null;
  readonly tall: boolean;
  /** True when the text does not fit and scrolls, so the box offers the large editor. */
  readonly overflows: boolean;
  readonly onHeight: (height: number | null) => void;
  readonly sizeFrom: (grow: boolean) => number;
} {
  const [share, setShare] = useState(readComposerHeight);
  const [tall, setTall] = useState(false);
  const [overflows, setOverflows] = useState(false);
  useEffect(() => {
    const element = box.current;
    if (element === null) return;
    const measure = (): void => {
      const scrolls = element.scrollHeight > element.clientHeight + 1;
      setOverflows(scrolls);
      setTall(scrolls || element.clientHeight >= tallText);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [box, text, share]);
  const onHeight = (height: number | null): void => {
    const next = height === null ? null : heightShare(height, window.innerHeight);
    saveComposerHeight(next);
    // A drag writes pixels on the box. An unchanged share renders nothing, so the box would keep them and stop following
    // the window.
    if (next !== null) box.current?.style.setProperty("--composer-height", `${String(next * 100)}dvh`);
    setShare(next);
  };
  /** A box that is shorter than its limit grows from the limit, so a drag up never lowers the limit. */
  const sizeFrom = (grow: boolean): number => {
    const element = box.current;
    if (element === null) return 0;
    const shown = element.getBoundingClientRect().height;
    return grow ? Math.max(shown, Number.parseFloat(getComputedStyle(element).maxHeight) || shown) : shown;
  };
  return { share, tall, overflows, onHeight, sizeFrom };
}
