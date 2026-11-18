---
name: task-proposal
description: Draft, complete or upgrade a Task Track proposal for Personal Agents' Last Exam by interviewing the contributor for the details they tend to leave out. Use this whenever someone wants to turn a story, idea, pasted chat or old proposal into `proposals/task/<slug>.md`, asks for help with the task template, its rubric, hint or reference solution, wants an existing proposal moved to the current template, or wants a proposal checked before opening or updating a PR.
---

# Task proposal

Help a contributor produce a complete Task Track proposal at `proposals/task/<slug>.md`. The contributor knows the story. Your job is to write it down in the template's structure and to ask for what is missing, because the parts people skip (where each fact lives, what must never happen, what the hint may say) are the parts reviewers need most.

## Sources of truth

Read these from the repository before drafting. They change over time, so follow what they say now, not what you remember.

- `proposals/templates/task-proposal.md`: the structure and the instructions for each field.
- `proposals/task/lena-spring-gathering.md`: a worked example showing the expected level of detail.
- `CONTRIBUTING.md`, the Task Track and validation parts: the acceptance rules.

This skill adds a way of working and a checker. It does not add acceptance rules. If this skill and those files disagree, follow the files and tell the contributor.

If the working directory is not a clone of the repository, ask the contributor to work in a clone of their fork. They need one to open the PR anyway.

## How to work

### 1. Take whatever the contributor has

Accept any of these, and ask which one they have if it is not clear:

- **A few sentences describing the story.** The usual starting point.
- **An existing proposal**, as a file path or a PR number. Read the file and treat it as the draft to upgrade.
- **A pasted conversation or an exported file.**
- **A link to a shared chat.** Try to read it. These links often need a login, so if you cannot read it, ask the contributor to paste the text.

Raw material stays out of the repository. A real conversation usually contains other people's names, messages and account details, and the template requires those to be removed. Ask the contributor to remove sensitive details before pasting, write only a fictionalized version into the proposal, and do not save the raw material to a file in the repository. Screenshots are a poor source for the same reason; ask for text.

### 2. Draft first, then ask

Copy the template to `proposals/task/<slug>.md` and fill in everything the material supports. Do not start with a list of questions: a contributor reacts faster to a draft than to an empty form.

- Where you do not know something, write `TBD` followed by what is needed.
- Where you made something up to keep the draft moving (a date, a price, a name), tell the contributor which parts are your proposals. The story is theirs.
- When upgrading an old proposal, keep the author's wording where it fits, move existing content to the field where it now belongs, and leave gaps as `TBD` rather than inventing a rubric they did not design.

Write the proposal in English. Talk to the contributor in the language they use.

### 3. Ask for what is missing, a few questions at a time

Ask at most four questions per round, as a plain numbered list. Give each question a suggested answer, so the contributor can reply "1 yes, 2 use yours, 3 no, it should be…". Say in a few words why a question matters when that is not obvious. Plain numbered text works in every tool; a structured question prompt is fine if your environment has one.

Ask in this order, because later answers depend on earlier ones:

1. **The decisive moment** (Section 4). Everything else is built around it.
2. **The rubric**: what must never happen, what a good outcome achieves, and where each fact can be found.
3. **The hint and the reference solution.**
4. **The construction plan.** Propose the estimates yourself and ask the contributor to correct them.

`references/section-guide.md` lists, for each section, what a good answer looks like, the gaps that are common in submitted proposals and questions that close them. Read it before the first round.

Update the file after each round, so progress lives in the proposal and not in the conversation. The contributor can stop at any point and continue later from the file. Stop asking when the checker passes and the remaining `TBD`s each say how they will be resolved; a proposal may be submitted with those.

### 4. Check

Run the checker from this skill's folder:

```sh
python3 <this skill's folder>/scripts/check_task_proposal.py proposals/task/<slug>.md
```

It reports errors (must fix) and warnings (confirm or fix). It checks structure against the template, leftover placeholders, domain names, the length of the personalization insight, rubric points and the pass mark, that every rubric item appears in the reference solution, and timestamps. Fix what you can and ask the contributor about the rest.

The checker cannot judge content. After it passes, go through the "Review before handing over" list in `references/section-guide.md` yourself, and report anything that fails.

### 5. Hand over

Tell the contributor:

- where the file is and what is still `TBD`;
- which parts you proposed and they have not confirmed;
- the PR title the checker printed, and that the PR description follows `proposals/templates/pr-summary.md`.

Do not commit, push or open a PR unless the contributor asks. The proposal goes out under their name, so they decide when it is ready.
