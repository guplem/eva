# Assistant mode is Eva's own behaviour; Project mode is a transparent wrapper

## Context

Eva serves two kinds of work. Life and knowledge work runs over the vault. Code work runs in a clone of a project repository. The owner wants code work to behave exactly as if the owner opened the clone in Claude Code by hand. The vendor's coding prompt must not shape the assistant.

Source: spike S3 (below); owner decisions of 2026-10-14; lessons 5, 11, 40.

## Decision

|                     | Assistant mode                                                                                            | Project mode                                          |
| ------------------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| **Start folder**    | Vault root                                                                                                | `Projects/<project>/repos/<repo>-<n>/`                |
| **System prompt**   | `claude_code` preset + `append` (Eva's base prompt + `.eva/assistant.md`), `excludeDynamicSections: true` | `claude_code` preset, unchanged                       |
| **Setting sources** | `user`, `project`                                                                                         | `user`, `project`, `local`                            |
| **Skills**          | User skills, vault skills, and the `.eva/` local plugin                                                   | What the harness finds by itself                      |
| **Hooks**           | None: `disableAllHooks: true`                                                                             | The clone's own, after the trust step                 |
| **Permissions**     | `canUseTool`: a local tool runs at once; an action that reaches other people waits for the person         | The clone's own `defaultMode`; asks go to a front end |
| **Commits**         | Eva, automatically (vault sync)                                                                           | The agent, on branches, with pull requests            |

- **Project mode adds nothing of Eva's** to the session. A `CLAUDE.md` in the clone stops `AGENTS.md` loading, exactly as a manual session does.
- **Spike S3** (a real run on 2026-10-14) showed what a Project session loads. With no `CLAUDE.md`, Claude Code walks up past the clone's git root and loads every `AGENTS.md`: vault, project, and clone. With a `CLAUDE.md` anywhere in that chain, it loads no `AGENTS.md`. `.eva/skills/` never appears. So the vault must never hold a `CLAUDE.md`.
- **The assistant can give work to a project.** It opens a Project mode session in a free clone, or a new clone, with the request as the first message. Project mode never works on the rest of the vault.
- **An untrusted clone** (its repository owner is not on the allowlist) runs with `disableAllHooks: true` and no project MCP servers until the person trusts it.
- **The Assistant prompt is byte-identical on every turn** (lesson 40). A missing `.eva/assistant.md` fails the turn (lesson 11).

`append` stays the default for the Assistant prompt until spike S4, an owner check in `docs/owner-todo.md`, compares it with replace.

**Rejected alternatives:**

- **Vault hooks in project sessions too.** Each harness has its own hook system, and Eva's behaviour belongs in her code (ADR 0008).
- **Project mode with Eva's prompt or skills added.** The owner wants project work identical to a manual session.
- **Assistant skills at the vault root.** Root skills reach every project session (lesson 5). `.eva/skills/` sits outside every auto-discovered path and loads only as a plugin in Assistant mode (spike S3).

## Consequences

**Positive:**

- A project behaves the same in Eva and in a manual Claude Code session.
- The assistant keeps its own identity, and the cache survives each autosave.

**Trade-offs and follow-up:**

- Every mode option is an SDK option that a contract test must pin (ADR 0009).
- A project's own hooks run as the owner's OS user, so the trust step must run before the first session in a clone.
