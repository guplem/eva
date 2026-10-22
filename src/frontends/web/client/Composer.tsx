/**
 * The message box of a chat: the text, the engine and model chip, the mode chip, and the round
 * Send button. While a turn runs and the box is empty, Send becomes Stop at the same place.
 * Eva queues a message sent during a turn, so typed text brings Send back.
 * The microphone records a voice note. Eva turns it into text on her machine and sends the text.
 * Without voice notes on her machine, the microphone leads to the button that installs them.
 * The clip attaches files in an Assistant chat. Each file uploads when the person picks it, so Send waits for no upload.
 */
import { useEffect, useId, useRef, useState, type ReactElement } from "react";
import { effortLevels, type EffortLevel, type EngineName, type ModelAlias } from "../../../shared/engine-port.ts";
import { api, type ChatBlocker, type SessionRecord } from "./api.ts";
import { messageWithFiles } from "./attachments.ts";
import {
  answeredModel,
  chipLock,
  composerPlaceholder,
  effortLabel,
  effortName,
  engineLabel,
  modelLabel,
} from "./conversation-parts.ts";
import { playCue } from "./cues.ts";
import { useShowError } from "./error-toast.tsx";
import { Icon } from "./icons.tsx";
import { ProgressBar } from "./Loading.tsx";
import { setupBlock } from "./new-chat.ts";
import { settingsHash } from "./settings-routes.ts";
import { recordingTime, recordingType } from "./voice-notes.ts";

const models: readonly ModelAlias[] = ["default", "opus", "sonnet", "haiku"];

/** What the composer shows of a chat. A new chat has no record until its first message. */
type ComposerChat = Pick<SessionRecord, "engine" | "modelAlias" | "effort" | "mode" | "parentId" | "turns">;

/** How the chip changes the engine and the model of a chat that has no turn yet, and the effort of any chat. */
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
  /**
   * Resolves false when the send failed, so the box gets its text back. A voice note also
   * gives the address of its recording in this tab.
   */
  readonly onSend: (text: string, recording?: string) => Promise<boolean>;
  readonly onStop: () => void;
  readonly onChanged: () => Promise<void>;
  /** The missing setup step that stops the chat. It locks the box, because a send would fail. */
  readonly blocker: ChatBlocker | null;
  /** True when Eva's machine can turn a voice note into text. */
  readonly voiceNotes: boolean;
  /** The text of the empty box. It names who answers. */
  readonly placeholder?: string;
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
}: ComposerProps): ReactElement {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const files = useAttachments();
  const picker = useRef<HTMLInputElement>(null);
  const voice = useVoiceNote(async (heard, recording) => {
    // The person must not lose what they said.
    if (!(await onSend(heard, recording))) setText(heard);
  });

  const uploading = files.attachments.some((attachment) => attachment.note === null);
  const notes = files.attachments.flatMap((attachment) => (attachment.note === null ? [] : [attachment.note]));
  const isEmpty = text.trim() === "" && files.attachments.length === 0;

  const send = async (): Promise<void> => {
    const message = messageWithFiles(text, notes);
    if (message === "" || uploading || sending || blocker !== null) return;
    const attached = files.attachments;
    playCue("send");
    setSending(true);
    setText("");
    files.set([]);
    // The person must not type the message again, nor pick the files again.
    if (!(await onSend(message))) {
      setText(text);
      files.set(attached);
    }
    setSending(false);
  };

  // A locked box cannot be cleared, so a running turn keeps its Stop button.
  const showStop = running && (isEmpty || blocker !== null);
  const block = blocker === null ? null : setupBlock(blocker);
  const lineId = useId();
  const canRecord = block === null && voice.isSupported;
  const showMic = canRecord && isEmpty;
  // A received file lands in the vault. A Project chat's agent works in its clone and does not reach it.
  const canAttach = session.mode !== "project";
  if (voice.state.phase !== "idle") {
    return (
      <div className="composer">
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
                className="send"
                aria-label="Send the voice note"
                data-tooltip="Send the voice note"
                data-cue="send"
                onClick={voice.finish}
              >
                <Icon name="send" />
              </button>
            </div>
          ) : (
            <ProgressBar label="Eva turns the voice note into text" />
          )}
        </div>
      </div>
    );
  }
  return (
    <div className="composer">
      <div className="composer-box">
        <textarea
          aria-label="Message"
          aria-describedby={block === null ? undefined : lineId}
          placeholder={block === null ? placeholder : "Eva cannot answer yet"}
          rows={1}
          disabled={block !== null}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            // On a touch screen, Enter starts a new line; the Send button sends.
            if (event.key === "Enter" && !event.shiftKey && !isTouchScreen()) {
              event.preventDefault();
              void send();
            }
          }}
        />
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
        <div className="composer-row">
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
          {canAttach && (
            <button
              className="icon-button"
              aria-label="Attach a file"
              data-tooltip="Attach a file"
              // A file picked during a send that fails would be lost when the box gets its files back.
              disabled={block !== null || sending}
              onClick={() => picker.current?.click()}
            >
              <Icon name="clip" />
            </button>
          )}
          <EngineChip session={session} choices={choices} running={running} onChanged={onChanged} />
          <span className="chip soft">{session.mode === "project" ? "Project" : "Assistant"}</span>
          <span className="grow" />
          {showMic && (
            <button
              // Beside Stop it stays quiet; alone it takes the place of Send.
              className={showStop ? "send voice" : "send"}
              aria-label={voiceNotes ? "Record a voice note" : "Set up voice notes"}
              data-tooltip={voiceNotes ? "Record a voice note" : "Set up voice notes"}
              onClick={() => {
                // A missing button tells nothing; this one leads to the button that installs voice notes.
                if (voiceNotes) void voice.start();
                else window.location.hash = settingsHash({ section: "updates", item: "versions" });
              }}
            >
              <Icon name="mic" />
            </button>
          )}
          {showStop ? (
            <button className="send stop" aria-label="Stop" data-tooltip="Stop" onClick={onStop}>
              <Icon name="x" />
            </button>
          ) : (
            !showMic && (
              <button
                className="send"
                // The send itself plays its cue, also for the Enter key.
                data-cue="none"
                aria-label="Send"
                data-tooltip="Send"
                disabled={sending || uploading || messageWithFiles(text, notes) === "" || block !== null}
                onClick={() => void send()}
              >
                <Icon name="send" />
              </button>
            )
          )}
        </div>
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
 * The engine, model and effort of the chat. A chat with no turn picks the engine and model here.
 * Afterwards the menu says why they are fixed: a phone has no hover, so a tooltip alone would not
 * reach it. The effort changes no history, so the menu offers it at any time.
 */
function EngineChip({
  session,
  choices,
  running,
  onChanged,
}: {
  readonly session: ComposerChat;
  readonly choices: ChatChoices;
  readonly running: boolean;
  readonly onChanged: () => Promise<void>;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const [found, setFound] = useState<readonly EngineName[]>([]);
  const [saving, setSaving] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const showError = useShowError();
  const lock = chipLock(session, running);

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

  const choose = async (change: () => Promise<unknown>): Promise<void> => {
    setSaving(true);
    try {
      await change();
      await onChanged();
    } catch (caught) {
      showError(caught);
    } finally {
      setSaving(false);
    }
  };

  const engines = found.includes(session.engine) ? found : [session.engine, ...found];
  return (
    <div className="chip-picker" ref={root}>
      <button
        className="chip"
        aria-haspopup="dialog"
        aria-expanded={open}
        data-tooltip={lock === null ? "Pick the engine, the model and the effort" : "Pick the effort"}
        onClick={() => setOpen((isOpen) => !isOpen)}
      >
        <Icon name="bolt" />
        <span className="chip-engine">{engineLabel(session.engine)} · </span>
        {modelLabel(session.modelAlias, answeredModel(session.turns))}
        <span className="chip-effort">· {effortLabel(session.effort)}</span>
        <Icon name="down" />
      </button>
      {open && (
        <div className="chip-menu" role="dialog" aria-label="Engine, model and effort">
          {lock !== null ? (
            <p>{lock}</p>
          ) : (
            <>
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
              <div className="chip-group" role="group" aria-label="Model">
                <span className="chip-group-name">Model</span>
                {models.map((model) => (
                  <button
                    key={model}
                    className={`chip${model === session.modelAlias ? " on" : ""}`}
                    aria-pressed={model === session.modelAlias}
                    disabled={saving}
                    onClick={() => void choose(() => choices.setModel(model))}
                  >
                    {modelLabel(model)}
                  </button>
                ))}
              </div>
            </>
          )}
          <div className="chip-group" role="group" aria-label="Effort">
            <span className="chip-group-name">Effort</span>
            {effortLevels.map((effort) => (
              <button
                key={effort}
                className={`chip${effort === session.effort ? " on" : ""}`}
                aria-pressed={effort === session.effort}
                disabled={saving}
                onClick={() => void choose(() => choices.setEffort(effort))}
              >
                {effortName(effort)}
              </button>
            ))}
          </div>
        </div>
      )}
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

function useAttachments(): Attachments {
  const [attachments, setAttachments] = useState<readonly Attachment[]>([]);
  const nextKey = useRef(0);
  const showError = useShowError();

  const remove = (key: number): void => setAttachments((current) => current.filter((item) => item.key !== key));

  const add = (picked: readonly File[]): void => {
    for (const file of picked) {
      const key = nextKey.current;
      nextKey.current += 1;
      setAttachments((current) => [...current, { key, name: file.name, note: null }]);
      api.attachFile(file).then(
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
  /** Stops the recording and sends what Eva heard. */
  readonly finish: () => void;
  readonly cancel: () => void;
}

/** Records a voice note in the browser, and hands Eva's text and the recording's address to `deliver`. */
function useVoiceNote(deliver: (heard: string, recording: string) => Promise<void>): VoiceNote {
  const [state, setState] = useState<VoiceState>({ phase: "idle" });
  const recorder = useRef<MediaRecorder | null>(null);
  const keep = useRef(false);
  const showError = useShowError();
  // A browser gives the microphone only to a secure page: HTTPS, or this computer itself.
  const isSupported = window.isSecureContext && typeof MediaRecorder !== "undefined";

  // The microphone light must go off when the person leaves the chat.
  useEffect(
    () => () => {
      keep.current = false;
      recorder.current?.stop();
    },
    [],
  );

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
      await deliver(text, URL.createObjectURL(audio));
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
