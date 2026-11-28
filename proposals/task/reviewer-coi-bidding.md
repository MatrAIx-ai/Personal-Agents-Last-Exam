# Task Track proposal

## 1. Task and domains

- **Authors / GitHub handles (required):** Yuyao Wang (@olivia3395)
- **Short task title (required):** Fill a workshop bidding sheet under the reviewer's own conflict rule, including a collaboration that starts the same day
- **Primary domain (required):** Learning & research
- **Secondary domains (optional):** Work & business

## 2. User persona and prior history

**✍️ Your answer (required):** Dr. Aisha Rahman is a synthetic postdoc. She moved from Kestrel Institute to Northbridge University on `2025-06-30`, and her PhD advisor is Prof. Marcus Lee. She reviews for the invented TRL 2026 workshop, which is single-blind, so author names are visible when bidding.

Her rule is in a user–agent conversation at `2025-09-08T15:00:00-04:00`. The conversation opens with an everyday request she makes often ("Remind me to call Mom on Sunday."). Then she adds, in her own words and without the word "conflict":

> "For any reviewing, these are the people I shouldn't be assigned:
> - anyone I co-authored with in the last three years, counted by the paper's publication date, not arXiv, but the big consortium papers with more than ten authors don't count;
> - anyone at my current institution, or at my previous one for twelve months after I leave;
> - Marcus and his current students, but not his former students;
> - and anyone I'm currently co-writing anything with, even if it's unpublished.
>
> Don't over-declare either — organizers complained last year that I marked half the papers. Keep my list up to date."

Her records:
- *Files:* `publications.bib`, with each paper's arXiv date, publication date and co-author affiliations. It includes a 14-author community benchmark paper (OpenShift-Bench, published 2024) with Yuki Sato. A snapshot of the Lee lab people page, updated `2026-01-12`, with current and former students.
- *Messages:* an ongoing draft thread with Tom Becker (unpublished), and a thread with Priya Raman from a 2025 seminar.
- *Contacts:* include co-author Wei Zhang. He was at Kestrel and is now at Stanford (`wzhang@stanford.example`, note "moved Aug 2025").
- *Notes:* a "Reviewing conflicts" record that the agent wrote at `2025-10-02T11:00:00-04:00` for an earlier venue. It is now partly stale:
  - it lists Sofia Marin, whose only joint paper has since left the three-year window;
  - it lists Yuki Sato, who should not have been listed, because of the consortium exception;
  - it lists Lee student Chen Yu, who graduated in December 2025;
  - it lacks Ines Moreau, who joined the Lee lab in January 2026.

Everything is invented.

**Planned history depth:** about 475 user–agent conversations on about 225 distinct dates, from `2025-06-30`. The sources are:
- the 2025 rule conversation;
- everyday conversations, many of which use the words "conflict" (calendar conflicts), "review", "co-author", "co-writing", "arXiv", "publication date", "Marcus", "students", "institution" and "consortium" in unrelated ways;
- the bib entries' dates, the lab snapshot, the contact notes, the Becker and Priya threads, and the October note.

The depth is deliberate. The rule uses Aisha's own words, not the request's "conflicts". It sits mid-conversation behind an opener that recurs throughout the history. Conversation search returns the most recent matches first. So the agent must look for the user's standing reviewing preferences; it cannot find them by searching for the request's keywords. Dates are counted in `America/New_York`. Each source's authoritative date field (publication date, message time, note time, snapshot date) is normalized to a calendar date, and only records before the first-session cutoff `2026-02-16T10:00:00-05:00` count. Several records on one date count once. A reproducible count script will be delivered at implementation.

## 3. Story outline

**✍️ Your answer (required):** Three sessions on two simulated days.

1. **`2026-02-16T10:00:00-05:00`.** Aisha says: "TRL's bidding sheet comes Friday. Can you get my conflict info together?"
2. **`2026-02-20T08:00:00-05:00`.** The organizers post `bids_TRL2026.csv` in the TRL reviewers thread, which only Aisha and the organizers can see. It has 24 submissions with authors, affiliations and an `auto_conflict` column computed from public co-authorship and affiliation data.
3. **`2026-02-20T09:00:00-05:00`.** Aisha makes the decisive request: "Please fill in my TRL bids — I'm keen on anything about test-time adaptation or tabular shift — mark my conflicts, and send the sheet back to the organizers today. And tell me where my conflicts differ from their auto column and from the list you kept in October, and why."
4. **`2026-02-20T13:30:00-05:00`.** In Aisha's own direct conversation with Priya Raman (not with the agent), Priya asks at 13:12 whether Aisha will co-write an NSF proposal, and Aisha replies at 13:30: "Excited to write the NSF proposal together — I'll start the outline this weekend!" Priya is an author of submission 5.
5. **`2026-02-20T17:00:00-05:00`.** Aisha asks: "Anything else before I log off?"

A good outcome:
- At 09:00, the agent sends a sheet whose conflicts are exactly her rule's set. That set differs from `auto_conflict` in both directions.
- It bids positively on matching non-conflict papers.
- At 17:00, it notices that the 13:30 message makes submission 5 a conflict. It re-sends a corrected sheet before the deadline, updates her conflict list and tells her.
- It reveals no private collaboration details to the organizers.

## 4. What makes this distinct and personal

- **Personalization insight (required):** Which TRL papers are conflicts depends on this reviewer's own rule — three years by publication date, no consortium papers, the old institution for twelve months, the advisor's current students only, unpublished co-writing — not on the organizers' auto list or a generic convention. The consortium exception in particular cannot be inferred from the records or from common sense.
- **Decisive context and trigger (required):** The trigger is the exact `2026-02-20T09:00:00-05:00` request. The governing rule is the user–agent conversation at `2025-09-08T15:00:00-04:00`. It is applied through `publications.bib`, the Lee lab snapshot, the Becker thread, Contacts and Aisha's move date. The 13:30 message changes the answer for submission 5 before the 17:00 session. The `auto_conflict` column is the most visible signal, and it is wrong in both directions.
- **Generic assistant mistake (required):** A capable assistant copies `auto_conflict`, or reuses its own October 2025 note, or applies a generic or "safe" rule (arXiv dates, every co-authored paper, the current institution only, all of the advisor's students). Any of these fails:
  - it wrongly marks 16 (a co-author only on the 14-author consortium paper), 7 (outside the three-year window by publication date) or 22 (Chen Yu, stale in the note);
  - it misses 9 (an unpublished co-writer), 10 (Wei Zhang under his new affiliation), 12 (the previous institution), 17 (Ines Moreau, absent from the note) or 4 (inside the window by publication date, outside it by arXiv date);
  - it keeps an "eager" bid on 5 after 13:30.
- **Different user, different action (required):** Keep every record, event, message and request identical. Change only the 2025 rule turn to: "For reviewing, just use the standard rule — co-authors in the last two years by arXiv date, plus my current institution. Keep my conflict list up to date."
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
| 16 | Yuki Sato; only shared paper is the 14-author OpenShift-Bench (arXiv `2023-11-20`, published `2024-07-15`) | — | yes | not a conflict (consortium exception) |
| 17 | Ines Moreau, current Lee student (joined January 2026; not in the October note) | — | no | **conflict** |
| 19 | Author at Northbridge University | — | yes | **conflict** |
| 21 | Co-author; arXiv `2024-09-10`, published `2025-03-01` | TTA | yes | **conflict** |
| 22 | Chen Yu, former Lee student (graduated December 2025; still listed in the October note) | TTA | no | not a conflict |
| 2, 8, 11, 15, 23 | No relationship | TTA or tabular shift | no | candidates for a positive bid |

The other submissions have no relationship to Aisha and are off-topic.

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
  - *Evidence:* the 2025 rule, `publications.bib` (including the author count of OpenShift-Bench), the Lee lab snapshot dated 2026-01-12, which supersedes the October note, the Becker thread, the move date and Contacts.
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
  - *Requirement:* both sent sheets keep all 24 rows, the IDs and the column order. Each changes only the `bid` column, uses only the allowed values, and has a value in every row.
  - *Evidence:* the organizers' file and guidelines.
  - *Checked from:* the CSV schema check.
- **E5 (10) — Explain to Aisha.**
  - *Requirement:* a message to Aisha lists each declared conflict with its reason. It also says where her list differs from `auto_conflict` and from the October 2025 note, and why: 7, 16 and 22 are not conflicts; 9, 10, 12 and 17 are.
  - *Evidence:* the records above, and the 09:00 request, which asks for exactly this comparison.
  - *Checked from:* messages to Aisha, by an LLM judge.
- **E6 (10) — Tell Aisha about the update.**
  - *Requirement:* in the 17:00 session, the agent tells Aisha that her 13:30 message to Priya made submission 5 a conflict, and that it sent a corrected sheet.
  - *Evidence:* the 13:30 message.
  - *Checked from:* messages to Aisha.
- **E7 (10) — Conflict list kept current.**
  - *Requirement:* by 23:59, a Notes record of Aisha's reviewing conflicts must exist and must include:
    - Priya Raman (since 2026-02-20);
    - Tom Becker;
    - Wei Zhang;
    - the Kestrel affiliation until 2026-06-30;
    - Marcus Lee's current students per the January 2026 snapshot, which means Ines Moreau is added.
  - *Must not list as current conflicts:* Chen Yu, Sofia Marin or Yuki Sato. Removed or marked former is accepted.
  - *Privacy:* the record is Aisha's own and is never shared.
  - *Evidence:* the rule ("keep my list up to date").
  - *Checked from:* the Notes state.

**✍️ Full pass (required):**
- No forbidden item may be triggered, and the score must be at least 95 of 100.
- Every item is all or nothing and worth at least 10 points, so a pass requires all seven.
- The decisive E1 carries 30 points, more than the 5-point gap; missing it leaves at most 70.
- An agent that never finds the rule also misses E2 (its corrected sheet still has the wrong set) and E5, which leaves at most 40.

**Counterfactual control:** with the changed 2025 rule from Section 4:
- E1 expects {10, 19, 21};
- E2 expects no change to submission 5 and no resend;
- E5 and E6 adapt to that rule;
- E7 lists the current institution and the recent co-authors.

This is a planned grader control, not a claim of extra agent runs.

### Hint

**✍️ Hint (required):** "Your conversation with me dated September 8, 2025, your publications.bib and lab-page files, your Contacts and your Messages are relevant."

- **Injection:** the same text is shown twice, identically for all models:
  1. immediately after the `2026-02-20T09:00:00-05:00` request, before the agent's next action;
  2. at the start of the `2026-02-20T17:00:00-05:00` session, before the agent's first action. E2 and E6 depend on noticing the 13:30 message in that session, and a hinted run must be able to reach 100.
- All named records exist at both times. Aisha's 13:30 message to Priya is in Messages before the second injection.

### Reference solution

**✍️ Reference (required):**

| Time | Trigger | Agent action | Relies on | Resulting state | Items |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `2026-02-16T10:00:00-05:00` | First request | Find and read the 2025 rule, the bib, the lab snapshot, Contacts and Messages. Compare them with the October 2025 note and update it: <ul><li>remove Yuki Sato (consortium exception);</li><li>remove Chen Yu (graduated);</li><li>add Ines Moreau;</li><li>add Wei Zhang's Stanford affiliation.</li></ul> | Rule, records, old note | Conflict list current; nothing sent. | E7 (partial), F1, F2 |
| `2026-02-20T09:00:00-05:00` | Decisive request | <ol><li>Open the sheet.</li><li>Apply the rule with the window starting `2023-02-20`. By publication date, 4 and 21 are conflicts and 7 is not.</li><li>Check author counts: OpenShift-Bench has 14 authors, so 16 is not a conflict.</li><li>Link "Wei Zhang, Stanford" to the co-author via Contacts: 10 is a conflict.</li><li>Mark Becker's 9, Kestrel's 12, Lee's current student 17 and Northbridge's 19 as conflicts. Chen Yu (22), who graduated in December 2025, is not one.</li><li>Bid `eager` on 2, 5, 8, 11 and 15, `willing` on 7, 22 and 23, and `not_willing` on the rest.</li><li>Send the sheet to the TRL thread with no reasons.</li><li>Explain the conflicts and the differences to Aisha.</li></ol> | Rule, bib, snapshot, Messages, Contacts, sheet | Sheet sent with {4, 9, 10, 12, 17, 19, 21}. | E1, E3, E4, E5, F1–F3 |
| `2026-02-20T17:00:00-05:00` | "Anything else?" | Check Messages since 09:00. Aisha's 13:30 message to Priya starts a co-writing relationship. Set 5 to `conflict`, re-send the corrected sheet ("updated bids") to the TRL thread, add Priya to the Notes list, and tell Aisha. | 13:30 message, rule | Corrected sheet sent; list updated. | E2, E4, E6, E7, F1–F3 |

**✍️ Other accepted approaches (required):**
- Any mix of `eager` and `willing` satisfying E3 is accepted.
- The agent may send a short cover line without reasons.
- It may notice the 13:30 message earlier, if it is active, and send the correction sooner.
- The Notes record may be named differently, or a new record may replace the October one.
- If the agent asks Aisha about borderline cases, the scripted user replies "Use my rule." The agent must still finish before 23:59.

Not accepted:
- declaring 7, 16 or 22;
- missing any of 4, 9, 10, 12 or 17;
- leaving 5 as a positive bid in the final sheet;
- disclosing reasons to the organizers.

### Difficulty evidence from a local pre-implementation probe

**Setup.** Before implementation, we ran the design in a mock harness:
- **Tools:** a small command-line stand-in for Files, Notes, Messages, Contacts and the chat history, with the records, events and grader checks above.
- **Agents:** each session ran as a fresh Claude Code agent that could use only this CLI, so the 17:00 session saw the morning one only through the history. Session 1 was pre-written into the history; sessions 2 and 3 were live.
- **Scoring:** by script for E1–E4 and F1–F3, and by hand for E5–E7.
- **Models:** only Claude models were run. The official batch will cover the designated GPT, Claude and Gemini models.

The approved version was too easy, so we revised it five times (morning session shown; the 17:00 trigger was caught in every run that got there):

| Round | Change | Opus 5.5 unhinted | Sonnet 5.5 unhinted |
| :--- | :--- | :--- | :--- |
| 1 | Approved design | 0/2, but only through the namesake, on thin evidence; everything else correct, and 17:00 caught 2/2 | 0/2, same namesake issue |
| 2 | Rule in Aisha's own words; consortium exception; ~300 conversations; namesake given clear evidence | 0/3 | 1/2 passed (found the rule) |
| 3 | Rule behind a recurring opener; ~475 conversations | 1/2 passed (searched "three years") | 0/3 |
| 4 | Recency-ordered search; keyword noise | 0/3 | 0/2 |
| 4, hinted | — | 3/3 hinted runs still declared the namesake (14) by name match, so it tests attention rather than personalization; removed | — |
| 5 (this proposal) | Namesake removed; one ambiguous noise line fixed | **0/5** | **0/3** |

**Round 5 results.**
- **Hinted Opus 5.5:** scored 100 on both sessions. In the morning it sent exactly {4, 9, 10, 12, 17, 19, 21}, with 7 and 16 released and the full explanation. At 17:00 it re-sent with 5 added and updated the note.
- **Unhinted runs:** none found the rule. Each declared 16, and some also declared 7 or 22.
- **Unhinted scores:** three runs scored through both sessions came to 30, 30 and 30. Without the rule, E1, E2 and E5 are lost, so no failing run can exceed 40.
- **Harness caveat:** in some 17:00 sessions the mock harness's own permission check blocked the re-send command, and E6 was judged from the attempted action. This will be rechecked in the official harness.

## 6. Construction plan and effort

**✍️ Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| :--- | :--- | :--- | :--- |
| Persona, history and workspace | <ul><li>The 2025 rule conversation and its counterfactual.</li><li>About 475 conversations with keyword noise.</li><li>A `publications.bib` with about 15 entries, giving arXiv and publication dates, co-author affiliations and author counts.</li><li>The Lee lab snapshot.</li><li>About 30 contacts, including Wei Zhang's moved affiliation.</li><li>The stale October 2025 conflict note.</li><li>The Becker, Priya and TRL threads and a 24-row CSV with titles, authors, affiliations and `auto_conflict`.</li></ul> | <ul><li>The truth table is computed by script from the records and matches Section 5.</li><li>The counterfactual changes only the rule turn.</li><li>A script checks that keyword searches do not surface the rule turn among the most recent results.</li></ul> | 2–3 |
| User rollout and scenario script | **Sessions:** 3 at `2026-02-16T10:00:00-05:00`, `2026-02-20T09:00:00-05:00` and `2026-02-20T17:00:00-05:00`. **Simulated world time span:** 5 days. **Estimated total tokens:** 40,000–90,000 per complete scenario. | A deterministic script with the two scheduled messages, the fixed requests and the ask-first branch. | 1 |
| Environment integration | Published Files, Notes, Messages and Contacts only. The sheet is a CSV attachment in Messages. Conversation search returns the most recent matches first. | A resettable package. The outbound and attachment audits are exercised. | 1–2 |
| Rubrics, reference and hints | Implement F1–F3 and E1–E7, the hint, the reference, an accepted alternative and the counterfactual control. | <ul><li>The reference scores 100 and no-op scores 0.</li><li>Test cases:<ul><li>copying `auto_conflict`;</li><li>copying the stale October note;</li><li>arXiv-date windows;</li><li>counting the consortium paper;</li><li>all of the advisor's students;</li><li>Wei Zhang missed;</li><li>no 17:00 update;</li><li>reasons leaked to the organizers;</li><li>a malformed CSV.</li></ul></li></ul> | 2–3 |
| Agent rollouts and analysis | 5 unhinted rollouts and 1 hinted rollout per designated GPT, Claude and Gemini model, from fresh state. | Every trace and score, plus a failure analysis. | 1.5–3 |

**Milestones, owners and dependencies (required):** Yuyao Wang (@olivia3395) owns design, fixtures, grading, rollouts and review responses. The work order is:
1. Design approval.
2. Build the fixtures and truth-table script.
3. Implement the grader.
4. Freeze the design.
5. Run the official batch.

The task needs only published Apps, plus three platform capabilities: the session runner, cross-session history and the outbound/attachment audit.

**Dependency:** [#135](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/issues/135), Platform capabilities that Task proposals depend on.
- **Status: blocking.** As of 2026-11-27 the issue is open and these capabilities are not yet on `main`.
- Fixtures, the truth-table script and the grader can be built before then; the local probe above already exercises them.
- The official batch waits for #135.

The target is 2–3 weeks once these are available.

**Related work:**
- [#148](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/148) (SubmissionDesk) covers the author side and has no reviewer bidding.
- [#175](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/175) preserves blind ratings.
- [#257](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/257) and [#258](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/258) are by this author.

What is distinctive here:
- The decisive personal context is a **reviewer's own multi-clause conflict rule**, including an exception no convention would supply.
- It is applied by date arithmetic, author counts and identity linking in both directions.
- It must override the agent's own stale conflict memory and the organizers' auto list.
- A relationship formed later the same day extends it.

**Resources and total effort (required):**
- Effort: 7.5–12 person-days for implementation and validation, plus about 1.5 days already spent on drafting and the local probe.
- Validation batch: 15 unhinted and 3 hinted runs, plus development trials.
- Token budget assumption: 40,000–120,000 input and 1,500–8,000 output tokens per run, because the history is longer.
- Costs: API cost is TBD until the roster and prices are known.
- Compute: CPU only.

**Scope boundary and open questions (required):** Excluded:
- a real conference system;
- reviewing the papers;
- e-mail.

Open questions:
1. Is a CSV attachment in Messages an acceptable stand-in for a bidding form? Small workshops often use spreadsheets.
2. Will the outbound audit cover attachments?
3. Can conversation search in the platform return the most recent matches first, as the probe assumed?

These will be settled with the maintainers before the freeze. Difficulty is empirical; every valid rollout will be reported.

**Data provenance and privacy (required):**
- *Origin:* invented, inspired by the author's general experience of reviewer bidding. No real people, papers, venues or messages are used. Real-sounding names are fictional and paired with fictional institutions.
- *Privacy:* no private or third-party data is included.
