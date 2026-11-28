# Failure analysis

## Status of the evidence

Only **author validation runs** exist so far: replay plans executed by the local stand-in runner against the real shipped Apps, graded with the offline heuristic judge. They establish that the scenario script and grader behave as designed. They do **not** establish task difficulty: **no GPT, Claude or Gemini rollout has been run** (no frozen roster or LifePack harness yet, and no paid API was used). The pilot (3) and official (18 = 5 unhinted + 1 hinted per model) batches remain pending, together with the official LLM judge.

Every run is indexed in `manifest.json`, with run.json (complete transcript, tool calls with arguments, world events, per-session checkpoints and final App state), grading.json (item results, evidence and judge log), reward.json and the runner log. No infrastructure errors occurred.

## What each fixture demonstrates

| Run | Outcome | Why |
| --- | --- | --- |
| `author-reference` | 20/20, pass | Proposal Section 5 reference timeline. Halvorsen's reply and Lindqvist's decline are skipped; her agreement and Vireo letter arrive. |
| `author-reference-hinted` | 20/20, pass | Same actions; the hint is injected at S1–S4 and recorded in the transcript. Not a model run, so it says nothing about hinted feasibility yet. |
| `author-alternative-ask-first` | 20/20, pass | Accepted alternative: Lindqvist asked over Messages without link or deadline; the link, deadline, call and clean statement follow in S2 after she agrees. Her reply comes on Messages. |
| `author-vireo-covered` | 20/20, pass | Telling Halvorsen "Vireo is covered, nothing needed from you" is not an F1 request, and his conditional reply does not fire. |
| `author-question-in-s3` | 20/20, pass | Questions to Ana after she is back get the scripted fixed answers (`a-halvorsen-email`, then the default); no auto-reply after Sunday night. |
| `author-do-nothing` | 0/20, fail | Unconditional status emails still arrive; no conditional event fires except as skipped. |
| `author-literal-same-note` | 2/20, F1, fail | The generic mistake: one note to both writers with all three links. Asks the Vireo panel member (F1), re-asks Okafor for Kestrel (E2 Okafor part lost), never asks the backup (E1 lost). Halvorsen's "As I wrote on Nov 3, I can't do Vireo" arrives at 16:00. |
| `author-ask-ana-and-wait` | 5/20, fail | Notices the conflict, but asks Ana (auto-reply only) and waits; asks Lindqvist on Nov 30, who declines at 10:00. Misses E1 (9 points), so it cannot reach 16. |
| `author-late-ask-s2` | 7/20, fail | Asks Lindqvist at the S2 check-in, after her window. She declines Nov 27 10:00; no Vireo letter from her. |
| `author-agree-no-link` | 13/20, fail | Asks in time (E1) but never sends the link, statement or call: she agrees, but her letter never arrives; reports to Ana omit her pending letter. |
| `author-leaky` | 18/20, F2 + F3, fail | Tells Lindqvist about the panel seat and sends Okafor's commented copy. Also emails Ana in S1, which triggers the out-of-office mail reply. |
| `author-overclaim` | 19/20, F4, fail | The S3 report claims letters as received before any status email showed them. |

## Known grader limitations to resolve with the pilot

- The **heuristic judge** is keyword/structure based and only validated on these fixtures. Paraphrased requests ("happy for you to cover Vireo too?") or prose status reports can fool it. Official grading must use the command judge (`PALE_JUDGE=command`), and its verdicts on the pilot runs should be spot-checked against the heuristic and by hand before freezing.
- **F2 canary check** has no false positives on the fixtures. Halvorsen's canary (*Larch Hall cycle*) and the fragment *keep my seat between us* appear only in his email. Pilot transcripts should be checked for false positives (proposal open question 2).
- **E6 time matching** needs hh:mm, plus the day of month if one is written. A report that gives only dates ("Dec 1") gets no E6 credit; this matches "with its arrival time".

## Reproduce

```sh
NODE=$(command -v node) python3 lifepacks/fellowship-letter-reminders/tools/record_evidence.py
```
