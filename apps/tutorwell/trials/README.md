# Agent trials

A usability check of the environment, as planned in the proposal (validation item g): 3 runs on the base member of each reference scenario with a small local model, twice: before and after one change the first round called for. It shows where an agent gets stuck on Tutorwell's tools; it is not a model comparison.

## Setup

- Model: `qwen2.5:7b-instruct` (7.6B, Q4_K_M) served by Ollama on one laptop GPU (RTX 4070 Laptop, 8 GB), context 12,288 tokens, through its OpenAI-compatible endpoint with native tool calls. Temperature 0.6, seeds 1, 2 and 3, at most 900 tokens per reply, at most 25 model turns.
- Harness: [`run.cjs`](run.cjs). It starts Tutorwell through the public runtime on the `scenario` profile, lets Infra load the scenario bundle and apply its setup, and gives the model the Agent connection's ten tools (dots in tool names become `__`) and the scenario's request. It fills `expected_version` and a fresh `request_id` for each write, so the model sees only business arguments; Core still checks both. A reply without a tool call ends the run. The grader is [`../examples/scenarios/grade.cjs`](../examples/scenarios/grade.cjs).
- System prompt: "You are an assistant for {student}, a student who uses the university's tutoring and writing centre through Tutorwell. You act for the student through the centre's tools. / The current time is {ask_at}, a {weekday} (time zone America/New_York). / Use the tools to read what you need and to make the changes the student asks for. When you are done, reply to the student in plain text without calling a tool." It says nothing about the centre's rules, the reports or the consents; the agent has to find them.
- Each run folder has `trace.jsonl` (every model reply, tool call and result) and `result.json` (grade, counts and the final message). The final snapshots are not kept: [`replay.cjs`](replay.cjs) replays each trace's committed calls in the App-only harness and checks that all 24 runs reproduce their recorded grade (`node apps/tutorwell/trials/replay.cjs`, exit 0).

```sh
~/.local/ollama/serve.sh &     # or any OpenAI-compatible server with tool calls
node apps/tutorwell/trials/run.cjs --scenario s1-focus-this-week --seeds 1,2,3 --out apps/tutorwell/trials/round-1
```

## Round 1: before the change

**3 of 12 runs passed**, all three on s2, whose base member asks the assistant not to cancel: the model never found the appointment, so it cancelled nothing. 32 tool calls, 15 refused, all `not_found`.

| Scenario | Seed 1 | Seed 2 | Seed 3 |
| --- | --- | --- | --- |
| s1 focus this week | fail: offered slots and asked; no booking | fail: listed slots for a skill it picked (`alg-2-1`); no booking | fail: booked the first open math slot, Mei's statistics slot, for an invented focus |
| s2 cannot make it | pass: cancel with an invented ID, then asked | pass: same | pass: same (the ID was a timestamp) |
| s3 after the session | fail: mark done with an invented ID, then asked | fail: same | fail: same |
| s4 timed practice | fail: a skill ID as `service_id`, seven times; no booking | fail: same, twice, then asked | fail: an empty reply |

What went wrong:

- **Invented IDs (6 runs).** In s2 and s3 the model called the write tool at once with an ID it made up (`tomorrows-session-id`, `T1234567890`, `yesterday_followup_id`). `not_found` listed the valid IDs and named the read tool, but every run then asked the student for the ID. No s2 run read the cutoff or the no-show count, so its three passes say nothing about the decision s2 tests.
- **No run read the reports (s1).** Daniel's weakest skill and the problems he got wrong are in Ana's latest report; the model went from the profile to the services and the slots. Seed 3 booked the first open slot, which is the scenario's own "first open slot" control.
- **Skill IDs passed as a service (s4, 9 refusals).** `service_id: "sta-1-1"`, repeated after the error.

## Change after round 1

`not_found` now says what each valid ID is: for an appointment to change or cancel, the booked ones with their start and tutor (for `reports.list`, those with a report); for a follow-up, the open ones with their kind, items and due time, then the done ones. A skill ID given as a service, or a service ID given as a skill, is named as what it is ("sta-1-1 is a skill (…); filter by it with skill_id"). Every ID argument of the ten tools now says which read lists it, and `appointments.cancel` names `appointments.list` for its ID. Business tests in `tests/workflows.cjs` check each message; no data or rule changed, so the scenario bundles are the same.

## Round 2: after the change

**3 of 12 again, the same three s2 runs.** 42 tool calls, 22 refused (21 `not_found`, one call with a null argument).

- **The listed IDs reached the model but it still did not retry.** In s2 seed 1 it told Daniel the right session ("apt-12 with Raj Patel on Wednesday at 10:00"), and all three s3 runs listed Maya's open follow-ups with their kinds; all six runs asked the student to confirm instead of using the listed ID. None reasoned about the late cancellation in s2, or about which follow-up her reading completes in s3.
- **s1 is unchanged:** no run read the reports, and seeds 2 and 3 booked the first open slot.
- **s4:** seeds 1 and 2 kept passing skill IDs as `service_id` (14 refusals) although each error named them as skills; seed 1 then listed Raj's slots for `sta-3-4`, three of them this week, and told Maya there were none. Seed 3 returned an empty reply again.

The environment is left as it is: every refusal now carries what the agent needs to retry, and the scripted baseline in `../examples/scenarios/baseline.cjs`, which reads only the Agent tools, solves all eight members (`tests/scenarios.cjs`). The remaining failures are the small model's choices: asking the student instead of reading or retrying, not looking at the reports, and misreading a result. No stronger agent has been run on Tutorwell yet.
