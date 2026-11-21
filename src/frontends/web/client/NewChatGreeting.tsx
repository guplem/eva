/**
 * The empty state of a new chat: EVE with happy eyes, a greeting for the time of day, and the
 * suggestions. A tap on a suggestion sends it as the first message. A chat that cannot answer
 * yet shows the missing setup step instead. With a widget on, the page is the day panel (#972):
 * the greeting in one row, then the widgets, and no suggestions.
 */
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
  type SyntheticEvent,
} from "react";
import { api, type ChatBlocker } from "./api.ts";
import { Dialog } from "./Dialog.tsx";
import { Icon } from "./icons.tsx";
import { factQuestion, greeting, setupBlock, suggestions, type FactQuestion, type Suggestion } from "./new-chat.ts";
import { usePersonalFacts, useSpecialDay } from "./FestiveDay.tsx";
import { Visor } from "./Visor.tsx";
import { WidgetGrid, type WidgetFrames } from "./WidgetGrid.tsx";
import { stateFaces, type Face } from "./visor-faces.ts";
import { useLeaveGuard } from "./UnsavedChangesDialog.tsx";
import { goTo } from "./back-layers.ts";
import type { SpecialDayId } from "./special-days.ts";

export function NewChatGreeting({
  onPick,
  widgets,
}: {
  readonly onPick: (text: string) => void;
  /** The home page's widgets. An empty chat that is not the home page shows none. */
  readonly widgets?: WidgetFrames;
}): ReactElement {
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

  const title = day?.greeting ?? greeting(new Date().getHours());
  const line = day?.line ?? "How can I help today?";
  if (widgets !== undefined && widgets.frames.length > 0)
    return (
      <DayPanel face={stateFaces.greeting} festive={day?.id ?? null} title={title} line={line} widgets={widgets} />
    );
  return (
    <div className="new-chat">
      <Visor size={128} face={stateFaces.greeting} festive={day?.id ?? null} followPointer />
      <div>
        {/* The chat's title is the page's h1. */}
        <h2>{title}</h2>
        <p>{line}</p>
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
export function NewChatSetup({
  blocker,
  widgets,
}: {
  readonly blocker: ChatBlocker;
  /** The home page's widgets. An empty chat that is not the home page shows none. */
  readonly widgets?: WidgetFrames;
}): ReactElement {
  const block = setupBlock(blocker);
  const button = (
    <button
      className="primary large"
      onClick={() => {
        goTo(block.address);
      }}
    >
      {block.action}
    </button>
  );
  // The widgets need no engine, so the day panel keeps them below the missing step.
  if (widgets !== undefined && widgets.frames.length > 0)
    return (
      <DayPanel face={stateFaces.notSetUp} festive={null} title="Not ready yet" line={block.sentence} widgets={widgets}>
        {button}
      </DayPanel>
    );
  return (
    <div className="new-chat">
      <Visor size={128} face={stateFaces.notSetUp} />
      <div>
        <h2>Not ready yet</h2>
        <p>{block.sentence}</p>
      </div>
      {button}
    </div>
  );
}

/**
 * The home page with widgets (#972): EVE, the greeting and its line in one row, with the header
 * slot at its right on a computer (#1007), then the grid at
 * the full width. On a computer the grid fills the height above the message box.
 */
function DayPanel({
  face,
  festive,
  title,
  line,
  widgets,
  children,
}: {
  readonly face: Face;
  readonly festive: SpecialDayId | null;
  readonly title: string;
  readonly line: string;
  readonly widgets: WidgetFrames;
  /** An action of the row, such as the button to a missing setup step. */
  readonly children?: ReactNode;
}): ReactElement {
  return (
    <div className="new-chat day-panel">
      <WidgetGrid
        widgets={widgets}
        greeting={
          <>
            <Visor size={56} face={face} festive={festive} followPointer={face === stateFaces.greeting} />
            <div className="day-greeting-text">
              {/* The chat's title is the page's h1. */}
              <h2>{title}</h2>
              <p>{line}</p>
            </div>
            {children}
          </>
        }
      />
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
