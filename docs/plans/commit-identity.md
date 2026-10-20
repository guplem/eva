# Plan: each Eva signs her commits with her own name and email

Issue: https://github.com/guplem/eva/issues/222

## Why

Each Eva keeps her own identity (AGENTS.md, "Instances share programs, never identity").
Her commit name and email still come from the computer user's global git settings.
Two people who share a computer then sign each other's commits.

## What changes

1. **Read the account once, at the GitHub login.** After Eva saves a GitHub token, she asks
   `GET /user` for the account's `id`, `login` and `name`. She keeps the result in the instance.
   The email is GitHub's private address, `<id>+<login>@users.noreply.github.com`.
   The name is the account's name, or the login when the account has no name.
2. **One function gives the commit identity** of an instance: the person's own name and email
   first, then the GitHub account, then none.
3. **The agents' git** gets a `[user]` section after the include in `engines/git/gitconfig`.
   The include still gives the rest of the global settings, such as aliases.
4. **Eva's own vault git** gets the same identity in `gitEnvironment` and
   `gitEnvironmentWithToken`, so every `VaultSync` gets it.
   With no identity, `VaultSync` keeps its fallback `Eva <eva@localhost>`.
5. **Docs:** change only the commit identity sentence in `docs/guide/setup.md`,
   _More than one Eva on a computer_.

## Gaps

- **G1. Where the person sets another name or email.** A setting in the vault (person
  settings), or in the machine's `config.json`? Which key names?
- **G2. Where the account record lives.** A state file in the home, a field in `config.json`,
  or in `secrets.json`?
- **G3. Existing installs.** An Eva that has a token from before this change has no record.
  Does she read the account once at start when the record is missing, or only at the next login?
- **G4. How the vault git gets the identity.** `GIT_AUTHOR_*`/`GIT_COMMITTER_*` variables, or
  `GIT_CONFIG_COUNT` pairs? Either wins over the vault's own `user.name`.
- **G5. Which logins write the record.** The setup browser login, a pasted token in setup,
  and the token on the web settings page.

## Decisions

Three research agents looked at each gap.

- **G1.** The machine's `config.json`, under `git.name` and `git.email`, both null by default.
  Not in `sharedSettingKeys`. Reason: AGENTS.md says each Eva keeps her commit identity in
  her own folder, and the account record is per machine too, so one value has one home.
  Each key wins on its own: a set name with no email keeps the account's email.
- **G2.** A state file, `state/github-account.json`, with `id`, `login` and `name`.
  `HomePaths.githubAccount` names it. Not `secrets.json`: these are no secrets.
  Not `config.json`: the person does not edit it.
- **G3.** No API call at start (the owner's note). The record is filled at each token save,
  at each `eva setup` that keeps a saved token, and by the GitHub check of the settings page
  when the record is missing. All three reach the phone or need setup anyway.
- **G4.** `GIT_AUTHOR_*` and `GIT_COMMITTER_*` variables, as the `evaIdentity` fallback in
  `VaultSync` already does. With them set, its `git var GIT_COMMITTER_IDENT` probe passes, so
  the fallback applies only when no identity exists. `vault-template.ts` stays as it is.
- **G5.** Every `githubToken` save: `eva setup` once for each token, before a new vault's
  first commit, and `Eva.saveSecret` of the web page, which waits for the read (10 seconds at
  most), so a quick restart keeps it. A removed token deletes the record. A new token drops the
  old record before the read, so a failed read never signs with the old account (review).

The identity applies at the next start, as each token change does today.
