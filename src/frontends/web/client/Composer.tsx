/**
 * The message box of a chat: the text, the engine and model chip, the mode chip, and the round
 * Send button. While a turn runs and the box is empty, Send becomes Stop at the same place.
 * Eva queues a message sent during a turn, so typed text brings Send back.
 */
import { useEffect, useId, useRef, useState, type ReactElement } from "react";
import type { EngineName, ModelAlias } from "../../../shared/engine-port.ts";
import { api, type ChatBlocker, type SessionRecord } from "./api.ts";
import { chipLock, engineLabel, modelLabel } from "./conversation-parts.ts";
import { useShowError } from "./error-toast.tsx";
import { Icon } from "./icons.tsx";
import { setupBlock } from "./new-chat.ts";

const models: readonly ModelAlias[] = ["default", "opus", "sonnet", "haiku"];

interface ComposerProps {
  readonly session: SessionRecord;
  readonly running: boolean;
  /** Resolves false when the send failed, so the box gets its text back. */
  readonly onSend: (text: string) => Promise<boolean>;
  readonly onStop: () => void;
  readonly onChanged: () => Promise<void>;
  /** The missing setup step that stops the chat. It locks the box, because a send would fail. */
  readonly blocker: ChatBlocker | null;
}

export function Composer({ session, running, onSend, onStop, onChanged, blocker }: ComposerProps): ReactElement {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  const send = async (): Promise<void> => {
    const message = text.trim();
    if (message === "" || sending || blocker !== null) return;
    setSending(true);
    setText("");
    // The person must not type the message again.
    if (!(await onSend(message))) setText(text);
    setSending(false);
  };

  const showStop = running && text.trim() === "";
  const block = blocker === null ? null : setupBlock(blocker);
  const lineId = useId();
  return (
    <div className="composer">
      <div className="composer-box">
        <textarea
          aria-label="Message"
          aria-describedby={block === null ? undefined : lineId}
          placeholder={block === null ? "Message Eva" : "Eva cannot answer yet"}
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
        <div className="composer-row">
          <EngineChip session={session} running={running} onChanged={onChanged} />
          <span className="chip soft">{session.mode === "project" ? "Project" : "Assistant"}</span>
          <span className="grow" />
          {showStop ? (
            <button className="send stop" aria-label="Stop" title="Stop" onClick={onStop}>
              <Icon name="x" />
            </button>
          ) : (
            <button
              className="send"
              aria-label="Send"
              title="Send"
              disabled={sending || text.trim() === "" || block !== null}
              onClick={() => void send()}
            >
              <Icon name="send" />
            </button>
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
 * The engine and model of the chat. A chat with no turn picks them here. Afterwards the menu
 * says why they are fixed: a phone has no hover, so a tooltip alone would not reach it.
 */
function EngineChip({
  session,
  running,
  onChanged,
}: {
  readonly session: SessionRecord;
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
        className={`chip${lock === null ? "" : " fixed"}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={lock ?? "Pick the engine and the model"}
        onClick={() => setOpen((isOpen) => !isOpen)}
      >
        <Icon name="bolt" />
        <span className="chip-engine">{engineLabel(session.engine)} · </span>
        {modelLabel(session.modelAlias)}
        {lock === null && <Icon name="down" />}
      </button>
      {open && (
        <div className="chip-menu" role="dialog" aria-label="Engine and model">
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
                    onClick={() => void choose(() => api.setEngine(session.id, engine))}
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
                    onClick={() => void choose(() => api.setModel(session.id, model))}
                  >
                    {modelLabel(model)}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function isTouchScreen(): boolean {
  return window.matchMedia("(pointer: coarse)").matches;
}
