/**
 * The empty state of a new chat: EVE with happy eyes, a greeting for the time of day, and the
 * suggestions. A tap on a suggestion sends it as the first message. A chat that cannot answer
 * yet shows the missing setup step instead.
 */
import { useCallback, useEffect, useId, useRef, useState, type ReactElement, type SyntheticEvent } from "react";
import { api, type ChatBlocker } from "./api.ts";
import { Dialog } from "./Dialog.tsx";
import { Icon } from "./icons.tsx";
import { factQuestion, greeting, setupBlock, suggestions, type FactQuestion, type Suggestion } from "./new-chat.ts";
import { usePersonalFacts, useSpecialDay } from "./FestiveDay.tsx";
import { Visor } from "./Visor.tsx";
import { stateFaces } from "./visor-faces.ts";
import { useLeaveGuard } from "./UnsavedChangesDialog.tsx";
import { goTo } from "./back-layers.ts";

export function NewChatGreeting({ onPick }: { readonly onPick: (text: string) => void }): ReactElement {
  // Null until the settings answer, so the cards do not jump from three to four.
  const [shown, setShown] = useState<readonly Suggestion[] | null>(null);
  // On a special day, EVE shows that day's eyes and greeting instead.
  const day = useSpecialDay();
  // A fact that Eva still needs, such as the birthday, shows as one special suggestion. With no
  // vault, the facts never load: Eva has nowhere to save a fact, so she asks for none.
  const facts = usePersonalFacts();
  const question = facts === null ? null : factQuestion(facts.missing);

  useEffect(() => {
    let current = true;
    void api
      .settings()
      .then((settings) => settings.config.google.email !== null)
      // Without the settings, Eva cannot say that the calendar works.
      .catch(() => false)
      .then((googleReady) => {
        if (current) setShown(suggestions(googleReady));
      });
    return () => {
      current = false;
    };
  }, []);

  return (
    <div className="new-chat">
      <Visor size={128} face={stateFaces.greeting} festive={day?.id ?? null} followPointer />
      <div>
        {/* The chat's title is the page's h1. */}
        <h2>{day?.greeting ?? greeting(new Date().getHours())}</h2>
        <p>{day?.line ?? "How can I help today?"}</p>
      </div>
      {question !== null && <FactQuestionCard question={question} onPick={onPick} />}
      {shown !== null && (
        <div className="suggestions" role="group" aria-label="Suggestions">
          {shown.map((suggestion) => (
            <SuggestionCard key={suggestion.title} suggestion={suggestion} onPick={onPick} />
          ))}
        </div>
      )}
    </div>
  );
}

/** An empty chat that cannot answer yet: EVE asleep, what is missing, and a button to that step. */
export function NewChatSetup({ blocker }: { readonly blocker: ChatBlocker }): ReactElement {
  const block = setupBlock(blocker);
  return (
    <div className="new-chat">
      <Visor size={128} face={stateFaces.notSetUp} />
      <div>
        <h2>Not ready yet</h2>
        <p>{block.sentence}</p>
      </div>
      <button
        className="primary large"
        onClick={() => {
          goTo(block.address);
        }}
      >
        {block.action}
      </button>
    </div>
  );
}

/** The title is the button's name, and the line its description, so a screen reader says them apart. */
function SuggestionCard({
  suggestion,
  onPick,
}: {
  readonly suggestion: Suggestion;
  readonly onPick: (text: string) => void;
}): ReactElement {
  const id = useId();
  return (
    <button
      className="card suggestion"
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-detail`}
      onClick={() => onPick(suggestion.title)}
    >
      <Icon name={suggestion.icon} />
      <span className="suggestion-text">
        <span id={`${id}-title`}>{suggestion.title}</span>
        <small id={`${id}-detail`}>{suggestion.detail}</small>
      </span>
    </button>
  );
}

/**
 * The special suggestion: a fact that Eva still needs. A tap opens a small form, and the answer
 * goes to Eva as the first message, so she saves it in the vault with her skill.
 */
function FactQuestionCard({
  question,
  onPick,
}: {
  readonly question: FactQuestion;
  readonly onPick: (text: string) => void;
}): ReactElement {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [answer, setAnswer] = useState("");
  const field = useRef<HTMLInputElement>(null);
  // A stable function: the dialog focuses its Cancel button each time its onClose changes.
  const close = useCallback(() => setOpen(false), []);
  // Cancel keeps the answer for the next open, so only a page move asks. A save would send it to Eva.
  useLeaveGuard(answer.trim() !== "", null);
  // The dialog focuses Cancel when it opens. This effect runs after it, so the field gets the focus.
  useEffect(() => {
    if (open) field.current?.focus();
  }, [open]);
  const submit = (event: SyntheticEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (answer.trim() === "") return;
    setOpen(false);
    setAnswer("");
    onPick(question.message(answer.trim()));
  };
  return (
    <>
      <button
        className="card suggestion fact-question"
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-detail`}
        onClick={() => setOpen(true)}
      >
        <Icon name="user" />
        <span className="suggestion-text">
          <span id={`${id}-title`}>{question.title}</span>
          <small id={`${id}-detail`}>{question.detail}</small>
        </span>
      </button>
      {open && (
        <Dialog label={question.detail} closeLabel="Cancel" onClose={close}>
          <form className="inline-form" onSubmit={submit}>
            <label className="field grow">
              <span className="field-label">{question.label}</span>
              <input
                ref={field}
                type={question.answer}
                value={answer}
                autoComplete="off"
                onChange={(event) => setAnswer(event.target.value)}
              />
            </label>
            <button className="primary" type="submit" disabled={answer.trim() === ""}>
              Tell Eva
            </button>
          </form>
        </Dialog>
      )}
    </>
  );
}
