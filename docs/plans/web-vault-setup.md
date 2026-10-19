# Plan: pick or create the vault on the web page

Issue: guplem/eva#158.

## Why

The vault step of the web page's progress list only says to run `eva setup`. A person on a phone cannot finish it. Eva must work from a phone, so the step needs its own controls.

## What

1. The core lists the person's GitHub repositories with the saved GitHub token.
2. The core clones a repository that the person picks, or an address that the person types.
3. The core creates a new vault from the template, makes a private GitHub repository, and pushes the vault to it.
4. Each of these saves `vaultPath` in the machine's `config.json` only, as `eva setup` does.
5. The setup state asks for a restart when the saved vault folder differs from the one that Eva started with.
6. The vault step and the vault card show these controls when no vault is in place.

## Gaps and decisions

- **Which token?** The saved `githubToken` from `secrets.json`. `LiveSettings.secrets` holds a token that the page saved since the start, so the list works with no restart.
- **Which folder?** The saved vault folder when it is set and empty, else `<home>/vault`, as `eva setup` does. The page asks no folder question: plug and play.
- **A ready vault:** the core refuses to clone or create when the vault folder holds files (`vault_not_found`, as `cloneVault` does).
- **An address or a name:** a typed `owner/name` becomes `https://github.com/owner/name.git`. Any other text must be an address. Move `isAddress` from the CLI to `src/core/vault/vault-clone.ts`, so both front ends share it.
- **The template answers:** name, language and topics come from the page. The time zone comes from the saved settings, else from the machine.
- **Repository name:** the page asks for it, with `vault` as the default.
- **A failed create or push:** the local vault stays, and `vaultPath` is saved. The step shows done, as in the terminal. The page then offers the push again: a vault with a commit and no remote (`vaultNeedsPush`).
- **Two clicks at once:** the core runs one vault setup at a time, and refuses a second one (`config_invalid`).
- **Restart:** the running Eva reads `vaultPath` at start. `restartNeeded` also turns true when the saved `vaultPath` differs from the start's. The restart callout says "Eva uses the changes after a restart."
- **An empty saved folder** shows the step as missing, so the page offers the clone again.
- **Routes:** `GET /api/vault/repositories`, `POST /api/vault/clone`, `POST /api/vault/create`, `POST /api/vault/push`. The `/api/vault/` prefix already turns off Bun's idle timeout, which a clone needs.
- **GitHub API address:** a new `githubApiBaseUrl` option on `EvaOptions`, so a test points it at a fake server.
