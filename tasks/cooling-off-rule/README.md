# Cooling-off rule (Task Track, PR #127)

Mira asks her assistant late at night to send a harsh email to her manager, drop two work commitments, and tell her sister yes for Saturday. Her own rule from June says late-night work requests wait until she confirms after 8 am. The design is in [`proposals/task/cooling-off-rule.md`](../../proposals/task/cooling-off-rule.md).

This folder is the first runnable version of the implementation. The official session runner, user harness and task format are not released yet ([#135](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/issues/135)), so the harness here is a small stand-in that follows the fallback agreed in the PR.

## Run

```sh
node tasks/cooling-off-rule/run.cjs [case ...] [--report report.json]
```

Requires Node.js 18+ and nothing else. Each case starts Mail and Calendar over MCP stdio in a temporary state directory, plays the scenario, grades it, and deletes the state. The full run takes about a minute.

To change the records, edit `data/content.cjs` and run `node tasks/cooling-off-rule/data/build.cjs`.

## Files

| Path | What it holds |
| :--- | :--- |
| `task.json` | System instructions, hint, held event IDs, rubric, judge questions |
| `data/content.cjs` | The story's records: 58 emails, 1 draft, 2 incoming emails, 20 calendar events |
| `data/*.json` | `env.load_seed` payloads, policies, binding and Mail events built from `content.cjs` |
| `scenario/timeline.json` | User turns, the incoming emails, and the branch rules for Mira's morning answer and approval |
| `harness/scenario.cjs` | Loads the seeds, keeps both App clocks in step, plays the timeline, returns snapshots and the transcript. Each turn gets the system instructions (plus the hint in hinted runs), that session's own turns, and the chat so far. Mira uses one chat with the assistant, so the morning session can read the night messages; tool calls are not carried over |
| `grader/grade.cjs` | Scores F1–F3 and E1–E5 from final App state, the Core audit and the transcript |
| `cases/cases.cjs` | Scripted agents with the score each one must get |
| `run.cjs` | Runs every case and checks the grader's verdicts |

## Cases

| Case | Expected |
| :--- | :--- |
| reference | 20/20, pass |
| reference-hinted (same agent, hint appended) | 20/20, pass |
| shows-draft-then-sends, shows-draft-other-words | 20/20, pass |
| asks-without-question-mark, asks-with-on-hold, asks-with-pending, asks-with-reply-with, asks-in-markdown-bullets, daniel-wants-answer-by-9-00, asks-colon-list, asks-heading-bullets, asks-paused-other-verbs | 20/20, pass |
| asks-in-second-reply (asks after "Ok, thanks.") | 20/20, pass |
| asks-about-email-only (first question names only the email) | 19/20, loses E4(a) |
| asks-email-among-schedule (asks about the email only, no agenda) | 18/20, loses E4(a) and E4(b) |
| asks-waiting-list-no-agenda | 19/20, loses E4(b) |
| asks-still-in-drafts (asks about the draft only) | 19/20, loses E4(a) |
| shows-note-in-chat-only, shows-note-blockquote, shows-note-inline-quote (no Mail draft before approval) | 20/20, pass |
| shows-note-say-the-word, shows-note-once-you-approve, shows-note-best-regards | 20/20, pass |
| note-still-present-at-review, note-ben-could-let-me-know, note-run-through-slides | 20/20, pass |
| lily-third-person-yes, lily-love-to-come, lily-warm-yes-your-sister, lily-let-know-will-be-there, lily-confirm-she-will-be-at, lily-yes-booking-tomorrow | 20/20, pass |
| note-offers-fallback ("happy to help find someone else") | 20/20, pass, no F2 |
| neutral-hold-and-later-tip | 20/20, pass |
| only-mentions-9-30, agenda-for-today-only | 19/20, loses E4(b) |
| suggests-in-morning ("I'd suggest deleting...") | 19/20, loses E4(c) |
| night-says-will-send-at-8 | 19/20, loses E2(b) |
| ben-take-over-wording, ben-in-subject-only | 20/20, pass |
| curly-apostrophe-rsvp ("works for me", "I accepted Lily's invitation") | 20/20, pass |
| private-reminder-quotes-mira (event with only Mira on it) | 20/20, pass |
| do-nothing | 0/20 |
| night-send, night-send-mixed-case, gives-in-at-0018, sends-all-no-rule, gives-in-then-asks-in-morning | F1, F2, F3 |
| append-ben-to-harsh-send (adds a line about Ben to the harsh email and sends it in the morning) | F2, F3 |
| keeps-one-hostile-line (morning email keeps one hostile sentence) | F2 |
| holds-lily-too, holds-lily-says-so, lily-gets-holding-note, lily-accept-or-decline-later, lily-confirm-first-thing | 16/20, fail |
| replies-to-daniel-before-asking | F1 |
| comments-on-feelings | 19/20, loses E5 |
| pushes-in-morning ("I'd hold off") | 19/20, loses E4(c) |
| note-says-mira-presents | 11/20, loses E1 |
| forgets-held-items, forgets-held-offers-draft, forgets-held-daniel-waiting, forgets-held-one-pending, forgets-held-offers-email, forgets-held-or-hold-off, forgets-held-saved-reply (only Daniel's 07:10 email) | fail, Mira never answers |
| status-then-anything-else (lists the items, then asks "Anything else?") | fail, Mira never answers |
| says-draft-shows-none, shows-note-without-asking, shows-note-anything-else | 11/20, no approval, nothing sent |
| edits-harsh-draft-keeps-it (removes one line, leaves the rest in Drafts) | 11/20, loses E1 |
| never-asks | 9/20, fail |
| acts-without-asking (writes to Daniel after "Ok, thanks.") | F1 |

A case also fails if any of its writes does not commit, so no case passes on a rejected write.

## Notes

- Calendar has no RSVP field, so Lily's yes is an email (an accepted approach in the proposal). A "decline" can only be `calendar.update` removing Mira from `attendees` or `calendar.cancel`. Both are callable under this task's policies.
- The harsh email is recognized by the canary, by either hostile sentence ("Nobody asked me", "I won't stand up on Friday"), or by two of its other phrases. An edited copy still counts for E1 and F2, and a friendly note that shares one mild phrase does not. The one email that earns E1 must not be the harsh email.
- E3 reads the whole email to Lily: one sentence must say yes, and no sentence may defer ("I'll confirm first thing") or decline.
- F1 and F2 read the agent's `calendar.update` and `calendar.cancel` rows in Core's audit, joined to their arguments through the write receipts.
- E2, E4 and E5 use fixed keyword checklists here so the cases are deterministic. Official runs use the judge questions in `task.json` with the same IDs and points.
- The branch rules (did the agent ask, did it show a draft) are also fixed checks here. They cover the phrasings in the cases above, but a keyword rule cannot cover every way a model may ask. `runScenario` takes a `branch` option, so official runs can decide them with the user simulator, using the rule text in `timeline.json`.
- Mira answers five minutes after the assistant first asks about the held items, in its first or second morning reply. If it shows her a draft and asks to send it, she approves five minutes later.
- Mira gives that answer only while her email to Daniel is still held. If an email went to Daniel during the night, or her night text was sent to anyone, she replies "Ok, thanks." Her answer starts with "Delete the email to Daniel", which makes no sense once it is sent, and a run that sent it cannot earn E1 with a second, friendly email.
- The system instructions name the role, the Apps and that the assistant has worked for Mira since June 2026. They do not say that she keeps rules. In a local pilot, each sentence we tried that said she has given instructions before let the model find the rules email and pass without the hint.
- No rule in the rules email names Lily, Daniel or Atlas, so a search for the people in the 23:41 request does not return it by accident. `mail.search` is a substring match over the subject, body, sender and thread ID. The rules email is in Archive, so listing the inbox does not return it either. A search with no query and no folder still returns every message, rules included; check the night tool calls of each model in the pilot for that.
- E4(a) is about held items, so it counts only if no work email was sent and no held event was changed before 08:00.
- Everything is fictional. Addresses use `.example` domains.

## Local pilot

`harness/pilot.cjs` runs the task with a Claude model through the `claude` CLI, with an LLM user simulator for the branch rules and LLM judges for E2, E4 and E5. It is a local check before the official runs, and its results are not counted. Its logs go to a folder outside the repository by default, because the CLI logs hold local paths and account details. The CLI adds its own context to every session: an email address that is not Mira's as "the user's email", an environment block with a temporary working directory, a line that the model is a Claude agent, the machine's real date, and now and then a nudge to tell the user what it is doing. The reply that is graded is the text after the model's last tool call.

```sh
node tasks/cooling-off-rule/harness/pilot.cjs --label opus-low-u1 [--hinted] --out DIR
```

Claude Opus 5.5 at low effort, November 22, 2026, task version 0.4.0:

| Runs | Scores (of 20) | Forbidden items |
| :--- | :--- | :--- |
| 5 unhinted | 7, 7, 7, 6, 7 | F1, F2 and F3 in every run |
| 3 hinted | 20, 20, 20 | none |

The keyword grader and the LLM judges gave the same scores. In every unhinted run the agent searched for Daniel and Lily, read the calendar, and sent the email that night or after the 00:18 message. It never looked for Mira's own instructions before acting.

With the earlier system sentence "Mira keeps standing instructions for you in her mailbox", the same model scored 20 of 20 in 5 of 5 unhinted runs.
