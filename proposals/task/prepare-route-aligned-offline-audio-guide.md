# Task Track proposal

## 1. Task and domains

- **Authors / GitHub handles (required):** @paralym. AI-assisted retrospective analysis and drafting; author-provided travel experience.
- **Short task title (required):** Keep a personal museum audio walk usable after the phone loses signal
- **Primary domain (required):** Travel & commuting
- **Secondary domains (optional):** Learning & research

## 2. User persona and prior history

**✍️ Your answer (required):** Lin, a fictional Mandarin-speaking traveler visiting with a companion, values interior art and patronage history more than exterior photo stops. Earlier sessions establish a preference for concise spoken explanations followed by optional deeper text, a moderate walking pace, and keeping narration in the order they encounter works. A previous indoor visit lost mobile signal. Lin uses a phone while the agent's tools run on a separate networked workstation. Generating free audio and preparing local files is authorized; paid voice subscriptions, publishing private travel details, or requiring a new account are not.

The history also includes an obsolete itinerary, a completed visit, the current timed-entry ticket, and a correction that reducing fatigue must not silently remove the two important interior spaces. These are discoverable records with dates and statuses, not hidden evaluator preferences. The initial instruction asks the agent to prepare tomorrow's visit so they can understand the important things while walking; it does not explicitly say “build an offline app.”

## 3. Story outline

**✍️ Your answer (required):** Across three sessions over roughly 30 simulated hours, the agent prepares a personalized visit, receives a changed room route before departure, and supports use inside a venue with no phone network. A good outcome is an accessible guide already on the correct phone, with locally playable Mandarin narration and matching text in the current walking order, plus preserved progress and a sensible explanation of any inaccessible work.

1. **Hotel preparation:** Current venue records provide 12 candidate POIs, entry constraints and a simple floorplan. The agent should infer the need to prepare for disconnection from the prior signal-loss episode. It selects core material for Lin's interests, generates short narration using the free-tier speech fixture, and delivers a complete package to the phone. Merely generating files on the workstation is not delivery.
2. **Pre-departure update:** A dated venue notice closes one room and reverses a permitted connection. The old downloadable plan is still available and looks plausible. There is a finite, disclosed Wi-Fi window. The agent updates affected content/order without deleting unrelated completed work, avoids mixing package versions, and verifies installation on the phone before departure. A scripted intermittent TTS failure has a documented retry/local-voice alternative within the time budget.
3. **Inside the venue:** Phone connectivity is disabled. The traveler closes and reopens the guide, chooses the next stop, plays audio, pauses/resumes, and requests the next relevant section through local controls. No cloud model call is presumed possible. On reconnection, progress can sync without restoring the obsolete route.

Alternative delivery formats are valid: a small offline HTML app, an installed guide library package, or an indexed folder with an equally usable ordered player. Grading must not reward a framework or force unnecessary software creation. If a required asset cannot be made available, a timely honest degraded-mode disclosure earns partial credit; claiming a stream will work offline does not.

## 4. What makes this distinct and personal

**✍️ Your answer (required):** The decisive action must happen before the user asks from inside a dead zone. This traveler's earlier signal loss, preference for spoken Mandarin, chosen interiors and walking order determine what to prepare. A generic itinerary, accurate museum essay, or desktop audio demo can all fail at the actual moment of use. Success depends on a person-specific capability being available on the right device throughout a later interval, not on the assistant's final message.

The central distinction is between **created**, **delivered**, and **usable offline**. A shell that caches HTML but streams narration, a package on the author's computer rather than the traveler's phone, or complete audio in an obsolete room order are materially different failure modes. The task also tests whether “make it lighter” preserves the user's core interior visits rather than deleting them.

Related work: [#9](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/9) tests continuity of a network service during a home move; this task accepts loss of network and prepares a personalized local capability instead. [#49](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/49) concerns a multi-week travel commitment; this task concerns anticipatory artifact delivery and in-venue use. Neither is a required runtime dependency.

## 5. Construction plan and effort

**✍️ Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| :--- | :--- | :--- | :--- |
| Persona, history and workspace | 10–14 synthetic history messages, 2 itinerary versions, 1 ticket, 2 venue notices, 12 POI fact records, 1 simple floorplan, and two device profiles | Timestamped source map; every required preference/constraint discoverable; old proposals distinguishable from actual reservations and visits | 2–3 |
| User rollout and scenario script | **Sessions:** 3<br>**Simulated world time span:** 30 hours<br>**Estimated total tokens:** 25k–45k for one complete scenario, including prior context, dialogue, tool outputs and generated narration text; excluding model-private reasoning and binary media | Executable preparation/update/offline-use script; reply and no-reply branches; user does not repeat the offline requirement unless asked; deterministic room-change, TTS and transfer events | 2–3 |
| Environment integration | TrailPocket venue catalog, free-tier speech fixture, package manifests, delivery receipts, isolated phone and network enforcement; task-specific fixture adapter | Resettable package; cold-open and playback probes act on destination bytes, not self-reported readiness; allow equivalent artifact formats | 2–4 |
| Rubrics, reference and hints | Weighted rubric, protected success gates, two valid packaging references, fixed context-pointing hint, and at least 6 negative controls | Reference reaches 100%; doing nothing, URL-only delivery, streamed audio, partial cache, wrong phone and stale route lose appropriate points; exact wording/framework not graded | 3–4 |
| Agent rollouts and analysis | Plan 5 fresh unhinted runs per designated GPT/Claude/Gemini model, plus 1 separate hinted run per model, on the same frozen task/budget | All 18 traces/configurations/costs and per-model scores reported; no cherry-picking; fresh-environment reproduction and failure analysis | 3–5 |

### Proposed outcome checks

The following weights are reviewable design targets, not measured scores:

| Criterion | Points | Evidence |
| :--- | ---: | :--- |
| Preserve current reservations, core interiors and already-completed visits | 15 | Current itinerary and version history |
| Choose source-grounded Mandarin explanations relevant to the user's interests | 20 | Coverage/accuracy rubric against synthetic fact records; no required exact prose |
| Align guide sequence and navigation with the updated walk | 15 | Traversable floorplan edges, room status, POI order |
| Deliver complete local text and narration to the intended phone before disconnection | 25 | Timestamped destination manifest and verified asset bytes |
| Cold-open, navigate and play/resume audio during the offline interval | 20 | Browser/player probes with external requests blocked |
| Communicate readiness/limitations truthfully and respect free-tier/private-use authority | 5 | Receipt status and action trace |

Proposed full-success gates: correct current visit, complete core narration installed before loss of connectivity, successful offline cold-open/playback, and no unauthorized spending or disclosure. Partial failures retain diagnostic points but cannot pass these gates. The evaluator must accept any feasible route respecting required interiors and current access constraints. Semantic content review uses anchored factual criteria and blinded spot checks; device usability is measured by actions, not by an LLM judging a screenshot alone.

A proposed fixed hint says to revisit the user's earlier indoor connectivity experience and check where tomorrow's guide will actually be consumed. It does not provide the route, package manifest, answers or grader internals.

- **Milestones, owners and dependencies (required):** Proposed owner @paralym. M1: freeze persona and observable evidence; M2: implement script on [TrailPocket environment proposal #58](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/58); M3: pass reference and negative controls; M4: freeze version/model roster/budget and run all trials; M5: reproduce on a fresh reset. Task work takes approximately 3–4 calendar weeks after the shared environment and PALE interfaces are ready. The environment is blocking for execution, not for concept review; maintainers may approve an equivalent existing destination-device environment instead.
- **Resources and total effort (required):** 12–19 person-days of task-specific work, excluding the shared environment. Planned batch: 18 runs, roughly 450k–810k scenario tokens before model-specific reasoning overhead. Provisional API budget USD 100–500; confirm after model roster/pricing and a non-qualification harness pilot, with an explicit budget before running. Browser runner and local media storage required; no real TTS API or traveler login at evaluation time. Planned runs are not yet executed and no difficulty threshold is claimed.
- **Scope boundary and open questions (required):** No full-city guide, live visual recognition of arbitrary artworks, navigation inside unmodeled rooms, or cloud assistant available on an offline phone. Voice/audio is required for this persona; text is an additional accessible fallback, not a full substitute. First supported device/browser and acceptable equivalent delivery formats will be agreed with maintainers. We target the ordinary task qualification, not a flagship claim. If models exceed the required threshold, report that outcome and revise only through a disclosed new task version and a complete rerun, not by hiding easy runs or inventing undiscoverable constraints.
- **Data provenance and privacy (required):** Transformed from the author's Italy/Spain travel experience. Reviewed private interactions support the interest in interior visits, moderate pace, route changes and remote device use. The author additionally recalls indoor signal loss around venues such as the Medici Chapels and a custom walking-order guide with narration synthesized through a free voice API. That original app/chat is not currently recovered; its behavior is motivating testimony, not a reproduced artifact or model rollout. The public proposal contains no raw private messages, account details, booking identifiers, exact personal itinerary, or third-party personal information. All executable histories, dates, room layouts, tickets and assets will be synthetic. Narration is original and grounded in licensed/author-created fixture facts; asset licenses will be recorded, with no copied commercial audio guide or cloned identifiable voice.

Follow the repository's [validation protocol](../../CONTRIBUTING.md#task-difficulty-and-validation): at least one unhinted run per designated model (five planned), each model independently 0/n full passes and mean score below 50%, plus a separate hinted run per model reaching 100% and all gates. Evidence follows approval; this document does not assert those outcomes.
