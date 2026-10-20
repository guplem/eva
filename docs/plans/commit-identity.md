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

(Filled in after the gap research.)
