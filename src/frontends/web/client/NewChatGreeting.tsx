/**
 * The empty state of a new chat: EVE with happy eyes, a greeting for the time of day, and the
 * suggestions. A tap on a suggestion sends it as the first message.
 */
import { useEffect, useId, useState, type ReactElement } from "react";
import { api } from "./api.ts";
import { Icon } from "./icons.tsx";
import { greeting, suggestions, type Suggestion } from "./new-chat.ts";
import { Visor } from "./Visor.tsx";
import { stateFaces } from "./visor-faces.ts";

export function NewChatGreeting({ onPick }: { readonly onPick: (text: string) => void }): ReactElement {
  // Null until the settings answer, so the cards do not jump from three to four.
  const [shown, setShown] = useState<readonly Suggestion[] | null>(null);

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
      <Visor size={128} face={stateFaces.greeting} />
      <div>
        {/* The chat's title is the page's h1. */}
        <h2>{greeting(new Date().getHours())}</h2>
        <p>How can I help today?</p>
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
