# EVE design system

The EVE style is the target design for Eva's web page. It takes its look from EVE, the robot in the film WALL·E: a pearl-white shell, a black visor and two glowing eyes.

This folder is the reference for the redesign. The redesign of #161 implemented it. Issues with the `UI` label continue it.

- [`reference.html`](reference.html) is the interactive reference. Open it in a browser. It shows every page on a computer (left) and on a phone (right), a colour picker, a light and dark switch, and all of EVE's expressions.
- [`screenshots/`](screenshots/) holds a capture of each page, in light and dark.

The reference is a mock-up. It uses example data, and its labels are English. It was made before a full review of Eva's features, so some parts differ from the code, on purpose or for now. The section [Differences](#differences-between-the-reference-and-the-code) lists them.

The rest of this guide describes the web page as the code builds it. Where the code and the reference differ, the guide follows the code.

## How to use this reference

- Copy the reference as closely as possible. Change the code to match the design, not the design to match the code.
- When the reference shows a feature that Eva does not have, build it if it is small and clearly useful. Otherwise, adapt the design to what exists, and write down the gap in the issue.
- When Eva has a feature that the reference does not show, design it with the same parts: the same tokens, components and expressions.
- Keep the existing rules of the web client: `role` and `aria-label` names that the end-to-end tests use, 44 px touch targets on a phone, and the theme and density settings.

## Principles

1. **Soft objects, no lines.** Surfaces separate by fill and shadow, not by borders. A border shows only where state needs it, such as the amber border of a permission card.
2. **Pills for actions.** Buttons, chips and status labels are fully round. Cards have large radii.
3. **One colour.** The person picks one seed colour. Every other colour comes from it.
4. **EVE is a character.** Her eyes show what Eva is doing. One state always uses the same expression.
5. **The phone is first class.** Each page has a phone layout, with the main action within reach of the thumb.
6. **Every state has a shape.** Status uses a colour and a form together: a pill, a dot, an icon. Colour is never the only signal.

## Colour

### The seed

The person picks a seed colour. The default seed is EVE blue, `#2aa8ff`. The code converts the seed from sRGB to OKLCH, and keeps three numbers:

| Variable | Meaning            | Rule                                                                             |
| -------- | ------------------ | -------------------------------------------------------------------------------- |
| `--h`    | Hue                | The seed hue.                                                                    |
| `--c`    | Chroma             | The seed chroma, at most 0.2.                                                    |
| `--l`    | Lightness          | The seed lightness, from 0.45 to 0.9.                                            |
| `--on-l` | Text on the accent | 0.2 (dark text) when the seed lightness is above 0.72. Otherwise 1 (white text). |

`client/appearance.ts` does the conversion (`hexToOklch`) and the limits (`seedVariables`). It also gives the phone's `theme-color` from the seed. `reference.html` has its own copy of `hexToOklch`.

### Tokens

Every token is an `oklch()` value that uses the seed. Neutrals get a small tint of the seed hue.

| Token                  | Light                                       | Dark                      | Use                                                   |
| ---------------------- | ------------------------------------------- | ------------------------- | ----------------------------------------------------- |
| `--bg`                 | `oklch(0.972 0.008 h)`                      | `oklch(0.16 0.02 h)`      | Page background                                       |
| `--bg2`                | `oklch(0.925 0.018 h)`                      | `oklch(0.23 0.045 h)`     | End of the main gradient                              |
| `--side`               | `oklch(0.986 0.005 h)`                      | `oklch(0.18 0.02 h)`      | Nav rail, lists, inspector                            |
| `--panel`              | `oklch(1 0 0)`                              | `oklch(0.22 0.022 h)`     | Cards, bubbles, composer, dialogs                     |
| `--ink`                | `oklch(0.25 0.025 h)`                       | `oklch(0.94 0.012 h)`     | Text                                                  |
| `--muted`              | `oklch(0.55 0.025 h)`                       | `oklch(0.7 0.03 h)`       | Secondary text                                        |
| `--line`               | `oklch(0.915 0.012 h)`                      | `oklch(0.29 0.025 h)`     | Rare dividers                                         |
| `--chip`               | `oklch(0.95 0.012 h)`                       | `oklch(0.26 0.025 h)`     | Chips, inputs, step lines                             |
| `--accent`             | `oklch(l c h)`                              | `oklch(max(l, 0.74) c h)` | Main buttons, active states                           |
| `--accent-ink`         | `oklch(min(l, 0.52) 0.9c h)`                | `oklch(max(l, 0.82) c h)` | Accent text and icons on neutral surfaces             |
| `--on-accent`          | `oklch(on-l 0.03 h)`                        | `oklch(0.17 0.03 h)`      | Text on the accent                                    |
| `--soft`               | `oklch(0.945 0.25c h)`                      | `oklch(0.3 0.45c h)`      | User bubbles, selected items                          |
| `--soft-ink`           | `oklch(0.4 0.6c h)`                         | `oklch(0.92 0.4c h)`      | Text on `--soft`                                      |
| `--eye`                | `oklch(0.87 min(c, 0.13) h)`                | same                      | EVE's eyes                                            |
| `--glow`               | `oklch(0.74 c h)`                           | same                      | Glow of the eyes, the send button and the main button |
| `--visor` / `--visor2` | `oklch(0.26 0.02 h)` / `oklch(0.07 0.01 h)` | same                      | Visor gradient                                        |
| `--shell`              | `oklch(1 0 0)`                              | `oklch(0.32 0.02 h)`      | White ring around a large visor                       |

Semantic colours do not follow the seed:

| Token                  | Light                                           | Dark                                          |
| ---------------------- | ----------------------------------------------- | --------------------------------------------- |
| `--ok` / `--ok-bg`     | `oklch(0.56 0.14 150)` / `oklch(0.95 0.04 150)` | `oklch(0.8 0.15 150)` / `oklch(0.3 0.06 150)` |
| `--warn` / `--warn-bg` | `oklch(0.6 0.14 65)` / `oklch(0.96 0.05 85)`    | `oklch(0.84 0.13 80)` / `oklch(0.32 0.06 75)` |
| `--warn-ink`           | `oklch(0.45 0.12 65)`                           | same as `--warn`                              |
| `--on-warn`            | `oklch(0.2 0.03 70)`                            | same                                          |
| `--bad` / `--bad-bg`   | `oklch(0.56 0.19 25)` / `oklch(0.95 0.03 25)`   | `oklch(0.74 0.16 25)` / `oklch(0.32 0.07 25)` |

- `--ok` shows a thing that is done or passed.
- `--warn` shows a thing that waits for the person or the network: a step that is left, an approval, a warning, offline.
- `--chip` shows a thing that is optional.
- `--bad` shows a failure, or a button that deletes or refuses.
- `--warn-ink` is small text on `--warn-bg`. `--on-warn` is text on a solid `--warn`.

The file kinds of the Files page have their own fixed colours, `--type-red` to `--type-pink`. They do not follow the seed either.

`styles.css` gives a name to each shared value of this guide. Use the name, not the value:

- Shadows: `--shadow`, `--dialog-shadow` and `--sheet-shadow`.
- Glows: `--button-glow`, `--send-glow` and `--eye-glow`.
- Fills: `--main-gradient`, `--visor-fill`, `--send-fill` and `--scrim`.
- Radii: `--radius-*`. Fonts: `--font` and `--mono`.
- Space and text steps: `--space-*` and `--text-*`.

### The palette picker

The Appearance setting offers 15 seeds, and a free colour input:

| Name               | Seed      | Name  | Seed      | Name     | Seed      |
| ------------------ | --------- | ----- | --------- | -------- | --------- |
| EVE blue (default) | `#2aa8ff` | Lime  | `#a3d82b` | Pink     | `#ff5ca8` |
| Cyan               | `#11c5d9` | Sun   | `#f7c600` | Magenta  | `#d63bd9` |
| Teal               | `#14b8a6` | Amber | `#ff9f1a` | Violet   | `#8b5cf6` |
| Mint               | `#34d399` | Coral | `#ff6f59` | Indigo   | `#5468ff` |
| Leaf               | `#4caf50` | Red   | `#e5484d` | Graphite | `#6b7a90` |

The seed is an appearance setting, as the theme and the density are. Store it per browser with them (`client/appearance.ts`).

## Typography

- **Interface:** Quicksand, a variable font. The interface uses mostly weights 500, 600 and 700. Fallback: `"Nunito", system-ui, sans-serif`. Body text uses weight 500, at 14 px (13 px in compact density).
- **Code, paths, commands and codes:** IBM Plex Mono, weights 400 and 500. Fallback: `ui-monospace, monospace`.
- **Scale (px):** 11, 12, 13, 14 (body), 15, 17 to 18, 19 to 20 (page titles), 24 to 32 (greetings and large titles), 40 (pairing code). Uppercase labels use 11 to 13 px, with a letter spacing from 0.04em to 0.09em.
- Bundle the fonts with the web client. The executable must work with no internet access.

## Shape and space

| Element                                     | Radius                               |
| ------------------------------------------- | ------------------------------------ |
| Buttons, chips, status pills, search fields | 999 px (pill)                        |
| Cards                                       | 22 px                                |
| Eva's bubble                                | 24 px, with 8 px at the bottom left  |
| User's bubble                               | 24 px, with 8 px at the bottom right |
| Composer                                    | 28 px (24 px on a phone)             |
| Dialogs                                     | 28 px                                |
| Bottom sheets                               | 30 px at the top                     |
| Nav rail buttons                            | 18 px                                |
| Step lines, code blocks, inputs             | 14 px                                |

Spacing uses steps of 4 px. Common gaps are 8, 10, 12, 16 and 20 px. Compact density makes some steps smaller. Page padding is 28 px on a computer and 14 px on a phone.

## Shadows, glow and gradients

- **Card shadow (light):** `0 10px 30px oklch(0.4 0.05 h / 0.11), 0 1px 2px oklch(0.4 0.05 h / 0.06)`.
- **Card shadow (dark):** a 1 px ring in `--line`, plus `0 12px 30px oklch(0 0 0 / 0.4)`. Dark surfaces need the ring, because a shadow does not show on a dark ground.
- **Main area background:** `radial-gradient(ellipse 90% 70% at 50% 0%, var(--bg), var(--bg2) 120%)`. The top is light, and the bottom is a little darker and more tinted.
- **Main button:** `--accent` fill. Some main buttons also glow, with `0 6px 18px -6px var(--glow)` (`--button-glow`). They are on the login page, the new-device notice, the Schedules page and its sheet, and the update dialog.
- **Send button:** a small visor, 40 px (44 px on a phone). It uses the visor gradient, a 2 px `--shell` ring and `0 0 18px -2px var(--glow)`. The arrow is in `--eye` and glows as the eyes do. When the box is empty, the button is a flat `--chip` disc with a `--muted` arrow. When the browser can record and the box is empty, a microphone button takes its place. If voice notes are not set up, it opens their setup. While a turn runs and the box is empty, the button becomes a Stop button in `--ink`, at the same place.
- **Visor:** `radial-gradient(ellipse at 50% 22%, var(--visor), var(--visor2) 72%)`.
- **Eyes:** `filter: drop-shadow(0 0 0.05em var(--eye)) drop-shadow(0 0 0.14em var(--glow))` on the wrapper of the two eyes, so that every eye shape glows the same way.
- **Scrim behind a dialog:** `oklch(0.25 0.03 h / 0.32)`. Dark: `oklch(0.05 0.01 h / 0.55)`. The chat details sheet and the new-device, schedule and update dialogs add a 3 px backdrop blur.

## Layout

### Computer

A grid of four columns: nav rail (76 px), list (300 px), main area (flexible) and inspector (300 px). A page without a list or an inspector drops that column.

- **Nav rail:** EVE's visor at the top, then Chats, Projects, Files and Schedules. Settings sits apart, at the bottom. A count badge in `--warn` shows on Chats when an approval waits, and on Settings when setup steps are left. The visor's face shows the one main state, in this order: offline, an approval, a problem, a chat that waits for setup, or chats at work (`client/nav-visor.ts`). A tap on the visor plays a short playful face.
- **List:** a title with a "New" button, a search field, and items grouped by day ("Today", "This week").
- **Main area:** a header (title, subtitle, status pill, actions), the content in a column of at most 760 px, and the composer.
- **Inspector:** the details of the selected item, such as the chat details.

### Phone

From top to bottom: the header (back or menu button, title and subtitle, more button), the content, the composer, and a bottom tab bar with Chats, Projects, Files, Schedules and Settings. List pages use a large 30 px title.

Dialogs become bottom sheets on a phone. Their buttons stack at full width.

## Components

All of them are in `reference.html`. The class names there are short; pick clear names in the code.

| Component         | Reference class                                      | Notes                                                                                                                                                                                                                                                                                        |
| ----------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Visor             | `.mk`                                                | Sizes: 28 px in messages, 36 px in the nav rail, 76 px and 128 px (with the white shell ring) for empty and login states.                                                                                                                                                                    |
| Button            | `.btn`, `.pri`, `.soft`, `.out`, `.ghost`, `.danger` | Pill. One main (`.pri`) button per view.                                                                                                                                                                                                                                                     |
| Chip              | `.chip`                                              | For filters, engine and model pickers. `.on` is selected.                                                                                                                                                                                                                                    |
| Status pill       | `.st.ok`, `.warn`, `.bad`, `.idle`, `.live`          | A dot and a word. `.live` has a glowing dot.                                                                                                                                                                                                                                                 |
| Card              | `.card`                                              | `--panel` fill and the card shadow.                                                                                                                                                                                                                                                          |
| Chat list item    | `.ci`                                                | Title, last line of the chat, time, and a status pill: "Needs you", "Working" or "Unread". An unread chat shows its last line in `--ink`. On a phone, a dot on the list button tells of an unread chat.                                                                                      |
| Message bubbles   | `.msg`, `.bub`                                       | Eva's bubble is a card with the visor at its side. The user's bubble is `--soft`.                                                                                                                                                                                                            |
| Folded steps      | `.steps`                                             | One line: an icon, the step count, the last step, and an arrow that opens the list. The time shows only in the working indicator.                                                                                                                                                            |
| Step list         | `.stl`                                               | One line per step: an icon, an action pill and the detail. A step opens a dialog with its input and output.                                                                                                                                                                                  |
| Working indicator | `.working`, `.dots`                                  | Three glowing dots and the time.                                                                                                                                                                                                                                                             |
| Progress bar      | (none)                                               | A wait inside a card. A `--chip` pill track and an `--accent` fill with a `--glow` shadow. A known share fills the bar and shows the percentage. An unknown share runs two lines of light across it. The code calls it `.progress`.                                                          |
| Skeleton          | (none)                                               | A wait for content that fills a large area. `--line` shapes with a `--chip` shimmer, and the radii of the content to come: list items, bubbles, cards and facts. The code calls it `.skeleton`.                                                                                              |
| Composer          | `.cmp`, `.box`                                       | Attach, engine and model chip, mode label, microphone, send or stop. The engine chip picks the engine, the model and the effort. Once a chat has a turn, only the effort changes.                                                                                                            |
| Context ring      | `.ring`                                              | A conic gradient that shows the share of context in use.                                                                                                                                                                                                                                     |
| Permission card   | in the approval page                                 | Amber border, a "Needs you" pill, the chat that asks, a title, the exact command, and two buttons: Allow once and Deny.                                                                                                                                                                      |
| Dialog and sheet  | `.scrim`, `.dlg`, `.sheet`                           |                                                                                                                                                                                                                                                                                              |
| Toast             | `.toast`                                             | Dark, at the bottom, with text and up to two small buttons. A ring around the close button empties, then the toast closes. The code calls the part `Toast`.                                                                                                                                  |
| Tooltip           | (none)                                               | A short hint over an element. Dark, as the toast is. It shows above the element, or below when the top has no room. An element can ask for the right side with `data-tooltip-side="right"`, as the nav rail does. The code calls it `.tooltip`; an element asks for one with `data-tooltip`. |
| Banner            | `.banner`                                            | `--warn-bg`, for offline and other page-wide states.                                                                                                                                                                                                                                         |
| Setup step        | `.check`                                             | A round mark, a title, a detail and a button.                                                                                                                                                                                                                                                |
| Day timeline      | `.tl`                                                | The schedules of today on a 24-hour bar, with a glowing "now" line.                                                                                                                                                                                                                          |
| Toggle            | `.tog`                                               | A `<button role="switch">` with `aria-checked`. The knob moves, so the state does not show by colour alone. The code calls it `.toggle`.                                                                                                                                                     |
| Diff              | `.diff`                                              | Added lines on `--ok-bg`, removed lines on `--bad-bg`.                                                                                                                                                                                                                                       |

Icons are simple line icons on a 24 px grid, 1.8 px stroke, round caps (`client/icons.tsx`). Eva draws her own icons: they come from no icon library. The design reference page of the web app (Settings, Development) shows each icon with its use. Give each icon one meaning on every page.

The visor has four sizes. A large visor stands alone on a page, so a white shell ring lifts it off the background. A small visor sits next to text, so it has no ring.

| Size   | Class  | Shell ring | Use                                 |
| ------ | ------ | ---------- | ----------------------------------- |
| 28 px  | `s`    | No         | Next to a message or a dialog title |
| 36 px  | (none) | No         | Nav rail, a card or a notice        |
| 76 px  | `l`    | Yes        | An empty page or a page-wide notice |
| 128 px | `xl`   | Yes        | Login and the new chat greeting     |

The favicon and the app icons in `src/frontends/web/icons/` draw the visor in EVE blue. [`eva.svg`](eva.svg) is the animated face of the README.

## EVE's expressions

Only the eyes change. The visor stays round and still. Most faces blink. Happy, wink, delighted, skeptical, asleep and error have their own motion, or none, instead. A transition of 0.35 s morphs one face into the next.

![All expressions](screenshots/expressions-light.webp)

| Class        | Name      | Eyes                                                  | Motion                                                            | Use                                                          |
| ------------ | --------- | ----------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------ |
| (none)       | Neutral   | Ovals, tilted 14°                                     | Blink every 7 s                                                   | At rest. The icon and each answer.                           |
| `e-joy`      | Happy     | Filled crescents (an oval with the lower part masked) | Small bounce                                                      | A new chat, a greeting, a finished task, a complete setup.   |
| `e-wink`     | Wink      | Two ovals                                             | One eye closes every 2.6 s and holds; the other squeezes a little | Done and saved.                                              |
| `e-love`     | Delighted | Hearts                                                | Heartbeat                                                         | Thanks, a device allowed.                                    |
| `e-surprise` | Surprised | Large circles                                         | A pop every 3 s                                                   | A new version, a new message.                                |
| `e-think`    | Thinking  | Small, looking up                                     | Drift between the upper corners                                   | The engine thinks, with no text yet.                         |
| `e-scan`     | Searching | Ovals                                                 | Look left, right, up and down, with pauses                        | Pairing a device, a search in the vault.                     |
| `e-listen`   | Listening | Circles                                               | Grow and shrink                                                   | Waiting for a message or an answer.                          |
| `e-focus`    | Focused   | Thin lines                                            | None                                                              | Project mode, tests.                                         |
| `e-firm`     | Firm      | Flat top, tilted inward                               | None                                                              | Asks permission for something important.                     |
| `e-skeptic`  | Skeptical | One line, one raised oval                             | None                                                              | A note conflict, an unconfirmed schedule.                    |
| `e-worry`    | Worried   | Inner ends raised                                     | Small tremble                                                     | No connection to the hub.                                    |
| `e-sad`      | Sad       | Flat top, outer ends down                             | None                                                              | A schedule failed, a denied permission.                      |
| `e-error`    | Error     | Two crosses                                           | None                                                              | Something broke and needs the person.                        |
| `e-sleep`    | Asleep    | Thin lines and a floating "z"                         | The lines breathe                                                 | The hub rests, nothing is scheduled. A chat waits for setup. |

`stateFaces` in `client/visor-faces.ts` maps each state to its face, as the "Use" column says. Pages pick a state face there. Only the playful faces, such as a tap on the nav visor and the festive eyes, name a face by hand. Some uses have no page yet, such as the wink for a saved note and the sad face for a failed schedule.

The login page rotates faces while it waits: searching (5 s), thinking (3 s), happy, wink, surprised, listening and delighted.

With `prefers-reduced-motion`, no face moves and no eye blinks. The waits stand still too: a skeleton loses its shimmer, and a running bar shows a still part of its fill.

### Festive eyes

On a special day, such as a holiday or a solstice, the welcome places show that day's eyes: the new chat greeting, the login code page, the nav visor at rest and the tab icon. `client/special-days.ts` picks the day, and `client/festive-art.ts` draws its eyes. A festive visor has the class `festive`, a motion class `f-*`, and its own hue. On some days, the 76 px and 128 px visors also show a decoration, such as a hat, or a small scene. State faces never change, because they inform. The days are a surprise, so no page lists them. The reference page has no festive eyes.

## Pages

Each page has a computer and a phone capture, in light and dark. The light captures are below.

### Log in: confirm this device

![Computer](screenshots/login-computer-light.webp) ![Phone](screenshots/login-phone-light.webp)

- The code is large, easy to read from a distance, and copies with one tap.
- Each way to allow the code has a line with an icon: on Eva's computer, in a terminal, in Telegram, or on an Eva page on another device.
- While the page waits, EVE changes face, so the page looks alive.
- The token stays as a fallback, behind a quiet link.

### New chat

![Computer](screenshots/new-computer-light.webp) ![Phone](screenshots/new-phone-light.webp)

- EVE greets with happy eyes instead of a blank page.
- Suggestions show what Eva does well: notes, calendar, projects and reminders. The calendar shows only when Google is set up.
- With no engine or no vault, EVE sleeps instead. She names the missing step, with a button to it, and the message box locks.
- The engine, the model and the mode show in the composer. The engine and the model change there.

### A conversation at work

![Computer](screenshots/chat-computer-light.webp) ![Phone](screenshots/chat-phone-light.webp)

- The agent steps fold into one line that shows the last step.
- While Eva works, the send button becomes Stop, at the same place.
- The context is a ring.
- Retry, Fork and Copy show under each answer, with no menu.

### Eva asks for permission

![Computer](screenshots/approval-computer-light.webp) ![Phone](screenshots/approval-phone-light.webp)

- The permission card is in the chat that asks, with an amber border.
- It shows the exact command.
- Two ways out: allow once, or deny.
- The chat list shows a "Needs you" pill, and the nav rail a count badge.
- A request from a chat that is not on screen shows as a notice line that opens that chat.

### Project list and details

![Computer](screenshots/projects-computer-light.webp) ![Phone](screenshots/projects-phone-light.webp)

- The status and tag filters are one-tap chips, not drop-down menus.
- The status has a colour and a shape.
- Each clone is a card with its branch, its state and its chats.

### A chat in a clone

![Computer](screenshots/project-chat-computer-light.webp) ![Phone](screenshots/project-chat-phone-light.webp)

- The header shows the project, the clone and the branch.
- A "Project mode" chip tells it apart from the assistant.
- Each edit and each test run is a line in the step list.

### Schedules

![Computer](screenshots/schedules-computer-light.webp) ![Phone](screenshots/schedules-phone-light.webp)

- A day line shows what runs today and the current time.
- Each schedule says when it repeats in words.
- The last result has a colour.
- The confirmation card says that nothing runs without a yes.

### Setup and appearance

![Computer](screenshots/settings-computer-light.webp) ![Phone](screenshots/settings-phone-light.webp)

- Settings has its own list of sections on a computer.
- The setup is a ring with the steps left. The open step has the main button.
- Optional steps have another icon and colour, so they do not look like errors.
- Appearance has the colour picker, the theme and the density.

### Remote access and devices

![Computer](screenshots/devices-computer-light.webp) ![Phone](screenshots/devices-phone-light.webp)

- The new-device notice shows the same large code as the login page.
- "This one" marks the current device.
- A button copies the Tailscale address.
- "Log out every device" stands apart, in red.

### When something goes wrong

![Computer](screenshots/problems-computer-light.webp) ![Phone](screenshots/problems-phone-light.webp)

- Offline: a banner at the top with the most likely reason and a "Try now" button. EVE looks worried. The message stays in the box until Eva is back.
- Note conflict: the two versions side by side, and clear buttons.
- Errors say what happened and what to do, with the button that does it.

### Updates

![Computer](screenshots/updates-computer-light.webp) ![Phone](screenshots/updates-phone-light.webp)

- Each version says in one sentence what changes.
- The button says exactly what happens: update and restart.

### Chat details and background tasks

![Computer](screenshots/chat-details-computer-light.webp) ![Phone](screenshots/chat-details-phone-light.webp)

- The inspector on a computer, and a bottom sheet on a phone, show the same content.
- Background tasks show their state with one word and one colour.

## Differences between the reference and the code

The redesign of #161 implemented the reference, with the differences below.

### Open gaps

Each open gap has an issue that closes it.

| Reference                                              | Today                                                                                                                                        | Issue |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| The context ring of a chat, for every engine           | A pi chat shows a token count only, because pi does not report its context window. A Claude Code chat does the same when no window is known. | #210  |
| A time on each message, and a duration on the steps    | Only the running turn shows its time. A stored turn keeps only the time when it ended.                                                       | #211  |
| "Create a project", with its folder and its repository | "Makes its folder in the vault". The New project form can now create a repository, but the suggestion does not say so.                       | #493  |

### Differences on purpose

The pull requests of #161 chose these differences, each for the reason below. Do not copy these parts of the reference while the reason holds.

| Reference                                          | Today                                               | Why                                                                                                       | Pull request |
| -------------------------------------------------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------ |
| A six-character pairing code with a dot, `K7Q·4MF` | Four characters, with no dot.                       | Eva's codes have four characters, with no 0, O, 1 or I, so the person can compare them by eye.            | #183         |
| `+N −N` on each edit, and diffs in the chat        | Each edit is a plain step line.                     | No step carries line counts.                                                                              | #186         |
| Messages that wait while offline, and a retry time | The text stays in the box, with a "Try now" button. | The owner chose no message queue. The page retries every 2 seconds, so a countdown would only flicker.    | #190         |
| A time on each background task                     | The state only, with one icon for every task.       | Eva keeps no time and no kind for a task.                                                                 | #191         |
| Engine and model chips in the chat details         | Plain text.                                         | An open chat keeps its engine and its model (lesson 41). The composer changes them before the first turn. | #191         |
| Update policy chips in the version dialog          | The policy lives in Settings only.                  | Each setting has one home.                                                                                | #206         |
| The last use of each device                        | The date when the device was allowed.               | Eva stores only that date. A last use needs a new stored field and a write at each request.               | #205         |
| Fonts from the internet                            | Fonts bundled with the web client.                  | The executable must work with no internet access.                                                         | #182         |
| A glance of the neutral face                       | The neutral face only blinks.                       | The reference names `glance` keyframes that it does not define.                                           | #181         |
| Separate Telegram and Google sections              | One Connections section.                            | #166 grouped them on purpose. Each still has its own setup step page.                                     | #197         |

## Captures

The captures come from `reference.html` with Playwright and Chromium: the computer page at 1280 × 800 px and the phone screen at 390 × 824 px, with reduced motion, in WebP. Capture them again when the reference changes.
