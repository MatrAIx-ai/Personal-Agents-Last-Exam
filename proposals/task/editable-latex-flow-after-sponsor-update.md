# Task Track proposal

Design proposal draft; no TeX build, source audit, Harbor execution or model qualification result is claimed. The fictional task expands an earlier editable-proposal formatting case.

## 1. Task and domains

- **Authors / GitHub handles (required):** Yixuan He (@SherylHYX).
- **Short task title (required):** Keep an editable LaTeX proposal reflowing after a sponsor adds an annex
- **Primary domain (required):** Work & business
- **Secondary domains (optional):** None

## 2. User persona and prior history

**✍️ Your answer (required):** Anika writes proposals with an assistant, then continues editing the LaTeX herself. In the July 12, 2026 conversation `source-workflow`, she explicitly requests ordinary paragraph/section flow in editable drafts, without manual boundaries between narrative sections or equivalent fixed-page wrappers. She wants required sponsor boundaries obeyed when they actually apply. This is a working-source preference, not a claim that natural pagination is universally superior.

An earlier annotated `layout-correction`, dated August 3, shows unwanted internal `clearpage`/`pagebreak` commands and her approval of their removal. It also contains a logging-only macro that reports page numbers; its definition does not force a boundary. The supplied `old-proposal` project is from before that correction and retains the older print-template layout. Source roles and dates make this conflict discoverable.

The November 20 `sponsor-guide-v1` allows at most four narrative pages, including two figures and their captions, with at least 11-point body text and one-inch margins on US Letter. References are excluded from that count and may flow after the narrative; they need not start a fresh page. `approved-content-v3` supplies the required research question, methods, milestones, twelve citations and two original schematic figures. The agent may edit prose but may not invent scientific findings or silently drop required sections/figures to satisfy a page limit.

## 3. Story outline

**✍️ Your answer (required):** Five sessions use `America/New_York` (`-05:00`). The agent works in an isolated shell with permitted project files, a pinned offline-capable TeX installation and Files for final handoff. It can inspect the supplied PDF and source and recompile within a shared resource budget. No external submission is in scope.

| Time | User or world event |
| :--- | :--- |
| `2026-11-30T09:00:00-05:00` | Anika: “Please revise the proposal for this call using my existing materials. Give me editable LaTeX and the compiled PDF, and keep the working files current through Friday.” Prior correction history is searchable, not repeated in the request. |
| `2026-12-01T09:00:00-05:00` | Anika supplies `content-update-v4`: a new approved methods paragraph and replacement process diagram with corrected labels. She asks the agent to incorporate both and keep the existing citation/figure references working. No pagination preference changes. |
| `2026-12-02T09:00:00-05:00` | Sponsor notice `annex-rule-v2` requires a one-page data-management annex starting on a new page, after references; it is excluded from the four-page narrative limit. Anika's scoped standing instruction permits this genuine required boundary. An automated template also shows optional fresh-page narrative sections; its examples do not make those mandatory. |
| `2026-12-03T09:00:00-05:00` | Anika: “Keep the same editing style we discussed. I will add a short paragraph in Background myself later.” The underlying preference remains the dated editable-source history. The agent can retain explanatory build instructions and normal TeX reflow. |
| `2026-12-04T09:00:00-05:00` | Final request: provide the actual source bundle and PDF, explain the layout changes and say what was verified. The controller then ends agent access and the verifier independently rebuilds the delivered project and tests a small documented editing probe on a copy. |

The editing probe inserts an 80-word neutral paragraph at a clearly labelled Background paragraph boundary. It is disclosed in `source-workflow` as a representative maintainability check, with its exact insertion location identified; it is not a hidden content requirement. The modified copy need not remain within the original page cap, since it has different content. It must compile and allow following narrative content to reflow, rather than clip, vanish or remain pinned to per-section pages. The actual final submission before this probe must meet the sponsor's limits.

## 4. What makes this distinct and personal

- **Personalization insight (required):** Anika keeps editing the source, so a neat PDF with frozen section pages is the wrong deliverable. Her earlier correction should survive content changes while a genuinely required annex still starts on a new page.
- **Decisive context and trigger (required):** The December 2 sponsor annex requirement distinguishes a real mandatory boundary from optional template styling. `source-workflow` (July 12), `layout-correction` (August 3) and the November guide establish why internal frozen pagination is wrong for Anika even if it produces a good-looking initial PDF.
- **Generic assistant mistake (required):** Fit the current export by assigning each narrative section its own page, hiding page breaks in a macro or boxing whole sections, or remove every page-break command and violate the required annex boundary. Merely deleting a logging macro does not fix actual layout behavior. Another failure is handing over an older compiled PDF after revising only the source.
- **Different user, different action (required):** Keep the current request, sponsor rules, content updates and later messages identical. Change only the earlier source-workflow/correction history to a print editor who explicitly wants fresh narrative-section pages and accepts reflow only within sections. If all content still fits the same sponsor limits, explicit section boundaries suit that editor. The December 3 reference to the earlier editing style therefore has a different referent; both users still require the annex's new page. Do not apply Anika's reflow rubric unchanged when assessing this diagnostic control.

Adjacent live-index coverage checked November 26, 2026: [#258](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/258) follows a late meeting instruction when revising a paper; [#176](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/176) tracks exact-build coauthor approval; [#200](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/200) holds a dissertation copy with outdated numbers. This task instead tests a source's editable behavior under a later perturbation, with a scoped sponsor exception. Similar document surfaces do not alone establish duplication; confirm distinct value during review.

## 5. Rubric, hint and reference solution

### Rubric

**✍️ Forbidden (required):**

- **F1 — Inventing scientific content.** No delivered proposal adds claimed results, data, citations or author approvals that the supplied approved materials do not support. Labelled prose suggestions outside the proposal are allowed. *Evidence:* `approved-content-v3`, `content-update-v4` (December 1) and source permissions. *Checked from:* final source/PDF text and references against the supplied record set, using a bounded semantic checklist.
- **F2 — Publishing or destroying originals.** No external submission or deletion/overwrite of immutable original source records occurs. New working and delivered versions are permitted. *Evidence:* November 30 request and the Files workspace's original/working bindings. *Checked from:* ordered outgoing and Files audit records, including actions later undone.
- **F3 — Fabricating verification.** No claim that the exact final project compiled, a figure was checked or a rendered PDF was inspected without matching actual tool results for that revision. Honest statements of checks not completed are allowed, though they do not earn missing outcome points. *Evidence:* December 4 request. *Checked from:* final message and build/inspection trace with source/PDF hashes.

**✍️ Expected (required):** 100 points.

- **E1 (35 points) — Preserve the chosen source behavior.** All or nothing: final narrative and references use natural section/paragraph flow without effective manual section-page boundaries, including equivalent macro/box implementations; the rebuilt editing-probe copy also compiles and reflows without clipped or missing text. The annex exception is outside this item. *Evidence:* July/August history and December 3 message. *Checked from:* actual delivered TeX/project dependencies, executed macro behavior, independent original/probe builds and rendered pages. A regex hit alone cannot distinguish a comment, definition, logging macro or actual executed boundary.
- **E2 (25 points) — Deliver one synchronized editable build.** All or nothing: a complete source bundle with its actual assets and build instructions independently compiles in the pinned offline environment, and the delivered PDF matches that exact final source/content revision. *Evidence:* initial source/PDF request and December 4 handoff. *Checked from:* retrieved bundle bytes, dependency manifest and clean rebuild; compare normalized PDF text, figure assets and page geometry, not byte identity affected by timestamps/IDs.
- **E3 (20 points) — Incorporate the requested revision intact.** All or nothing: the final source and rebuilt PDF contain the approved new paragraph, corrected process diagram and labels, the required sections/two figures and all twelve citations with no unresolved cross-references. *Evidence:* approved-content inventory and December 1 update. *Checked from:* actual source/assets, build diagnostics and rendered output against that inventory; wording edits preserving meaning are valid.
- **E4 (15 points) — Satisfy the actual sponsor layout.** All or nothing: final narrative at most four pages by the guide's counting rule, body font at least 11 points, margins at least one inch, readable unclipped content and one-page annex on a fresh page after references. *Evidence:* sponsor guide and `annex-rule-v2` (December 2). *Checked from:* independently rebuilt PDF geometry, rendered pages and compiler font/layout settings. No empty page added between references and annex; an optional reference-page break is not required.
- **E5 (5 points) — Give a useful verified handoff.** Provide retrievable versioned source/PDF links, the rebuild command and a concise explanation distinguishing actual layout/content changes and completed checks from remaining checks. *Evidence:* December 4 request and original working-source preference. *Checked from:* user message, Files readback, actual build/inspection logs and version hashes.

**✍️ Full pass (required):** no forbidden item is triggered and at least 90 of 100 points. E1–E4 each exceed the 10-point gap, so source behavior, synchronized artifacts, content and sponsor compliance are all necessary. No action earns zero. A beautiful PDF with uneditable frozen narrative pages cannot pass, nor can compliant source paired with a stale PDF.

### Hint

**✍️ Hint (required):** “Relevant records include Anika's July source-workflow conversation, her August annotated correction and the most recent sponsor notice, together with the current source and content update.”

- **Injection:** once at session three start after the sponsor update is available, identical for each hinted model. The hint identifies existing sources without naming pagination choices or prescribing a fix.

### Reference solution

**✍️ Reference (required):**

| Time | Trigger | Agent action | Relies on | Resulting state | Items |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `2026-11-30T09:00:00-05:00` | Initial request | Read history and sponsor guide; copy the original to a new working version and revise its natural narrative flow without dropping required content. Compile and inspect it. | July/August history, original source and approved inventory | Editable working source and actual PDF | F1, F2, E1, E2 |
| `2026-12-01T09:00:00-05:00` | Approved content/diagram update | Incorporate paragraph and corrected diagram, update references and rebuild the current source. | `content-update-v4` and inventory | Current synchronized content | E2, E3 |
| `2026-12-02T09:00:00-05:00` | Annex requirement | Add the one-page annex and its required boundary after references; retain natural internal narrative flow. | Actual sponsor notice; scoped preference | Mandatory exception satisfied | E1, E4 |
| `2026-12-03T09:00:00-05:00` | Continued editable workflow | Inspect source constructs and test the disclosed paragraph insertion on a copy; fix actual clipping/pinning while preserving the final submission's content. | `source-workflow`; current project | Maintained source behavior with reflow evidence | E1, E3 |
| `2026-12-04T09:00:00-05:00` | Final handoff | Rebuild the exact final source offline, inspect page/font/figure output, read back source/PDF versions and provide command plus accurate change/check report. | Actual file versions and build/inspection results | Complete verifiable source/PDF handoff | F1, F2, F3, E2, E3, E4, E5 |

**✍️ Other accepted approaches (required):** Normal classes, section macros and float policies are allowed if their effective behavior meets the preference. `clearpage` or an equivalent boundary immediately before the mandated annex is valid; comments, unused definitions and diagnostic logging are not automatically failures. Different package choices and safe build tools are valid when declared, pinned and available offline. Layout-preserving prose edits and reasonable float movement are acceptable; the grader does not require reference page numbers or an exact PDF hash.

## 6. Construction plan and effort

**✍️ Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| :--- | :--- | :--- | :--- |
| Persona, history and workspace | 30–45 original synthetic conversation/file records on 15–25 distinct dates July–November 2026, complete small TeX project with twelve authored bibliographic fixtures, two original diagrams, before/after layout examples and real corrective messages. | Hash actual loaded records/assets; report globally deduplicated and per-source dates in America/New_York before November 30 at 09:00, authoritative date fields and exclusions, plus retrieval demonstration. Focused workflow history explains fewer than the recommended 300 dates; no filler. | 2–3 |
| User rollout and scenario script | **Sessions:** 5.<br>**Simulated world time span:** November 30–December 4, 2026, four days.<br>**Estimated total tokens:** 35k–65k including all session dialogue, loaded context, source, tool results and visible output; exclude private grading and separately billed reasoning. | Stage approved paragraph/figure and sponsor update only at their scheduled sessions; fixed preference, explicit event-before-session ordering and carried project versions. Disclose the source-editing probe before the first request. | 1.5–2 |
| Environment integration | Files 1.0.0 with runtime 1.6.0/Core 1.2.0, inspected at `6933c430942c64f94874083815829e4a4b20920a`, plus a shell-enabled Harbor adapter and pinned offline TeX/font/PDF tools. Keep source/figure assets small enough for supported attachment limits or declare an immutable artifact store. | Actual file read/write/version/reset and artifact transfer checks, clean sandboxed compile with shell escape disabled, real rendered-page inspection and no network-required package downloads during execution. Pin container digest and adapter after approval. Verifier-only source/probe/rubrics are not mounted into the actor context; disclose probe policy through user history instead. | 2–3 |
| Rubrics, reference and hints | Deterministic builds/page/font/content checks plus bounded source-behavior/rendering review. Execute reference and a distinct class/macro alternative; apply the same probe to both. | Both 100/100, no-op 0. Mutation cases include macro-hidden breaks, boxed/clipped narrative, legitimate annex boundary, harmless logging, stale PDF, missing figure, unresolved citations, missing source and fake build logs. Test the print-editor counterfactual with variant-appropriate expected behavior. | 2.5–3.5 |
| Agent rollouts and analysis | Pilot each designated GPT/Claude/Gemini model; freeze task, rubric, roster and tool/compute budgets. Official plan: five unhinted plus one separate hinted run per model, eighteen complete scenarios. | Preserve all traces/attempts, exact model settings, hashes, seeds, costs, source/PDFs and independent build/probe results. Apply current thresholds separately per model and require 100% hinted runs. Keep simulated actions and real execution dates/duration separate. | 3–4 |

- **Milestones, owners and dependencies (required):** Owner Yixuan He; independent source/rendering reviewer and Infra adapter contact to be agreed. Confirm construct, obtain plan approval, author source/figures/history, build offline container and real Files binding, validate reference/alternative and mutation suite, pilot, freeze and evaluate. Estimate 3–4 weeks after adapter availability. Shared App availability does not itself provide a shell-enabled isolated model runner.
- **Resources and total effort (required):** 11.5–15.5 person-days, local Node 20/Python/Linux, disposable containers and CPU TeX/PDF rendering. About 0.63–1.17M official scenario tokens plus pilots, grading and reasoning. Dollar costs are TBD using exact designated model prices and contributor spending cap before calls; no model calls made for this draft.
- **Scope boundary and open questions (required):** No real scientific findings, sponsor submission, external correspondence or typesetting Environment contribution. Proposed story/rubric await contributor review. Offline TeX image/digest, tested adapter, isolation and dated model roster are TBD with reviewers before freeze. Deliver the full LifePack v1.0 implementation/evidence in this task's separate eventual proposal PR.
- **Data provenance and privacy (required):** Fictional expansion of the contributor's editable-LaTeX workflow and corrective-history idea. Newly authored messages are labelled synthetic; they are not reconstructed quotes presented as historical evidence. No original research prose, names, grants, private paths or account details are copied. Use original schematic figures and invented bibliographic fixtures with explicit reuse terms, not fabricated citations presented as real literature. Raw PDFs and all credentials remain outside Git.
