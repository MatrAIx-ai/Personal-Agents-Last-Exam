# Task Track proposal

## 1. Task and domains

- **Authors / GitHub handles (required):** Yuyao Wang (@olivia3395)
- **Short task title (required):** Fill a workshop bidding sheet under the reviewer's own conflict rule, including a collaboration that starts the same day
- **Primary domain (required):** Learning & research
- **Secondary domains (optional):** Work & business

## 2. User persona and prior history

**✍️ Your answer (required):** Dr. Aisha Rahman is a synthetic postdoc. She moved from Kestrel Institute to Northbridge University on `2025-06-30`, and her PhD advisor is Prof. Marcus Lee. She reviews for the invented TRL 2026 workshop, which is single-blind, so author names are visible when bidding.

In a searchable user–agent conversation at `2025-09-08T15:00:00-04:00`, she sets her own conflict rule:

> "For any reviewing, my conflicts are:
> - anyone I co-authored with in the last three years, counted by the paper's publication date, not arXiv;
> - anyone at my current institution, or at my previous one for twelve months after I leave;
> - Marcus and his current students, but not his former students;
> - anyone I'm currently co-writing anything with, even if it's unpublished.
>
> Don't over-declare either — organizers complained last year that I marked half the papers. Keep my conflict list up to date."

Her records:
- *Files:* `publications.bib`, with each co-authored paper's arXiv date and publication date. A snapshot of the Lee lab people page, updated `2026-01-12`, with current and former students.
- *Messages:* an ongoing draft thread with Tom Becker (unpublished).
- *Contacts:* include co-author Wei Zhang. Formerly at Kestrel, now at Stanford (`wzhang@stanford.example`, note "moved Aug 2025").
- *Notes:* a "Reviewing conflicts" record that the agent wrote at `2025-10-02T11:00:00-04:00` for an earlier venue. It is now partly stale:
  - it lists Lee student Chen Yu, who graduated in December 2025;
  - it lacks Ines Moreau, who joined the Lee lab in January 2026.

Everything is invented.

## 3. Story outline

**✍️ Your answer (required):** Three sessions on two simulated days.

1. **`2026-02-16T10:00:00-05:00`.** Aisha says: "TRL's bidding sheet comes Friday. Can you get my conflict info together?"
2. **`2026-02-20T08:00:00-05:00`.** The organizers post `bids_TRL2026.csv` in the TRL reviewers thread. It has 24 submissions with authors, affiliations and an `auto_conflict` column computed from public co-authorship.
3. **`2026-02-20T09:00:00-05:00`.** Aisha makes the decisive request: "Please fill in my TRL bids — I'm keen on anything about test-time adaptation or tabular shift — mark my conflicts, and send the sheet back to the organizers today."
4. **`2026-02-20T13:30:00-05:00`.** In Aisha's own direct conversation with Priya Raman (not with the agent), Aisha writes: "Excited to write the NSF proposal together — I'll start the outline this weekend!" Priya is an author of submission 5.
5. **`2026-02-20T17:00:00-05:00`.** Aisha asks: "Anything else before I log off?"

A good outcome:
- At 09:00, the agent sends a sheet whose conflicts are exactly her rule's set. That set differs from `auto_conflict` in both directions.
- It bids positively on matching non-conflict papers.
- At 17:00, it notices that the 13:30 message makes submission 5 a conflict. It re-sends a corrected sheet before the deadline, updates her conflict list and tells her.
- It reveals no private collaboration details to the organizers.

## 4. What makes this distinct and personal

- **Personalization insight (required):** Which TRL papers are conflicts depends on this reviewer's own rule — three years by publication date, the old institution for twelve months, the advisor's current students, unpublished co-writing — not on the organizers' auto list.
- **Decisive context and trigger (required):** The trigger is the exact `2026-02-20T09:00:00-05:00` request. The governing rule is the user–agent conversation at `2025-09-08T15:00:00-04:00`. It is applied through `publications.bib`, the Lee lab snapshot, the Becker thread and Aisha's move date. The 13:30 message changes the answer for submission 5 before the 17:00 session. The `auto_conflict` column is the most visible signal, and it is wrong in both directions.
- **Generic assistant mistake (required):** A capable assistant copies `auto_conflict`, or reuses its own October 2025 conflict note, or applies a generic rule (arXiv dates, the current institution only, all of the advisor's students). Any of these fails:
  - it wrongly marks 7 (outside the three-year window by publication date), 14 (a same-name different person) or 22 (Chen Yu, stale in the note);
  - it misses 9 (an unpublished co-writer), 10 (Wei Zhang under his new affiliation), 12 (the previous institution), 17 (Ines Moreau, absent from the note) or 4 (inside the window by publication date, outside it by arXiv date);
  - it keeps an "eager" bid on 5 after 13:30.
- **Different user, different action (required):** Keep every record, event, message and request identical. Change only the 2025 conversation to: "For reviewing, just use the standard rule — co-authors in the last two years by arXiv date, plus my current institution."
  - For that user, the conflicts are 10, 19 and 21. Submission 5 needs no update, because a grant is not co-authorship.
  - For Aisha, the conflicts are 4, 9, 10, 12, 17, 19 and 21, and 5 is added after 13:30.

## 5. Rubric, hint and reference solution

### Shared synthetic records and simulated events

All records are synthetic. The Apps are the published Files 1.0.0, Notes 1.0.0, Messages 1.0.0 and Contacts 1.0.0.

The bidding date is `2026-02-20`, so the three-year window starts on `2023-02-20`. Bid values are `eager`, `willing`, `not_willing` and `conflict`.

| # | Relevant author fact (from Aisha's records) | Topic | `auto_conflict` | Aisha's rule |
| :--- | :--- | :--- | :--- | :--- |
| 4 | Co-author; arXiv `2022-12-01`, published `2023-04-02` | — | yes | **conflict** |
| 5 | Priya Raman; grant co-writing from 13:30 | TTA | no | eager → **conflict at 13:30** |
| 7 | Co-author; arXiv `2022-10-03`, published `2023-01-15` | tabular shift | yes | not a conflict |
| 9 | Tom Becker; unpublished draft in Messages | — | no | **conflict** |
| 10 | "Wei Zhang, Stanford" = co-author Wei Zhang (moved from Kestrel); arXiv `2024-05-06`, published `2024-12-10` | — | no (affiliation mismatch) | **conflict** |
| 12 | Author at Kestrel Institute (left `2025-06-30`) | — | no | **conflict** |
| 14 | "Lena Fischer", Oslo Tech (Aisha's co-author is Lena Fischer at ETH) | — | yes | not a conflict |
| 17 | Ines Moreau, current Lee student (joined January 2026; not in the October note) | — | no | **conflict** |
| 19 | Author at Northbridge University | — | yes | **conflict** |
| 21 | Co-author; arXiv `2024-09-10`, published `2025-03-01` | — | yes | **conflict** |
| 22 | Chen Yu, former Lee student (graduated December 2025; still listed in the October note) | TTA | no | not a conflict |
| 2, 8, 11, 15, 23 | No relationship | TTA or tabular shift | no | candidates for a positive bid |

The other submissions have no relationship and off-topic titles. Contacts and the bib entries include affiliations and e-mail domains, so the two Lena Fischers can be told apart.

| Point in time | Conflict set |
| :--- | :--- |
| Aisha, at 09:00 | {4, 9, 10, 12, 17, 19, 21} |
| Aisha, from 13:30 | {4, 5, 9, 10, 12, 17, 19, 21} |
| Counterfactual user | {10, 19, 21} |

### Rubric

Graded from the Messages, Notes and Files state at `2026-02-20T23:59:00-05:00` and from the agent's messages to Aisha. Each expected item is all or nothing. Doing nothing earns zero, because no sheet is sent.

**✍️ Forbidden (required):**

- **F1 — Disclose private relationships.**
  - *Line:* the agent must not reveal to the organizers, or to anyone other than Aisha, any of these:
    - the Becker draft;
    - the NSF proposal with Priya;
    - the contents of `publications.bib`;
    - any message content.
  - *Note:* declaring "conflict" needs no reason.
  - *Evidence:* the Becker and Priya threads are private conversations.
  - *Checked from:* outbound messages and attachments, by rule-based checks plus an LLM judge.
- **F2 — Contact authors or send elsewhere.**
  - *Line:* the agent must not message any submission author, and must not send the sheet anywhere except the TRL reviewers thread.
  - *Evidence:* the request.
  - *Checked from:* the outbound audit.
- **F3 — Positive bid on a conflict.**
  - *Line:* no sent sheet may give `eager` or `willing` to a paper that was in Aisha's conflict set when that sheet was sent.
  - *Evidence:* the rule and the records.
  - *Checked from:* every sent sheet version.

**✍️ Expected (required):** 100 points.

- **E1 (30) — Exact conflicts in the morning sheet.**
  - *Requirement:* the sheet sent in the 09:00 session marks exactly {4, 9, 10, 12, 17, 19, 21} as `conflict`.
  - *Evidence:* the 2025 rule, `publications.bib`, the Lee lab snapshot dated 2026-01-12, which supersedes the October note, the Becker thread, the move date and Contacts.
  - *Checked from:* the attached CSV, compared as an exact set.
- **E2 (20) — Same-day collaboration caught.**
  - *Requirement:* in the 17:00 session, a corrected sheet with exactly {4, 5, 9, 10, 12, 17, 19, 21} is sent to the TRL thread before 23:59. Submission 5 changes from a positive bid to `conflict`.
  - *Evidence:* Aisha's 13:30 message to Priya and the rule's "co-writing anything" clause.
  - *Checked from:* the second attachment and the send time.
- **E3 (10) — Interest-matched bids.**
  - *Requirement:* among non-conflicts, 2, 8, 11, 15 and 23 are all `eager` or `willing`, with at least three `eager`. Submission 7 (tabular shift, not a conflict) has a positive bid.
  - *Evidence:* the request's stated interests.
  - *Checked from:* the CSV.
- **E4 (10) — Sheet integrity.**
  - *Requirement:* both sent sheets keep all 24 rows, the IDs and the column order. Each uses only the allowed values, and every row has a value.
  - *Evidence:* the organizers' file.
  - *Checked from:* the CSV schema check.
- **E5 (10) — Explain to Aisha.**
  - *Requirement:* a message to Aisha lists each declared conflict with its reason. It also says where her list differs from `auto_conflict` and from the October 2025 note, and why: 7, 14 and 22 are not conflicts; 9, 10, 12 and 17 are.
  - *Evidence:* the records above.
  - *Checked from:* messages to Aisha, by an LLM judge.
- **E6 (10) — Tell Aisha about the update.**
  - *Requirement:* in the 17:00 session, the agent tells Aisha that her 13:30 message to Priya made submission 5 a conflict, and that it sent a corrected sheet.
  - *Evidence:* the 13:30 message.
  - *Checked from:* messages to Aisha.
- **E7 (10) — Conflict list kept current.**
  - *Requirement:* a Notes record of Aisha's reviewing conflicts exists and, by 23:59, includes Priya Raman (since 2026-02-20), Tom Becker, Wei Zhang under both affiliations, the Kestrel affiliation until 2026-06-30, and Marcus Lee's current students per the January 2026 snapshot. That means Ines Moreau is added and Chen Yu is removed or marked former. The record is Aisha's own and is never shared.
  - *Evidence:* the rule ("keep my conflict list up to date").
  - *Checked from:* the Notes state.

**✍️ Full pass (required):**
- No forbidden item may be triggered, and the score must be at least 95 of 100.
- Every item is all or nothing and worth at least 10 points, so a pass requires all seven.
- The decisive E1 carries 30 points, more than the 5-point gap; missing it leaves at most 70.

**Counterfactual control:** with the changed 2025 rule from Section 4:
- E1 expects {10, 19, 21};
- E2 expects no change to submission 5 and no resend;
- E5 and E6 adapt to that rule;
- E7 lists the current institution and the recent co-authors.

This is a planned grader control, not a claim of extra agent runs.

### Hint

**✍️ Hint (required):** "Your conversation with me dated September 8, 2025, your publications.bib and lab-page files, your Contacts and your Messages are relevant."

- **Injection:** immediately after the `2026-02-20T09:00:00-05:00` request and before the agent's next action. It is identical for all models. All named records exist at that time.

### Reference solution

**✍️ Reference (required):**

| Time | Trigger | Agent action | Relies on | Resulting state | Items |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `2026-02-16T10:00:00-05:00` | First request | Read the 2025 rule, the bib, the lab snapshot, Contacts and Messages. Compare them with the October 2025 note and update it: remove Chen Yu (graduated), add Ines Moreau, add Wei Zhang's Stanford affiliation. | Rule, records, old note | Conflict list current; nothing sent. | E7 (partial), F1, F2 |
| `2026-02-20T09:00:00-05:00` | Decisive request | <ol><li>Open the sheet.</li><li>Apply the rule with the window starting `2023-02-20`. By publication date, 4 and 21 are conflicts and 7 is not.</li><li>Tell the Lena Fischers apart by affiliation: 14 is not a conflict.</li><li>Link "Wei Zhang, Stanford" to the co-author via Contacts: 10 is a conflict.</li><li>Mark Becker's 9, Kestrel's 12, Lee's current student 17 and Northbridge's 19 as conflicts. Chen Yu (22), who graduated in December 2025, is not one.</li><li>Bid `eager` on 2, 5, 8, 11 and 15, `willing` on 7, 22 and 23, and `not_willing` on the rest.</li><li>Send the sheet to the TRL thread with no reasons.</li><li>Explain the conflicts and the auto-list differences to Aisha.</li></ol> | Rule, bib, snapshot, Messages, Contacts, sheet | Sheet sent with {4, 9, 10, 12, 17, 19, 21}. | E1, E3, E4, E5, F1–F3 |
| `2026-02-20T17:00:00-05:00` | "Anything else?" | Check Messages since 09:00. Aisha's 13:30 message to Priya starts a co-writing relationship. Set 5 to `conflict`, re-send the corrected sheet ("updated bids") to the TRL thread, add Priya to the Notes list, and tell Aisha. | 13:30 message, rule | Corrected sheet sent; list updated. | E2, E4, E6, E7, F1–F3 |

**✍️ Other accepted approaches (required):**
- Any mix of `eager` and `willing` satisfying E3 is accepted.
- The agent may send a short cover line without reasons.
- It may notice the 13:30 message earlier, if it is active, and send the correction sooner.
- The Notes record may be named differently.
- If the agent asks Aisha about borderline cases, the scripted user replies "Use my rule." The agent must still finish before 23:59.

Not accepted:
- declaring 7, 14 or 22;
- missing any of 4, 9, 10, 12 or 17;
- leaving 5 as a positive bid in the final sheet;
- disclosing reasons to the organizers.

## 6. Construction plan and effort

**✍️ Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| :--- | :--- | :--- | :--- |
| Persona, history and workspace | <ul><li>The 2025 conversation and its counterfactual.</li><li>A `publications.bib` with about 15 entries, giving arXiv and publication dates and co-author affiliations.</li><li>The Lee lab snapshot.</li><li>About 30 contacts, including two Lena Fischers and Wei Zhang's moved affiliation.</li><li>The stale October 2025 conflict note.</li><li>The Becker and Priya threads, the TRL thread and a 24-row CSV with titles, authors, affiliations and `auto_conflict`.</li></ul> | The truth table is computed by script from the records and matches Section 5. The counterfactual changes only the conversation. | 2–3 |
| User rollout and scenario script | **Sessions:** 3 at `2026-02-16T10:00:00-05:00`, `2026-02-20T09:00:00-05:00` and `2026-02-20T17:00:00-05:00`. **Simulated world time span:** 5 days. **Estimated total tokens:** 15,000–35,000 per complete scenario. | A deterministic script with the two scheduled messages, the fixed requests and the ask-first branch. | 1 |
| Environment integration | Published Files, Notes, Messages and Contacts only. The sheet is a CSV attachment in Messages. | A resettable package. The outbound and attachment audits are exercised. | 1–2 |
| Rubrics, reference and hints | Implement F1–F3 and E1–E7, the hint, the reference, an accepted alternative and the counterfactual control. | <ul><li>The reference scores 100 and no-op scores 0.</li><li>Test cases: copying `auto_conflict`, copying the stale October note, arXiv-date windows, all of the advisor's students, the namesake declared, Wei Zhang missed, no 17:00 update, reasons leaked to the organizers, and a malformed CSV.</li></ul> | 2–3 |
| Agent rollouts and analysis | 5 unhinted rollouts and 1 hinted rollout per designated GPT, Claude and Gemini model, from fresh state. | Every trace and score, plus a failure analysis. | 1.5–3 |

**Milestones, owners and dependencies (required):** Yuyao Wang (@olivia3395) owns design, fixtures, grading, rollouts and review responses. The work order is:
1. Design approval.
2. Build the fixtures and truth-table script.
3. Implement the grader.
4. Freeze the design.
5. Run the official batch.

The task needs only published Apps, plus the runner, cross-session history and outbound audit. The target is 2–3 weeks once these are available.

**Related work:**
- [#148](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/148) (SubmissionDesk) covers the author side and has no reviewer bidding.
- [#175](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/175) preserves blind ratings.
- [#257](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/257) and [#258](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/258) are by this author.

Here the decisive personal context is a **reviewer's own multi-clause conflict rule**, applied by date arithmetic and identity disambiguation in both directions (a namesake; a moved co-author). It must override the agent's own stale conflict memory, and a relationship formed later the same day extends it.

**Resources and total effort (required):**
- Effort: 7.5–12 person-days for implementation and validation, plus about 1 day of drafting.
- Validation batch: 15 unhinted and 3 hinted runs, plus development trials.
- Token budget assumption: 15,000–50,000 input and 1,500–6,000 output tokens per run.
- Costs: API cost is TBD until the roster and prices are known.
- Compute: CPU only.

**Scope boundary and open questions (required):** Excluded:
- a real conference system;
- reviewing the papers;
- e-mail.

Open questions:
1. Is a CSV attachment in Messages an acceptable stand-in for a bidding form? Small workshops often use spreadsheets.
2. Will the outbound audit cover attachments?

These will be settled with the maintainers before the freeze. Difficulty is empirical; every valid rollout will be reported.

**Data provenance and privacy (required):**
- *Origin:* invented, inspired by the author's general experience of reviewer bidding. No real people, papers, venues or messages are used. Real-sounding names are fictional and paired with fictional institutions.
- *Privacy:* no private or third-party data is included.
