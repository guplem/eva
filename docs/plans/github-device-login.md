# Plan: GitHub login in the browser, and questions about the person (#47)

This is the working plan for #47. The last commit of the PR deletes it.

## Goal

`eva setup` logs in to GitHub with the device flow, so a new person never makes a token by hand. In the device flow, GitHub shows a short code, and the person confirms it in the browser. A pasted token still works. For a new vault, setup asks a few short questions and writes the answers to `.eva/assistant.md`.

## Steps

1. Add `src/core/vault/github-login.ts`: the device flow against `https://github.com`. It asks for a code, shows the code and the link through a callback, then polls for the token. It honours `slow_down`, `expired_token` and `access_denied`. A base-URL option and a sleep seam let a test use a fake server.
2. In `runSetup`, change the GitHub token question. Enter (or `login`) starts the browser login, a pasted token works as before, and `skip` skips. With a saved token, Enter keeps it. Before the login, one sentence says which access the login gives Eva. The token goes to `secrets.json` at once.
3. A script (`--non-interactive`) never starts the browser login: only `EVA_GITHUB_TOKEN` gives a token.
4. Add the questions for a new vault: what to call the person, their language, and their main topics. Add a `{{topics}}` field to `templates/vault/.eva/assistant.md`. Add `EVA_TOPICS` for a script.
5. Update `docs/guide/setup.md`: the login replaces the fine-grained token steps, and the question table shows the new questions.

## Gaps

1. The device flow needs the client id of a GitHub OAuth App with the device flow on. Whose app, and where does the id live?
2. Which scope does the login ask for, and what is the one sentence about access?
3. What is the exact question text and the default answer, given that Enter keeps a value everywhere else?
4. Which questions describe the person, and how do they fill `.eva/assistant.md`?
5. Where does the code live, and how does a test fake GitHub?

## Decisions

1. **An Eva OAuth App, which the owner registers (#113).** The GitHub CLI's id would make Eva pose as gh. A GitHub App needs an install on each repository, and its tokens expire after 8 hours. A client id is public, so it lives in the code as `githubClientId`. Until #113 sets it, the constant is `null`, and setup asks for a pasted token, as today. Tests use a fake id and a fake server.
2. **Scope `repo`.** An OAuth App cannot give access to one repository only. The token reaches only Eva's own git commands, never an agent (lesson 96, `gitEnvironmentOf` in `src/core/eva.ts`). The sentence names no jargon: "The login lets Eva read and write all your GitHub repositories, private ones too. Eva uses it only to reach GitHub for you, and never gives it to the AI tools that she runs."
3. **Ask for the repository first, then for access.** Project clones use the token too, so a person always gets the question. For an `https://github.com/` address, Enter starts the browser login. With no address, as in a rerun or for a new vault, Enter skips and `login` starts it. With a saved token, Enter keeps it. A pasted token works as before, and `skip` skips, in any case. A failed login asks the question again. An SSH address and other hosts get the token question. A script never starts the login.
4. **Three questions: "What should Eva call you?", the language, and the main topics.** Code turns the topics into bullets under `## Main topics`. No answer writes "None yet.", so the template holds no sample topics. `EVA_TOPICS` answers it in a script.
5. **`src/core/vault/github-login.ts`, with plain `fetch`.** It takes a base URL, a sleep seam and a clock seam, and stops at `expires_in`. A failure is a `github_failed` error. `SetupOptions` gets a `githubLogin` function, or `null` when no client id exists. `src/main.ts` builds it. Tests fake GitHub with `Bun.serve`.

Out of scope: the browser login on the phone (the web settings page), and a GitHub token for `gh repo create`. Setup runs in a terminal today, and `gh repo create` already uses gh's own login.

## Review round 1

Fixed: case-sensitive `skip` and `login`; no token question for a rerun, a new vault or an SSH address; one failed poll ended the login; the last poll before the deadline was lost; a reply that is not JSON read as "could not reach GitHub"; the expiry message said to run setup again; jargon in the access sentence; the guide described a login that is not ready yet.

Not changed:

- "comma-separated" in the topics question: the trusted-owners question already uses it, so one word per concept wins.
- A test that ties the access sentence to the scope: the scope is one constant next to the sentence, with a comment.
- No colon after "What should Eva call you?": a question mark ends a question.

## Review round 2

Fixed: GitHub's message for a wrong client id read as "no answer"; no test proved that a good poll resets the failure count; a github.com SSH address got no browser login for private projects; the docs table said Enter always logs in; the comment about failed polls gave the wrong time; the code message did not say how to stop; the access sentence left out the GitHub check.

Not changed: no test for a login inside the retry loop after a failed clone. The retry calls the same `askRepository`, which the other tests cover.
