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

0. **Create the issue branch.** Name it `<issue-number>-<short-name>`, such as `42-fix-login`. Create it from the default branch, and switch to it. Keep the current branch only when it already is the branch of this issue. The default branch and a generic branch, such as one that a tool named, are not.
1. **Understand the motivation.** Find why the reporter wants the change, and where it fits in the project goals and the architecture.
2. **Write a plan** in `docs/plans/<name>.md`. List each gap: a missing fact or an open decision. Push the plan as the first commit of a draft PR.
3. **Fill the gaps.** For each gap, start 3 sub-agents (2 mid-tier, 1 top-tier). Each looks for an obvious answer: a rule in `AGENTS.md`, a pattern in the code, a past decision, or a similar solved case. Write the decisions in the plan.
4. **Stop and ask the person** when a gap that matters has no clear answer. Write the answer in the plan.
5. **Implement the plan** with red-green TDD. Make one commit for each feature or module. Follow the `write-commit` skill.
6. **Review the work.** Start 5 sub-agents (3 mid-tier, 2 top-tier). Each looks for real errors, or for a clear mismatch with the plan, the architecture or the project rules. Fix each finding that is valid.
7. **Review again.** Start 3 new sub-agents (2 mid-tier, 1 top-tier). Give them the findings that you rejected, with your reasons. They raise a rejected finding again only with new evidence. They also look for new problems. Fix each finding that is valid.
8. **Prepare the PR.** Delete the plan file: the branch history keeps it. Run every check that CI runs, such as `bun run check` in Eva, and fix each failure. Write what changed, why, and the effects, with links to the related issues. Add the `waiting-for-human-check` label to the PR. Mark the PR as ready for review.
9. **Show the change to the user interface.** Do this step when a capture of a screen on `origin/main` and a capture on the PR branch would look different: the PR adds or removes a screen, or changes its layout, its style or its parts. Skip it when no screen looks different, such as a change to logic, tests or docs. Skip it also for a change of a few words. The section [Before and after captures](#before-and-after-captures) gives the steps.
10. **Turn on auto-merge.** Update a branch that is behind `main` once, so the checks run on the newest code. Then turn on auto-merge. Do not update the branch again when other PRs merge. Never bypass the merge ruleset, for example with an admin merge.
11. **Watch the PR until it merges or closes.** Do not end your work while the PR is open and has a problem that you can fix. Wait for the checks to finish, for example with `gh pr checks <number> --watch`. Then look at the whole PR:
    - **A red check:** find the cause in the log. Fix it, push, and watch again. Run a check again only when it fails for a cause outside this PR, and only once.
    - **A merge conflict:** merge the default branch into the PR branch, resolve the conflict, push, and watch again.
    - **A review comment:** fix a small, clear request and push. Ask the person about a large or unclear one.
    - **Green, but not merged:** the PR waits for a human approval. Tell the person once, then stop. Their approval merges it.

    If you cannot stay until the checks finish, tell the person which checks are still running.

12. **Clean up.** Remove the `auto-developing` label from the issue and the PR when the PR merges or closes. When the PR waits for a human, remove the label before you stop: you no longer work on it.

## Before and after captures

- Capture each changed screen on `origin/main` and on the PR branch. If the repository has a way to take captures, use it. Capture only example data, never a person's real data.
- GitHub cannot attach a file to a PR description through its API. So push the images to a new branch, `<issue-branch>-captures`, such as `42-fix-login-captures`. Open a PR from it, and close that PR at once. Never merge it.
- Link each image by its commit: `https://github.com/<owner>/<repo>/blob/<sha>/<path>?raw=true`. A closed PR keeps its commits, so the links keep working.
- Show the images in a "Before and after" table in the PR description.
