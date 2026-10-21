# Trust the Eva's own GitHub account, and list trust in Settings (#354)

## Why

Each person was asked about their own repositories, because `trust.trustedRepositoryOwners` was empty. In `eva work`, nobody may answer in time, and the work then runs with no hooks. Eva already knows her GitHub account (`state/github-account.json`, #222).

## Plan

1. **Core trust.** `ProjectPreparer` reads its trusted owners through a function, on each turn. `eva.ts` gives the owners of the saved settings plus the login in the GitHub account record. So a new login, or a changed list, applies to the next turn with no restart.
2. **Live setting.** Add `trust.trustedRepositoryOwners` to the live setting keys, so the page says no restart.
3. **Saved answers.** `TrustStore` gets `answers()` and `forget(url)`. One store, made in `eva.ts`, serves the preparer and the API, so the two never disagree.
4. **API.** `GET /api/trust` gives the own account, the owners and the saved answers. `DELETE /api/trust/answers` removes one answer. The owners change through `PUT /api/settings`.
5. **Web.** A new Settings section, **Trusted repositories**, with three cards: the own account, the owners list (add and remove), and the saved answers (remove).
6. **Docs.** `docs/guide/reference.md`.

## Gaps and decisions

- **Section or card?** The issue says "section". Decision: a new section `trust`, as the issue asks.
- **A token in a saved URL.** `trust.json` keys are the URLs that Eva cloned. Decision: show each URL without its user part and redact it. Remove an answer by the shown URL: every key with that shown URL goes.
- **The page may change a security setting.** `PUT /api/settings` already accepts every key, and the person answers trust questions from the phone already. Decision: the page adds and removes owners.
- **Per-folder answers** (`clone-origins.json`). The issue asks for answers by repository. Decision: out of scope.
