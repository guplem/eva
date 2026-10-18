# Plan: pick or create the vault repository after the GitHub login (#152)

Delete this file before the merge. The decisions then live in the commits and in the pull request.

## Goal

`eva setup` offers the GitHub login first. Then it lists the person's repositories, and the person picks the vault, or chooses "Create a new vault". A new vault gets a private repository through the GitHub API with the login token, so `gh` is not needed. A typed address, a pasted token and `--non-interactive` work as before.

## Facts from the code

- `askRepository` in `src/frontends/cli/setup.ts` asks for the address first, then offers the login (`askGithubLogin`).
- `offerNewVault` makes the vault from the template, then runs `gh repo create --push` with its own `gh` login.
- `src/core/vault/github-login.ts` gets a token with the `repo` scope. That scope can list the repositories and create a private one.
- `src/core/vault/vault-clone.ts` gives git the token through a credential helper that reads `EVA_GITHUB_TOKEN`. The token never goes into a URL or a config file (the header of `vault-clone.ts`).
- `createVaultFromTemplate` makes the first commit on `main`, with no remote.
- PR #145 (#137) rewrites `setup.ts` (about 400 changed lines) and adds a web setup page. It is still open.

## Design (first draft)

1. **Core, new file `src/core/vault/github-repositories.ts`:**
   - `listGitHubRepositories(token)`: `GET /user/repos`, newest push first, all pages up to a limit. Returns the full name and the HTTPS clone address of each.
   - `createGitHubRepository(token, name)`: `POST /user/repos` with `private: true`. Returns the same shape. A name that exists gives a clear `github_failed` error.
2. **Core, `vault-clone.ts`:** `pushNewVault(repository, folder)` adds `origin`, keeps the credential helper in the clone (as `cloneVault` does), and pushes `main`.
3. **Setup (after PR #145 merges):** the login comes first. After a login or a pasted token, setup shows a numbered list: "0. Create a new vault", then the repositories. The person types a number, or a full address. With no token, the old address question stays.
4. **Create a new vault:** ask the repository name (default `vault`), create it, make the vault from the template, push it. Drop `gh` from this path.
5. **Web setup page:** offer the same choice if PR #145 adds a vault step.
6. **Docs:** `docs/guide/setup.md`, _Decide where your notebook lives_.

## Gaps

- **G1. Which repositories to list, and how many.** Owner only, or also organizations and collaborations? Archived ones? A cap?
- **G2. How to show a long list in a terminal** and on a phone-sized web page.
- **G3. Order of create and template.** Create the GitHub repository before or after the local template, and what to do when the push fails.
- **G4. A pasted fine-grained token** that cannot list or create repositories.
- **G5. The `gh` path.** Remove it, or keep it as a fallback?
- **G6. The setup question keys** (`SetupQuestion`): a script answers by key. Which keys stay, which are new?
- **G7. Timing with PR #145.** Both change `setup.ts`.

## Decisions after the gap review

Three sub-agents (two mid-tier, one top-tier) read the code and PR #145.

- **G1.** One request: `GET /user/repos?sort=pushed&per_page=100`, with the default affiliations (owner, collaborator, organization member). A team vault can live in an organization. Skip archived repositories: Eva must push to the vault. One page is enough, because a typed address covers the rest.
- **G2.** The terminal shows "0. Create a new vault" and the 15 repositories pushed most recently. The answer is a number, a name from the whole list (`vault` or `you/vault`), or an address. PR #145's web page has no vault step: it says to run `eva setup`. So the web choice becomes a follow-up issue.
- **G3.** Template first, then create, then push. The template needs no network, so a failed create or push loses nothing. Create with `private: true` and no `auto_init`, so the push of `main` is a fast-forward. `pushNewVault` adds `origin` only when it is missing, and never forces, so a rerun repeats it safely. A name that exists (422) asks for another name.
- **G4.** A list that fails (401, 403) or comes back empty falls back to the address question. A create that fails says: make an empty private repository on github.com, then paste its address. The token stays saved.
- **G5.** Remove `gh` from the vault path, with no fallback. `gh` stays for projects, the doctor and the extra-instance login steps.
- **G6.** No new key. `vaultRepository` takes a number, a name or an address; a script sends an address. `githubRepository` keeps its meaning: the name of the new private repository. Only the tool that makes it changes, so a script with a token no longer needs `gh`.
- **G7.** Build the core now: PR #145 changes no file in `src/core/vault/`. Wire `setup.ts`, `cli.test.ts` and `docs/guide/setup.md` after PR #145 merges, on top of its `askVault`.
- **Requests.** Send `authorization: Bearer`, `accept: application/vnd.github+json`, `x-github-api-version` and a `user-agent`. Never put the token in an error text. Errors use the existing `github_failed` code.
