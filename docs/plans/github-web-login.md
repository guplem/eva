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

(Filled in after the gap research.)
