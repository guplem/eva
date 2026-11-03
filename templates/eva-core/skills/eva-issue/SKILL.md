---
name: eva-issue
description: Report a problem in Eva, or ask for something that Eva cannot do, as an issue in Eva's public repository. Use when the person says that something in Eva does not work, could work better, or is missing: the chat, the web app, Telegram, a command, a setting or a sync, in any wording.
---

# Report a problem in Eva

Eva's code is public at `https://github.com/{{evaRepository}}`. A good issue there lets someone fix Eva for every person.

1. Look at your own state first, as the "Your own state" section of Eva's prompt says, so the issue holds facts and not guesses.
2. Ask the person what you still need: what they did, what happened, and what they expected.
3. Search for a duplicate: `gh issue list --repo {{evaRepository}} --state all --search "<words>"`. When an issue matches, offer to comment on it instead.
4. Show the person the title and the body, and open the issue only after they agree.
5. Open it with `gh issue create --repo {{evaRepository}} --title "<title>" --body-file .eva/scratch/<name>.md`, then share the link.

Write the issue so that a coding agent can fix it with no other context:

- Start the title with `Bug:` (something does not work), `Feature:` (a new capability) or `Improvement:` (a better version of something that exists).
- Start the body with one line that summarizes the issue.
- Say what happens now, what the person expected, and why it matters.
- For a bug, give the steps to reproduce it.
- Write a suspected cause as a guess, never as a fact.
- End with "Done when": behavior that a person can see.

End the body with a "This Eva" list. Give as many of these facts as the issue needs, because each one saves a question later:

- The Eva version and the kind of install, from `eva version`.
- The machine's role (hub or satellite) and the problems that `eva status` shows.
- The operating system of the machine that runs Eva, such as `Linux x86_64` or `Windows 11`.
- The engine and the model of this chat.
- The front end: web app, Telegram or terminal.
- For the web app or Telegram: the device (phone, tablet or computer) and its system and browser.
- For the web app: whether the person opened it on the machine that runs Eva or from another device through Tailscale.
- For a layout problem: the screen size and the window size.

You cannot see the person's device, so ask for what you do not know. For a problem in the web app, the person can instead press "Report a bug" in Settings, Development: that link fills the device, the screen, the window and how the person reached the web app.

Add the related warnings and errors from your log, as a code block. Keep the time, the level, the event kind and the error code. Shorten a long run of the same line to one line and a count.

The issue is public. Never put personal data in it. Before you show the body, scrub each line:

- Replace each path with a placeholder: `<vault>`, `<home>`, `<project>` or `<clone>`. Keep the file name only when it is Eva's own file, such as `settings.json`.
- Replace a machine name, a Tailscale address or an IP address with `<machine>`.
- Replace the name of a person, a repository or a note with `<person>`, `example-app` or `<note>`.
- Remove a token, a key, a password, an email address, a chat id and every piece of note or chat text.

Then read the body again, line by line, as a stranger would. When a line still tells something about the person, remove it. When `gh` says that it has no login, tell the person to log in to GitHub in Settings in Eva's web app.
