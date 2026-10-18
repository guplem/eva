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
