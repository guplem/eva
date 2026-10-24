---
name: create-issue
description: Create a clear GitHub issue that an agent can implement later. Use when asked to create, file or open an issue, or when work needs an issue.
---

# Create an issue

An issue says what the person wants. It also shows which parts the person decided and which parts an agent chose, so an implementer and a reviewer can trace each rule to its source.

## Steps

1. **Research first.** Read the related code, docs and issues, so the issue names the real files and behavior. When the request depends on an outside tool or service, read its current documentation. Tell the person what is possible before you ask what they want.
2. **Look for a duplicate.** Search open and closed issues by meaning, not only by the exact words. Prefer to reopen or comment on a matching issue.
3. **Settle the open decisions.** List each choice and each gap that the request leaves open.
   - When the code, the docs or the project goals settle a choice with high confidence, decide it yourself. Do not spend the person's time on it. Write it as an assumption, and name its source, such as a rule in `AGENTS.md` or a pattern in the code.
   - For each choice that is left, interview the person when they are there. See [Interview the person](#interview-the-person).
   - When nobody is there, choose the most likely meaning, and write it as an assumption.
4. **Split the work.** Make one issue for each result that a person can check alone. When an issue must wait for another one, write "Blocked by #N" near its top, and set a GitHub "blocked by" link. When no tool can set the link, tell the person.
5. **Write the title.** Start it with the type, then say the result in plain words:
   - `Bug:` something does not work as it should.
   - `Feature:` a new capability.
   - `Improvement:` a better version of something that exists.
   - `Task:` other work, such as a refactor, a chore or a setup step.
6. **Write the body.** Leave out a section that has nothing in it.
   - Start with one line that sums up the issue.
   - **Context:** what happens now, why it matters, and the related files and issues. Check in the code each file, function and behavior that you name. For a bug, give the steps to reproduce it. Write a suspected cause as a guess, never as a fact.
   - **What the person decided:** only what the person said or confirmed, in their meaning.
   - **Assumptions, written by an agent. Check them:** each choice that you made or inferred. Include each proposal that the person did not reject but did not choose.
   - **Proposed solution:** only when the person proposed one.
   - **Done when:** behavior that a person can see, not implementation steps. Cover each decision and each assumption. Name a front end only when it has the feature.
7. **Add labels.** Add `waiting-for-human-check` when an agent wrote the issue. Add `requires-human-intervention` when only a person can do the next step. Add no other label.
8. **Check the references.** After you create several issues, read each one again. Fix each reference to a wrong issue number.
9. **Review the issues.** Skip this step for a small issue with no open decision. For each issue, start a sub-agent that did not write it. Give it the issue number and each decision, with the answers that led to it. The sub-agent changes nothing. It reports:
   - a decision that is missing, wrong or contradicted;
   - an assumption that the issue shows as a decision of the person;
   - a claim about the code that is not true;
   - a gap that an implementer would hit;
   - a "Done when" item that is missing or that a person cannot see.

   Fix each valid finding. Ask the person about each finding that changes what they want. Then name the assumptions that matter most, so the person checks them first.

## Interview the person

- Ask one question at a time.
- Make each question a concrete case: "X happens. Should Y happen?" Put all the context in the question. The person answers yes, no, maybe or "I do not know", with no special knowledge.
- Choose each question from the earlier answers.
- After "maybe" or "I do not know", do not ask the same question with more detail. Find what the answer depends on, and ask about that.
- Test each rule that you think you found. Ask a new case where the rule predicts the answer. Decide the expected answer before you ask, but do not show it. When the person answers differently, the rule is wrong: find out why.
- Check each important point at least twice, in different ways.
- Answer each question that the person asks before you continue.
- When the person says that a point does not matter, decide it yourself, and write it as an assumption.
- Stop when the answers no longer surprise you. List the rules in plain words, each with the answers that led to it. Ask the person to confirm them before you create the issues.
