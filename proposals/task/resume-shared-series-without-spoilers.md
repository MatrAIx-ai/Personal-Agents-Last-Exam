# Task Track proposal

Proposed PR title: `[Task Proposal] [Media & entertainment] Resume a shared series from each viewer's actual progress without spoilers`

## 1. Task and domains

- **Authors / GitHub handles (required):** @harris26-G
- **Short task title (required):** Resume a shared series from each viewer's actual progress without spoilers
- **Primary domain (required):** Media & entertainment
- **Secondary domains (optional):** None

## 2. User persona and prior history

**✍️ Your answer (required):** Alex, partner Jo and mother Yun watch a fictional mystery series together. Their standing agreement is to resume where everyone attending has actually watched, give a short useful recap without later revelations, and leave personal viewing profiles unchanged. Alex also watches alone, so the household's most advanced playback record is not the group's progress.

History records distinguish "played," "watched," "fell asleep," and "caught up." A message such as "finished it" must be linked to its thread and episode, not attached to the latest account timestamp. The assistant may read household records, consult episode materials and prepare a shared playback queue. It must not start autoplay or rewrite an individual's progress merely to make the group state agree.

## 3. Story outline

**✍️ Your answer (required):** Four sessions span ten simulated days. Session 1 establishes the agreement and records a joint viewing. Yun leaves episode 5 at 18:00. Jo finishes episode 6 later, and Alex finishes episode 8 alone; unattended autoplay advances the shared account further. A subsequent message says Yun "finished it," but its linked thread identifies a different series. A separate explicit record identifies what Yun has actually completed in the target series.

In session 2, Alex asks: "The three of us are continuing tonight. Give us a quick reminder and get the next bit ready." For the main fixture, Yun has not watched beyond episode 5 at 18:00. The agent must recover the intended series and current participants, reconcile their evidence, write a recap limited to facts revealed by that point, and queue the remainder of episode 5 at the supported boundary. It cannot assume that an episode-level progress number proves completion. Exact scene timestamps and seek behavior are frozen before evaluation.

The available sources include episode transcripts and a whole-season synopsis. The latter contains later identity reveals and tempting explanations of earlier scenes. A factual statement can therefore be true but still violate the audience's knowledge boundary. The recap must provide useful earlier context without importing later explanations, including in its title or in the explanation for choosing a starting point.

In session 3, Yun explicitly confirms she has now completed episode 5 of the target series, while a later-ingested autoplay record still suggests episode 7. The agent should update the shared plan to episode 6 based on attributed viewing evidence and retain each person's separate progress. Session 4 changes the attendees to Alex and Jo only. Their supported common completion is episode 6, so the shared queue should move to episode 7 and the recap can include the newly permitted facts. If an alternate branch leaves Yun's progress genuinely unknown, the agent asks a targeted question and avoids guessing; a no-reply outcome keeps the queue unstarted and the unresolved boundary visible.

## 4. What makes this distinct and personal

**✍️ Your answer (required):** The task combines reconstruction of personal knowledge with control over what the assistant reveals. Taking the minimum of stored episode counters fails because counters may reflect autoplay, partial completion, another viewer or another series. A correct queue alone is insufficient when the recap leaks a future revelation. Conversely, a content-free recap avoids spoilers but fails the user's request for useful context.

Matched controls independently vary the attending viewers and one explicit catch-up statement while keeping the account playback log and final request fixed. The queue position and permissible recap facts must respond to the personal evidence. These variants belong to one task. The primary condition supplies transcripts and metadata, not a video-recognition test.

The nearest reviewed Task, [#3](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/3), changes a reading ranking with the riding party. This proposal evaluates attributed viewing evidence, scene-level resumption and forbidden information in generated text rather than ranking candidate articles. [#20](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/20) covers subscription exit, not viewer progress. The intended distinction must survive a pilot against a simple progress-minimum baseline; if it does not, the task needs revision before implementation review.

## 5. Construction plan and effort

**✍️ Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| :--- | :--- | :--- | :--- |
| Persona, history and workspace | Write an original eight-episode miniature mystery, about 24 scene transcript segments, and a short decoy-series synopsis. Create three viewer profiles, 18 messages and 20 attributed playback events including autoplay and partial progress. Define about 30 factual propositions with first-reveal boundaries. | Coherent fictional story and timestamp map; all knowledge boundaries justified by visible evidence; independent annotation of required recap facts and forbidden later revelations. No existing TV script is reused. | 3–4 |
| User rollout and scenario script | **Sessions:** 4. **Simulated world time span:** 10 days. **Estimated total tokens:** 22k–40k per complete scenario, including history, queried transcripts, tool outputs, dialogue and recaps. | Executable primary, attendee-change and evidence-change branches, plus a bounded ambiguity/no-reply branch. Later-ingested playback events do not silently become evidence of actual viewing. | 1–2 |
| Environment integration | A narrow fixture exposes series/episode/scene lookup, attributed playback history, personal profile reads and a shared queue with an explicit start flag. Use shared Files and message history where compatible. | Snapshot reset covers story sources, individual progress, participants, queue and event cursor. Queue preparation cannot auto-play or mutate personal profiles. No licensed streaming service is required. | 2–3 |
| Rubrics, reference and hints | Proposed 100-point rubric: series/participant attribution 15; actual-progress reconstruction 25; useful spoiler-safe recap 30; correct queue and profile preservation 20; handling later evidence and uncertainty 10. | Gates: no forbidden later fact disclosed in any user-facing text; no unauthorized playback or profile write; correct queue for the resolved branch. Empty recap and no-op fail completion. Branch-aware labels avoid penalizing legitimate clarification. | 3–4 |
| Agent rollouts and analysis | Five fresh-state unhinted and one hinted run per designated GPT, Claude and Gemini model: 18 primary runs. Freeze story, rubric, event script, budget and configuration. Compare with highest-account-progress and minimum-recorded-progress baselines; report controls separately. | All traces and criterion-level scores are submitted. Each designated model must meet official unhinted failure and below-50% mean-score requirements and achieve 100% with the fixed hint. No such results exist yet. | 2–3 |

Two independent readers will validate first-reveal boundaries and recap reference examples before model trials. Queue and profile checks are exact; recap coverage and spoiler detection require proposition-level semantic review, including paraphrases and implications, with disagreements adjudicated. A generic model judge alone is insufficient evidence that all spoilers were detected. The fixed feasibility hint points to attributed viewing evidence, the actual attendee set and first-reveal boundaries, without supplying the correct episode or permitted facts.

- **Milestones, owners and dependencies (required):** Proposed owner: @harris26-G. M0: review task distinction and minimal player-fixture scope. M1: story, viewing history and independent proposition labels. M2: resettable queue fixture, references and negative controls. M3: development pilot; revise or withdraw if simple baselines solve the intended challenge. M4: freeze and run official validation. Expected duration is 3–4 working weeks after platform access and independent reviewers are available.
- **Resources and total effort (required):** 11–16 person-days. The baseline 18 runs imply roughly 396k–720k text tokens, excluding retries, extra diagnostics and separate reasoning charges. API cost is TBD until the designated roster, rates and measured token usage are available. CPU-only fixture and original text assets; no video generation, streaming subscription or dedicated GPU is required.
- **Scope boundary and open questions (required):** One target series, one decoy, three viewers and a fixed scripted timeline. Exclude content recommendation, subscription management, biometric identification and general video comprehension. Confirm whether the shared environment can represent scene positions and a non-playing queue; otherwise review a task-local adapter. Define the accepted adjudication procedure for implied spoilers and the uncertainty branch before freezing the rubric.
- **Data provenance and privacy (required):** All people, accounts, messages, episode transcripts and story events are invented. No copyrighted television dialogue, real viewing history, private messages or third-party personal information is included. The agent can query ordinary transcripts, but private first-reveal labels, allowed/forbidden proposition sets and scoring code remain hidden. This proposal was drafted with AI assistance.

Implementation, grading code and run evidence will be added to this PR after plan approval, following the [contribution guide](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/blob/main/CONTRIBUTING.md).
