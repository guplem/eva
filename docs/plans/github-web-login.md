# Plan: the GitHub step on the web page

Issue: #243. A separate decision for the owner: #244.

## Why

A person who sets up Eva from the web page meets a hand-made token, in a step that comes after the vault step that needs it.
`eva setup` already has the GitHub browser login (the device flow, #47) and asks for it first.
The goal "Eva works from a phone" asks the web page to offer the same easy path.

## Re-evaluation of the proposals

1. **Browser login on the web page.** Keep. It removes four steps on github.com, and the core code exists.
2. **GitHub before the vault.** Keep. The vault card needs the token to list the repositories. The terminal setup already uses this order.
3. **The agents' `gh` login.** Drop from this PR.
   Reusing Eva's token breaks the promise in `githubLoginAccess` and lesson 96, so it needs the owner (#244).
   A sentence on the card that names a login the page cannot fix gives the person a problem with no action. That makes the experience worse.
4. **Words.** Keep. One word ("vault") and one fact per place.

## Changes

- Core: a `GitHubBrowserLogin` that runs `githubDeviceLogin` in the background.
  `start()` returns the code and the link. `finish()` waits for the token, then saves it through `Eva.saveSecret`, which also reads the account.
- API: `POST /api/github/login` and `POST /api/github/login/finish`, with no request timeout, as for Google.
- Web: a "Log in with GitHub" button on the GitHub card and on the vault card. The pasted token stays as a fallback.
- Progress: the GitHub step moves right before the vault step.
- Words: the step page, the step summary and the card say each fact once, with the word "vault".

## Gaps

- G1. The core and API shape of the login: state, a second start, a page reload, the expiry, the null client id.
- G2. The card layout: how the login and the token fallback share the card, and what the vault card shows.
- G3. The step order: who reads the order of `setupProgress`, and which tests change.

## Decisions

G1, the core and the API:

- Put `GitHubBrowserLogin` in `src/core/vault/github-browser-login.ts`, beside `githubDeviceLogin`. Leave `githubDeviceLogin` as it is: the CLI uses it.
- `start()` returns `{ code, url }`. While a login waits, `start()` returns the same code, so a page reload never kills a code that the person typed already.
- Save the token as soon as GitHub gives it, through a `save` callback (`Eva.saveSecret`). A phone that closes the page during the login still gets the login.
- `finish()` waits for that save. Two calls get the same result. A settled error stays until a `finish()` reads it. With no login, it throws `github_failed`.
- Cancel through the sleep: the login's sleep rejects once the login is stale. `stop()` runs in `Eva.stop`. Catch every background rejection.
- A null client id throws `github_failed` with a hint to paste a token. The page needs no capability flag.
- One new `Eva` option, `githubBrowserLogin` (the whole device flow), with a default, so `src/main.ts` stays as it is. Tests and the demo server replace the whole flow.
- `finish()` keeps the result until the next `start()`: a phone can lose the answer of the long request, and the page asks again.
- Routes: `POST /api/github/login` and `POST /api/github/login/finish`. Add `/api/github/` to the no-timeout list. Gate them as the other secret saves: the token or a device cookie.
- Do not log or register the user code: it is not a secret, and the redactor would hide it.

G2, the page:

- One shared `GitHubLogin` component in a new leaf file `client/GitHubLogin.tsx`. The GitHub card and the vault card without a token use it. The vault push callout keeps its link to the GitHub step.
- The page asks for the end again after a network error, for at most the life of the code.
- Copy the Claude login layout: `Steps`, a `primary` button, the code with a Copy button, an `a.button-link` to GitHub's page (a phone blocks a late `window.open`), and a `role="status"` wait line.
- The page starts `finish` right after `start`. On success: `reloadSettings()`, then `noteAndReload` with the restart words.
- Keep the hand-made token behind a `link-button`, "Paste a token instead", as in `ClaudeCodeCard`. The `SecretField` stays visible when a token is saved, so Remove works.
- Show `githubLoginAccess` under the login button. The `repo` scope is broad, and `eva setup` says the same.
- Add "login browser code" to both GitHub search entries.

G3, the order:

- Move the github step between the engine and the vault in `setupProgress`. Do not fold it into the vault step: the Connections card must stay, and a fold gives one fact two homes.
- GitHub stays optional: `nextToDo` skips it, and the vault card offers the login.
- Update `progress.test.ts` and the e2e tests that use step numbers or index 1.
- Keep "notebook" in the CLI, the README and the guide: there it is a deliberate plain word. Use "vault" on the page and in `progress.ts`.

## Rejected review findings

- Rewrite a commit subject, or fold the e2e mock fix into the step-order commit. The rules forbid a history rewrite.
- Add `sleep` and base URL options to `Eva` to test the default login. The default is a three-line adapter. `githubDeviceLogin` and `GitHubBrowserLogin` each have their own tests.
- Put the login in the vault push callout. The callout is a short warning, and the GitHub step is one tap away.
- Guard `start()` against a device flow that never calls `show`. The real flow always calls it first. The `DeviceLogin` type now states this.
- Drop the card description on the step page. The card also stands alone in the Connections section, where it needs the description.
