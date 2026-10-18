---
name: implement-issue
description: Implement a GitHub issue from plan to merged PR, with sub-agents to fill gaps and review the work. Use when asked to implement an issue, given an issue number or description, or with no input to pick the oldest open issue.
---

# Implement an issue

## Pick the issue

- **An issue number:** implement that issue.
- **An issue description:** search for an open issue that matches it. If none exists, create one from the description.
- **No input:** find the oldest open issue that has neither the `waiting-for-human-check` nor the `auto-developing` label.

Once you select the issue, add the `auto-developing` label to it and assign the authenticated user as the assignee. For the PR you create, do the same: add the `auto-developing` label and assign the authenticated user as the assignee.

## Process

Implement the issue by following this process:

1. Read and understand the issue. Try to fully understand its motivation and its place in the overall project so that the implementation aligns with the reporter's goals, the project's goals, and its architecture.

2. Create a plan, identifying any gaps or missing information. To save the plan, create a draft PR for the issue and push the plan as the first commit.

3. For every gap, spawn 3 sub-agents (2 mid-tier like Sonnet, 1 upper-tier like Opus) to reason about whether there is an obvious way to fill it. For example, the global instructions (such as `AGENTS.md`) might explain how to do something, an established pattern might already exist, a past decision might resolve the question, or the same thing might have already been implemented or solved in a similar way that we can use as inspiration. Update the plan with the decisions made.

4. If a relevant gap has no clear solution, stop and ask me. Update the plan with the final decisions.

5. Work through every step of the plan, making a commit for each new feature or module. Develop using red-green TDD. In each commit message, describe what was implemented and why it was implemented this way, if applicable or not immediately obvious. Include references to any relevant issues or discussions.

6. Once everything has been implemented, spawn 5 agents (3 mid-tier like Sonnet, 2 upper-tier like Opus) to critique the implementation, looking for actual errors or clear misalignment with the plan, architecture, or development philosophy.

7. Evaluate every finding and fix those you consider valid and relevant.

8. Spawn a second round of 3 review agents (2 mid-tier like Sonnet, 1 upper-tier like Opus) to critique the implementation again. Give them the list of findings from the previous review round that you disagreed with, explaining why, so they can take that into account and only raise those findings again if they find new evidence or disagree with your reasoning. They should also look for new issues that were not identified in the previous round.

9. Again, evaluate every finding and fix those you consider valid and relevant.

10. At this point, the entire plan should be implemented, and the relevant findings from the review agents should be fixed. Prepare the PR for review. Make sure the PR description clearly explains what was implemented, why it was implemented this way, and the implications of the changes. Include references to any relevant issues or discussions, and mark the PR as "ready for review".

11. Ensure that all CI checks pass and there are no merge conflicts. Fix any failing CI checks related to this PR's changes. If a check fails for unrelated reasons, or the cause is unclear, try rerunning it.

12. Ensure the PR is merged. Remove the `auto-developing` label from the issue and PR once the PR is merged. If the PR is closed without merging, remove the `auto-developing` label from both the issue and PR.
