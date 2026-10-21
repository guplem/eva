/**
 * The empty state of a new chat: EVE with happy eyes, a greeting for the time of day, and the
 * suggestions. A tap on a suggestion sends it as the first message. A chat that cannot answer
 * yet shows the missing setup step instead.
 */
import { useEffect, useId, useState, type ReactElement } from "react";
import { api, type ChatBlocker } from "./api.ts";
import { Icon } from "./icons.tsx";
import { greeting, setupBlock, suggestions, type Suggestion } from "./new-chat.ts";
import { useSpecialDay, Visor } from "./Visor.tsx";
import { stateFaces } from "./visor-faces.ts";

export function NewChatGreeting({ onPick }: { readonly onPick: (text: string) => void }): ReactElement {
  // Null until the settings answer, so the cards do not jump from three to four.
  const [shown, setShown] = useState<readonly Suggestion[] | null>(null);
  // On a special day, EVE shows that day's eyes and greeting instead.
  const day = useSpecialDay();

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
      <Visor size={128} face={stateFaces.greeting} festive={day?.id ?? null} />
      <div>
        {/* The chat's title is the page's h1. */}
        <h2>{day?.greeting ?? greeting(new Date().getHours())}</h2>
        <p>{day?.line ?? "How can I help today?"}</p>
      </div>
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
          window.location.hash = block.address;
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
