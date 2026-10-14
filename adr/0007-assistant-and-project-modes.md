# Assistant mode is Eva's own behaviour; Project mode is a transparent wrapper

## Context

Eva serves two kinds of work. Life and knowledge work runs over the vault. Code work runs in a clone of a project repository. The owner wants code work to behave exactly as if the owner opened the clone in Claude Code by hand (intent item 14). The vendor's coding prompt must not shape the assistant (intent "Vendor system prompts").

Source: plan §1 (D8), §5.1 to §5.5, §12 "Project trust"; spike S3; owner answers 4 and 5 (`docs/review-2026-10-14.md`).

## Decision

|                     | Assistant mode                                                                                            | Project mode                                          |
| ------------------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| **Start folder**    | Vault root                                                                                                | `Projects/<project>/repos/<repo>-<n>/`                |
| **System prompt**   | `claude_code` preset + `append` (Eva's base prompt + `.eva/assistant.md`), `excludeDynamicSections: true` | `claude_code` preset, unchanged                       |
| **Setting sources** | `user`, `project`                                                                                         | `user`, `project`, `local`                            |
| **Skills**          | User skills, vault skills, and the `.eva/` local plugin                                                   | What the harness finds by itself                      |
| **Hooks**           | None: `disableAllHooks: true`                                                                             | The clone's own, after the trust step                 |
| **Permissions**     | `bypassPermissions`, with deny rules and the approval gate                                                | The clone's own `defaultMode`; asks go to a front end |
| **Commits**         | Eva, automatically (vault sync)                                                                           | The agent, on branches, with pull requests            |

- **Project mode adds nothing of Eva's** to the session. A `CLAUDE.md` in the clone stops `AGENTS.md` loading, exactly as a manual session does (spike S3).
- **The assistant can give work to a project.** It opens a Project mode session in a free clone, or a new clone, with the request as the first message. Project mode never works on the rest of the vault.
- **An untrusted clone** (its repository owner is not on the allowlist) runs with `disableAllHooks: true` and no project MCP servers until the person trusts it.
- **The Assistant prompt is byte-identical on every turn** (lesson 40). A missing `.eva/assistant.md` fails the turn (lesson 11).

The modes are planned for phase P3. Spike S4 decides between `append` and replace for the Assistant prompt before P4.

**Rejected alternatives:**

- **Vault hooks in project sessions too.** Each harness has its own hook system, and Eva's behaviour belongs in her code (owner answer 4, ADR 0008).
- **Project mode with Eva's prompt or skills added.** The owner wants project work identical to a manual session (owner answer 5).
- **Assistant skills at the vault root.** Root skills reach every project session (lesson 5). `.eva/skills/` sits outside every auto-discovered path and loads only as a plugin in Assistant mode (spike S3).

## Consequences

**Positive:**

- A project behaves the same in Eva and in a manual Claude Code session.
- The assistant keeps its own identity, and the cache survives each autosave.

**Trade-offs and follow-up:**

- Every mode option is an SDK option that a contract test must pin (ADR 0009).
- A project's own hooks run as the owner's OS user, so the trust step must run before the first session in a clone.
