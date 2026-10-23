# Plan: forks as one path, with a branch switcher and a branch map

Issue: #456.

## Motivation

The web chat shows each fork as a column that starts at the top of the page. A fork stores only its own turns, so its text floats far above the answer that it continues. On a phone, the columns do not fit. "Eva works from a phone" is a project goal.

The design canvas chose option B for a phone and option C for a computer.

## The model

- A fork (`parentId`, `forkAtMessageId`) continues its parent after one answer. A fork with no `forkAtMessageId` (Retry of the first answer) starts from the beginning, with no shared turns.
- The **path** of a session is its shared turns, then its own turns. The shared turns are the path of the parent up to and including the answer of `forkAtMessageId`.
- The page shows the path of one session, the **shown branch**. Only the shown branch has a composer.
- A **fork point** is an answer that has a fork. The branches after it are its own session (which continues) and each fork at that answer. The start of the chat is a fork point when a fork has no `forkAtMessageId`.
- The names: the first chat is "Main line". Each fork is "Fork N", in the order of `chatTree`.

## Parts

1. `client/branch-path.ts`, pure functions with unit tests:
   - `pathOf(session, sessions)`: the turns of the path, each with its session and index.
   - `branchesAfter(...)`: the branches after a fork point, and the one that the path takes.
   - `branchNames(tree)`: "Main line", "Fork 1", ...
   - `firstShownBranch(tree)`: the session with the newest activity.
   - `branchMap(tree, shownId)`: the rows and lanes of the map. One row for each turn, one lane for each session, rows in `chatTree` order. A fork with no turns gets one row, so it can be picked.
2. `client/Branches.tsx`: `useShownBranch`, `BranchSwitcher`, `BranchMap` and `BranchesButton` (the phone button and its bottom sheet).
3. `Conversation.tsx`: one column with the path of the shown branch, a switcher after each fork point, and the map column at the left when the chat has a fork.
4. `AssistantView.tsx` and `ProjectView.tsx`: hold the shown branch with `useShownBranch`, and give the phone button to the header in `extra`.
5. `conversation.css`: the switcher, the map and the column layout. The map column hides at the phone breakpoint (760 px).

## Gaps and decisions

- **Where does the map live on a computer?** The person chose its own column at the left. It shows only when the chat has a fork.
- **How does a phone reach the map?** The person chose the switcher plus a Branches button in the header that opens a bottom sheet with the same map.
- **Which branch shows first?** The session of the tree with the newest activity (`lastTurnAt`, else `createdAt`). The choice then stays, so an answer in another branch does not move the page.
- **What shows after Fork or Retry?** The new session. The page shows each session that appears in the tree after the page opened it. A fork from another front end also opens, which is rare and harmless.
- **What does a tap on a map row do?** When the turn is on the shown path, the page scrolls to it. Otherwise the page shows that row's branch and scrolls to the turn.
- **Where do the approvals of a hidden branch show?** The switcher and the map mark a branch that waits for an approval or runs a turn, so the person can open it. `ApprovalRequests` still shows the requests of the shown branch only.
- **The old `branch-title` pill** ("Branch after answer N of …") goes. The switcher says the same at the fork point.
- **Icons.** `back` is the previous arrow. A new `next` icon is the next arrow.
- **Stored or sent names.** None change. The change is in the web client only.
