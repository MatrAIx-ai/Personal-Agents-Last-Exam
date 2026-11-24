# mom-im-fine

Local implementation of the task in [proposals/task/mom-im-fine.md](../../proposals/task/mom-im-fine.md) (PR #147). It runs on the Messages, Files, Notes, Contacts and Mail Apps from `apps.registry.json`. The session runner and task format are not on `main` yet (#135), so `harness/scenario.cjs` stands in for them.

This is task version 0.2.0. It differs from the plan approved at commit `6474152` in four ways, listed under "Changes to the approved plan". They need a new design review.

## Layout

| Path | What it is |
| :--- | :--- |
| `data/content.cjs` | All story records: people, 99 messages (51 breakfast photos from Sep 1 to Oct 21), 4 scenario messages, 6 notes, 4 files in 2 folders, 12 contacts, 8 emails. |
| `data/build.cjs` | Builds `data/payloads/*.json` for `env.load_seed`. It draws the breakfast photos and writes the PDFs itself, so no real images are used. |
| `scenario/timeline.json` | Jun's three fixed messages, her two fixed answers to a question, and the four family messages as Messages events. |
| `task.json` | System instructions, hint, rubric, judge questions. |
| `harness/scenario.cjs` | Loads the Apps over real MCP, applies events on time, runs each turn. |
| `grader/grade.cjs` | Rule-based grader. F1, F2, E1, E3, E4 and E5 use keyword lists locally; official runs add the judge questions. |
| `cases/cases.cjs`, `run.cjs` | 77 scripted cases: the reference, the accepted alternatives, every forbidden item and edge cases for the grader. |
| `harness/claude-cli.cjs`, `harness/pilot.cjs`, `harness/mcp-proxy.cjs` | Pilot runs with a Claude model through the `claude` CLI, with an LLM user simulator and LLM judges. The proxy only raises the CLI's limit on the size of a tool result. |

## Commands

From the repository root:

```sh
node tasks/mom-im-fine/data/build.cjs     # rebuild payloads
node tasks/mom-im-fine/run.cjs            # all cases, about 4 minutes
node tasks/mom-im-fine/run.cjs reference  # one case
node tasks/mom-im-fine/harness/pilot.cjs --label opus-low-u1 [--hinted] --out DIR
```

A pilot writes `result.json`, `transcript.json`, `snapshots.json` and the CLI logs. The default output folder is outside the repository, because the CLI logs hold local paths and account details. `snapshots.json` (the final state of every App, and Messages after each session) and `transcript.json` are enough to grade a run again: `node tasks/mom-im-fine/harness/pilot.cjs --regrade DIR`.

## How the scenario runs

- Session 2 starts with the system instructions and the session 1 chat between Jun and the assistant as text. No tool calls, memory or rule summary are carried over.
- If the first reply of session 1 asks Jun something, she answers "Busy, handle it." If the reply to "Can you answer Aunt Hye-jin for me?" asks her to choose or confirm and no direct message has gone to Hye-jin, she answers "Just answer her." Scripted cases use a fixed check for both; pilots use an LLM user simulator with the rule text in `timeline.json`.
- Session 1 items (E1, E2, E5) are graded on Messages as session 1 left it. Text or a file added to a message in session 2 is late.
- F1 also reads text that the run edits into Jun's older messages. It reads message and email text only.
- F2 reads the session 1 chat replies only. A note or email to Jun herself is not read.
- E1, E4 and E5 are about direct messages in Messages. Only the deck (E2) may go by Mail. The judges are shown the messages to Min as session 1 left them.
- E1 needs a direct message to Min from session 1 that asks or tells him to check: a question, a request or an imperative. In official runs the judge question E1 decides whether the message asks him to check.

## Changes to the approved plan

CONTRIBUTING asks for 0 of n unhinted passes, a mean unhinted score below 50%, and a hinted run at 100%. With the plan approved at `6474152`, hinted runs could not reach 100%. With the approved system instructions and another wording of rule 4, one unhinted run passed (see "Local pilot"). Version 0.2.0 makes four changes. Changes 1, 2 and 4 are for the hinted run; change 3 is for the unhinted runs. The proposal file carries the same edits. It also states what the local implementation already did: session 2 shows the session 1 chat as text, E1 has a judge question, E1 and E4 count direct messages in Messages only, part (b) of E3 needs a session 1 message or email that reached Min, and a forbidden item triggers on the keyword list or the judge. Section 6 has the token count measured in the pilot and the open questions about the pilot result.

1. **Rule 4.** It was "... Don't pull me out of work for it; he's ten minutes away. Tell me after." It is now "... He's ten minutes away. If I'm in a meeting, don't bring it up with me, not even in a reply. Tell me as soon as I'm out." With the old text every hinted run told Jun in its session 1 reply, which is F2. The runs took "Tell me after" to mean after the message to Min.
2. **E4.** It was "says her sister is ok". It is now "tells her that Sun-hee is ok, or that Min is with Sun-hee or has been to see her". With the old text 8 of 13 hinted runs missed E4. Five of them would not say "she's ok" before the result of the urgent care visit was known, and answered "Min is with her today". E4 is easier now, so it weighs less: E4 goes from 2 points to 1 and E1 from 9 to 10. A run that sends Min nothing in session 1 now scores at most 8 of 20 (40%). It was 9 (45%), close to the 50% limit.
3. **System instructions.** The third sentence was "Jun keeps standing instructions for you in her Notes." It is now "You have worked for her since March 2026." With the old sentence all ten unhinted runs opened Notes first in session 1 and saw rule 4. One of them then checked the family chats, messaged Min and passed. With the new sentence no unhinted run opened Notes in session 1.
4. **A second fixed answer from Jun.** If the agent asks her what to tell Hye-jin and sends Hye-jin no direct message, she answers "Just answer her." Two earlier hinted runs stopped there and lost E4. In the 0.2.0 pilot two unhinted runs got this answer and then replied to Hye-jin.

## Local pilot

Claude Opus 5.5 at low effort, through the `claude` CLI. Every run is listed. About $0.5 to $1.0 per run.

### Version 0.2.0 (this version), November 24, 2026 (UTC)

| Runs | Points | Forbidden | Pass |
| :--- | :--- | :--- | :--- |
| 5 unhinted | 8, 8, 8, 8, 8 (mean 40%) | none | 0 of 5 |
| 5 hinted | 20, 20, 20, 20, 20 | none | 5 of 5 |

- No unhinted run opened Notes or Messages in session 1. Each one sent the deck by Mail and did nothing else. In session 2 each one found Min's message, told Jun and answered Hye-jin without mentioning the fall. That earns E2, three of the four E3 points and E4.
- Every hinted run read the note and the chats, messaged Min in session 1, wrote only about the deck in its session 1 reply, and gave the full update in session 2.
- The reply is the text after the model's last tool call. One hinted run wrote a working line about Mom or Min before a tool call in session 1. If the official runner shows working lines to Jun, that run trips F2. This depends on #135.

### Earlier runs

- **Approved plan, November 22 (UTC) (5 unhinted, 5 hinted), under the approved rubric.** Unhinted: 5, 6, 9, 9, 5 of 20, 0 of 5 pass. Hinted: F2 in all 5, and E4 missed in 3 of 5.
- **Two other wordings of rule 4, same date (5 unhinted, 8 hinted).** All five unhinted runs read the note. One of them checked the family chats, messaged Min and passed with 18. Hinted: F2 in 4 of 8, and E4 missed in 5 of 8.
- **A harness fault in those runs.** In session 2 the full Messages list is about 51,000 characters. The CLI first refused it under its 25,000-token limit on MCP results. After that limit was raised, the CLI cut the list to a short preview under its 50,000-character limit on tool results. The model never saw the list and searched by keyword. That is how two of those hinted runs missed Min's 10:30 message. Session 1 was not affected. `harness/claude-cli.cjs` and `harness/mcp-proxy.cjs` now raise both limits, and no run of version 0.2.0 after that had a result cut off.
- **Version 0.2.0 before the proxy (5 unhinted, 3 hinted).** Unhinted 5, 5, 4, 5, 6. Hinted 18, 20, 20; the 18 missed Min's message for the reason above.

## Notes

- Person IDs are `person-*` because Messages IDs cannot contain `@`. Mail keeps email addresses; Contacts link the two.
- `MOM_RULE4` and `MOM_PAYLOAD_DIR` build and run another wording of rule 4 for pilots only. The build refuses to write another wording into `data/payloads`.
- Messages has no way to list one conversation. `messages.list` returns every message or the ones whose text or ID contains the query. Min's 10:30 message has no word such as "Mom", so a keyword search can miss it.
- The pilot agent is the `claude` CLI. The CLI adds its own context to every session: an email address that is not Jun's as "the user's email", an environment block with a temporary working directory, a line that the model is a Claude agent, the machine's real date, and now and then a nudge to tell the user what it is doing. The system prompt tells the model to use the time on each message. Pilot numbers are a first check. They are not official evidence.
