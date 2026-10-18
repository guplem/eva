---
name: create-issue
description: Create a clear GitHub issue that an agent can implement later. Use when asked to create, file or open an issue, or when work needs an issue.
---

# Create an issue

1. **Understand the request.** Read the related code, so the issue names the real files and behavior. When a part is unclear and the person is there, ask. When nobody is there, choose the most likely meaning and write the assumption in the issue.
2. **Look for a duplicate.** Search open and closed issues by meaning, not only by the exact words. Prefer to reopen or comment on a matching issue.
3. **Write the title.** Start it with the type, then say the result in plain words:
   - `Bug:` something does not work as it should.
   - `Feature:` a new capability.
   - `Improvement:` a better version of something that exists.
   - `Task:` other work, such as a refactor, a chore or a setup step.
4. **Write the body:**
   - Start with one line that sums up the issue.
   - Give the context: what happens now, why it matters, and the related files and issues.
   - For a bug, give the steps to reproduce it. Write a suspected cause as a guess, never as a fact.
   - Add a "Proposed solution" only when the person proposed one.
   - End with "Done when": behavior that a person can see, not implementation steps.
5. **Add labels.** Add `waiting-for-human-check` when an agent wrote the issue. Add `requires-human-intervention` when only a person can do the next step. Add no other label.
6. **Link the order.** When an issue must wait for another one, set a GitHub "blocked by" link.
