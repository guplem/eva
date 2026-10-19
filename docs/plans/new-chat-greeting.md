# Plan: greet the person in a new chat (#170)

## Why

A new chat shows only the composer today. The design (`docs/design/eve/`, section "New chat") shows EVE with happy eyes, a greeting and four suggestions. People see this screen most, so it invites them to start, and it shows what Eva does well.

## What changes

- Add `client/new-chat.ts`: the greeting for an hour of the day, and the list of suggestions. It is plain logic, so a unit test covers it.
- Add `client/NewChatGreeting.tsx`: the 128 px visor with the happy face (`stateFaces.greeting`), the greeting, "How can I help today?", and the suggestion cards.
- Show it in `Conversation.tsx` when the chat has no turn, no message on the way, and no fork. A tap on a card sends its text, through the same `send` as the composer.
- Add the styles to `conversation.css`.
- Add an end-to-end test: an empty chat shows the greeting and the cards, and a tap starts the chat.

## Gaps and decisions

1. **Tap: fill the composer, or send?** The issue allows both. Its "Done when" says that a tap starts the chat. Decision: a tap sends the card's title as the first message. Eva asks for details when a request needs them, such as the text of a reminder.
2. **Which suggestions can Eva do today?**
   - Notes: "Summarize yesterday's notes". Eva reads the vault and its git history. Kept as in the design.
   - Calendar: "What do I have this week?". Eva needs the Google tools. Shown only when Google is set up.
   - Projects: the design says "Create a project, with its folder and its repository". Eva cannot create a repository today. She can create the project folder, because the vault's `AGENTS.md` gives its format. Decision: keep the title, and change the line to "Makes its folder in the vault".
   - Reminders: "Remind me of something". The vault's `schedule` skill does it. The line becomes "Sets a schedule that messages you", since "A schedule" alone says little.
3. **When is Google set up?** Decision: when the settings have a Google account (`config.google.email`). The setup progress uses the same test. A failed request counts as not set up. The cards show once the answer arrives, so the grid does not jump from three cards to four.
4. **Heading level.** The page title "New chat" is the only `h1`, and the tests rely on it. Decision: the greeting is an `h2` with the size of the design (32 px, 26 px on a phone).
5. **Time of day.** Decision: "Good morning." from 05:00 to 11:59, "Good afternoon." from 12:00 to 17:59, "Good evening." otherwise. The browser's local time sets it.
6. **Phone.** The design shows three cards in one column, and a 76 px visor. Decision: CSS hides the fourth card under 760 px, the width where the page becomes the phone layout. Each card is 44 px tall or more.
7. **Forks.** A fork always starts from an answer, so it never shows the greeting. The greeting shows only in a chat with no parent.
