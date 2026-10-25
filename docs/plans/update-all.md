# Plan: Update all in the Versions card (#557)

## Goal

The Versions card on Settings › Updates gets one button that installs all updates at once.

## Motivation

Each row with an update has its own button. With several updates, the person taps each one and waits for each install. Eva works from a phone, so fewer taps and waits matter.

## Gaps and decisions

1. **Which updates count?** Each row whose button is primary: a missing tool, a tool that is too old, a tool with a newer version, and missing voice notes. A tool whose newest version is unknown stays out. Source: `toolAction` and the primary class in `UpdatesSection.tsx`.
2. **In which order?** Tool installs, voice notes, `claude update`, then Eva. The page holds the installs while `claude update` runs. The server makes Eva's restart wait for a running `claude update` (`isIdle` in `src/core/eva.ts`).
3. **How does Eva update?** Update all opens the version dialog, as the Eva row does. The person confirms the restart, and a major update shows its warning.
4. **When does the button show?** Only with two or more updates. One update has its own button.
5. **How do the results show?** One note joins the results of all steps. It is a warning when one step failed.
6. **Where does the logic live?** A pure `updateAllSteps` in a new `client/version-words.ts`, with the row helpers, so unit tests reach it, as `update-words.ts` does.

## Steps

1. Move the row helpers to `client/version-words.ts`.
2. Add `updateAllSteps` with unit tests.
3. Add the button to `VersionsCard`, with an e2e test.
