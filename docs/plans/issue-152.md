# Plan: pick or create the vault repository after the GitHub login (#152)

Delete this file before the merge. The decisions then live in the commits and in the pull request.

## Goal

`eva setup` offers the GitHub login first. Then it lists the person's repositories, and the person picks the vault, or chooses "Create a new vault". A new vault gets a private repository through the GitHub API with the login token, so `gh` is not needed. A typed address, a pasted token and `--non-interactive` work as before.

## Facts from the code

- `askRepository` in `src/frontends/cli/setup.ts` asks for the address first, then offers the login (`askGithubLogin`).
- `offerNewVault` makes the vault from the template, then runs `gh repo create --push` with its own `gh` login.
- `src/core/vault/github-login.ts` gets a token with the `repo` scope. That scope can list the repositories and create a private one.
- `src/core/vault/vault-clone.ts` gives git the token through a credential helper that reads `EVA_GITHUB_TOKEN`. The token never goes into a URL or a config file (lesson 96).
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
6. **Docs:** `docs/guide/setup.md`, *Decide where your notebook lives*.

## Gaps

- **G1. Which repositories to list, and how many.** Owner only, or also organizations and collaborations? Archived ones? A cap?
- **G2. How to show a long list in a terminal** and on a phone-sized web page.
- **G3. Order of create and template.** Create the GitHub repository before or after the local template, and what to do when the push fails.
- **G4. A pasted fine-grained token** that cannot list or create repositories.
- **G5. The `gh` path.** Remove it, or keep it as a fallback?
- **G6. The setup question keys** (`SetupQuestion`): a script answers by key. Which keys stay, which are new?
- **G7. Timing with PR #145.** Both change `setup.ts`.

## Decisions after the gap review

To fill.
