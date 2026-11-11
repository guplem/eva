# Plan: a level for each outward action (#914)

## Why

Today `asksThePerson` asks for a fixed list of actions. It matches words in a tool name, so read-only tools ask too (#910). The person cannot change it. The issue makes the approvals a preference of the person, not a security feature.

## Design

### 1. Categories and levels (`src/shared/outward-actions.ts`)

- `outwardActionCategories`: `pushCode`, `github`, `shareDriveFile`, `sendEmail`, `calendarInvitations`, `sendData`, `changeSchedules`.
- `OutwardActionLevel`: `allow`, `ask`, `deny`. `OutwardActionLevels` maps each category to a level.
- `outwardActionsOf(toolName, input)` returns the categories of one tool call. It replaces `asksThePerson`.
  - `pushCode`: `git push`.
  - `github`: `gh issue|pr|release|gist create|comment|edit|close|merge`.
  - `sendData`: the `curl` and `gh api` rules of today.
  - `changeSchedules`: the schedules rule of today.
  - `shareDriveFile`: exactly `mcp__google__set_drive_file_permissions` and `mcp__google__manage_drive_access`.
  - `sendEmail`: exactly `mcp__google__send_gmail_message`.
  - `calendarInvitations`: exactly `mcp__google__manage_event`, when the event reaches other people.
  - The pattern on words in an MCP tool name goes away. A read-only tool is in no category.
- `decideOutwardAction(categories, levels)` returns `allow`, `ask` or `deny`, with the categories that caused it. The strictest level wins: deny, then ask, then allow.
- `outwardActionWords`: for each category, a title and a line for Settings, the dialog and the prompt. It replaces `askedActionWords`.

### 2. The setting

- Key `outwardActions` in `configSchema`: one enum for each category, default `ask`.
- It is a vault setting (`sharedSettingKeys`) and a live setting (`liveSettingKeys`). It needs no migration: the schema default fills it.
- `TurnRequest` gets `outwardActionLevels: () => OutwardActionLevels`. The core reads the live settings at each call, so a change applies from the next tool call.

### 3. The engines

- Claude Code `decidePermission` and pi `decide` use `decideOutwardAction` in Assistant mode.
  - `allow`: the call runs.
  - `ask`: `requestApproval` carries the categories.
  - `deny`: the model gets a message that names the action, and that tells it not to try another way.
- Project mode and model calls keep their behavior of today.
- `describeClaudePermissions` and `describePiPermissions` build "runs", "asks" and "never runs" from the levels.

### 4. "Do not ask again"

- `ApprovalRequest`, the `approval_needed` event and `PendingApproval` get an optional `categories` list.
- The core gets one new answer path: allow the request, and first set each of its categories to `allow` in the settings. The API takes `answer: "always"` on `POST /api/approvals/<id>`. A request with no categories refuses it with `approval_invalid`.
- Web: `PermissionBody` shows a third button when the request has categories. It opens the shared `Dialog`. The text names the categories and links to `#/settings/engines/outward-actions`.
- Telegram: a third button, `a:<id>:always`. A press changes the message to a confirmation with "Yes" (`a:<id>:always-yes`) and "Cancel" (`a:<id>:back`). Cancel shows the three buttons again.

### 5. Settings page

- A new card `outward-actions` in `EnginesSection.tsx`, with one `ChoiceChips` (Allow, Ask, Deny) for each category. It saves with `saveNow`.
- Add the search entry and the `settingPlaces` row. Fix the hints in `EnginesSection.tsx` and `GooglePanel.tsx`.

### 6. The prompt

- Remove the fixed line "Ask before any action that reaches other people" from `assistant-base-prompt.md`.
- Add `outward-actions-block.ts`, after the pattern of `format-block.ts`. It names the categories on Ask and on Deny. Eva keeps it for the session, as she keeps the format block.
- Add the guideline about a request to send much or sensitive data out to `assistant-base-prompt.md`.

### 7. Docs

- `docs/guide/reference.md`: the settings table, the live settings, the permission mode row, "What Eva may do", the Google text.
- `docs/guide/how-eva-works.md`: the sentence on security settings.
- `docs/design/eve/README.md`: the permission card has three buttons. Update its captures.

## Commits

1. `refactor`: categories and levels in `outward-actions.ts`, engines use them with every level on `ask`.
2. `feat`: the `outwardActions` setting, live levels in `TurnRequest`, allow and deny in both engines, permission words.
3. `feat`: the prompt block and the guideline.
4. `feat`: the "always" answer in the core and the API.
5. `feat(web)`: the Settings card and the third button with its dialog.
6. `feat(telegram)`: the third button and its confirmation.
7. `docs`: the guide and the design guide.

## Gaps

1. **The home of the setting.** `src/core/settings/AGENTS.md` says: never read a security setting from the vault. The issue puts the levels in the vault, as a preference. An agent can then edit the levels.
2. **Bypass mode.** Does `canUseTool` run in `bypassPermissions` mode for a call that an `ask` rule names? The issue says that Eva keeps asking. The reference says the opposite. Which behavior do we keep, and what does Settings say?
3. **Deny.** Enforce it only in Eva's own decision (`canUseTool`, pi `decide`), or also with a Claude Code deny rule?
4. **Other MCP servers.** A tool of a person's own MCP server, such as a chat tool that sends, asked through the word pattern. With explicit names, it no longer asks. Accept this, or keep a rule for unknown servers?
5. **Project chats.** Do the levels apply to a Project chat, or only to Assistant mode?
6. **A tool call in several categories,** such as `git push && curl -d`. Which categories does "Do not ask again" change?

## Decisions

Three sub-agents looked for an obvious answer to each gap.

1. **The home is the vault,** as the issue says. The levels are a preference, not a security setting. The docs say so, and say that an agent can edit the vault. One fixed question stays, with no level and no "Do not ask again": a change by the agent to the levels themselves. It covers a shell command that names the vault settings file or runs `settings set outwardActions`, and a file tool's write to the vault settings file. Without it, a hidden instruction could set the schedules to Allow and undo #440. The sub-agents split 2 to 1 on this question, so the PR names it for the owner.
2. **Bypass mode keeps the levels.** The bundled Claude Code checks an `ask` rule before the mode, so `canUseTool` runs in bypass mode too. The reference, the schema comment and `assistantChat("bypassPermissions")` are wrong today. Fix them. Add a test that the `ask` rules stay in the options in bypass mode.
3. **Deny lives only in Eva's own decision.** A Claude Code rule cannot read curl flags or the guests of an event, and pi has no rules.
4. **A tool of another MCP server no longer asks through Eva.** Eva gives only the `google` server. The docs say that the tools of a person's own server follow Claude Code's rules.
5. **The levels apply in Assistant mode only.** Project mode is a clean wrapper.
6. **A request carries only its categories on Ask.** "Do not ask again" sets each of them to Allow, and the dialog names each one.
7. **The prompt block stays fixed for the session,** as the format block does. After a change in the middle of a chat, the deny message tells the model.
