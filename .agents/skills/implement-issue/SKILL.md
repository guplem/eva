---
name: implement-issue
description: Implement a GitHub issue from plan to merged PR, with sub-agents to fill gaps and review the work. Use when asked to implement an issue, given an issue number or description, or with no input to pick the oldest open issue.
---

# Implement an issue

## Pick the issue

- **An issue number or link:** implement that issue. If the link points to another repository, work in that repository.
- **An issue description:** find the open issue that matches it. If none exists, create one with the `create-issue` skill.
- **No input:** take the oldest open issue that has none of the labels `waiting-for-human-check`, `auto-developing` and `requires-human-intervention`.

Add the `auto-developing` label to the issue, and assign yourself. Do the same for the PR when you open it.

## Steps

1. **Understand the motivation.** Find why the reporter wants the change, and where it fits in the project goals and the architecture.
2. **Write a plan** in `docs/plans/<name>.md`. List each gap: a missing fact or an open decision. Push the plan as the first commit of a draft PR.
3. **Fill the gaps.** For each gap, start 3 sub-agents (2 mid-tier, 1 top-tier). Each looks for an obvious answer: a rule in `AGENTS.md`, a pattern in the code, a past decision, or a similar solved case. Write the decisions in the plan.
4. **Stop and ask the person** when a gap that matters has no clear answer. Write the answer in the plan.
5. **Implement the plan** with red-green TDD. Make one commit for each feature or module. Follow the `write-commit` skill.
6. **Review the work.** Start 5 sub-agents (3 mid-tier, 2 top-tier). Each looks for real errors, or for a clear mismatch with the plan, the architecture or the project rules. Fix each finding that is valid.
7. **Review again.** Start 3 new sub-agents (2 mid-tier, 1 top-tier). Give them the findings that you rejected, with your reasons. They raise a rejected finding again only with new evidence. They also look for new problems. Fix each finding that is valid.
8. **Prepare the PR.** Delete the plan file: the branch history keeps it. Write what changed, why, and the effects, with links to the related issues. Mark the PR as ready for review.
9. **Show the change to the user interface.** Do this step when the PR changes what a screen shows, and a reviewer wants to see it: a new page, a new layout or a redesign. Skip it for a small fix, a text change, or a change that nobody can see. The section [Before and after captures](#before-and-after-captures) gives the steps.
10. **Merge the PR.** Turn on auto-merge. When the PR does not merge, find the cause and fix it: update a branch that is behind `main`, resolve a conflict, or fix a red check. Run a check again only when it fails for a cause outside this PR. Never bypass the merge ruleset, for example with an admin merge.
11. **Clean up.** Remove the `auto-developing` label from the issue and the PR when the PR merges or closes.

## Before and after captures

GitHub cannot attach a file to a PR description through its API. So the images go to a branch of their own, and the description links to them.

1. **Find how this repository captures its screens.** An `AGENTS.md` file can name a capture script and a demo with example data. If none exists, run the app with example data, and take the captures with the browser test tool of the repository, such as Playwright.
2. **Take the "before" captures** from `origin/main`. Make a worktree of it in `.claude/worktrees/`, and run the app there. Capture each screen that the PR changes, on a computer and on a phone, and in each theme that the app has.
3. **Take the "after" captures** in the same way from the PR branch. Add each new screen.
4. **Capture only example data.** Never capture a person's real data or a secret: the images can go to a public repository.
5. **Push the images** to a new branch, `<pr-branch>-captures`, made from `origin/main`. Put them in `docs/screenshots/pr-<N>/`.
6. **Open a PR from that branch**, with "(not for merging)" at the end of its title. Close it at once. Never merge it.
7. **Link each image by its commit:** `https://github.com/<owner>/<repo>/blob/<sha>/docs/screenshots/pr-<N>/<file>.png?raw=true`. A closed PR keeps its commits, so the links keep working.
8. **Add a "Before and after" section** to the PR description. Use a table with a Before column and an After column. Give a computer image `width="420"` and a phone image `width="200"`. Say which commit each side shows.
9. **Take the captures again** when a merge of `main` changes the screens a lot.
