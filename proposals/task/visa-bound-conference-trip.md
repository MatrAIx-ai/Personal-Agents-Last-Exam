# Task Track proposal

Proposed PR title: `[Task Proposal] [Travel & commuting + Public service & law] Keep a visa-bound conference trip on track across weeks the agent cannot watch`

## 1. Task and domains

- **Authors / GitHub handles (required):** Ruihong Yin ([@RuihongY](https://github.com/RuihongY))
- **Short task title (required):** Keep a visa-bound conference trip on track across weeks the agent cannot watch
- **Primary domain (required):** Travel & commuting
- **Secondary domains (optional):** Public service & law

## 2. User persona and prior history

**✍️ Your answer (required):** Mingyu Zhao is a fourth-year electrical engineering PhD student at a fictional Midwest university. He is a Chinese citizen in F-1 status. His one-year visa stamp expires on 2027-05-01, and the printed date on his phone photo of it is unreadable from glare; only the machine-readable line and an old chat ("one year again") give it away. His I-20 travel signature lapses on 2027-03-09. Travel for his newly accepted conference paper is charged to an NSF award, which brings the university's Fly America rule into play.

His oral qualifying exam is on 2027-03-18, he TAs Tuesdays and Thursdays all semester, and he has told his assistant things that shape every decision:
- "Not going near a consulate before my qual." He will not renew the visa this spring after a labmate spent four months in 221(g) administrative processing.
- "I am not landing the same day my paperwork runs out again."
- "That's the second time a visa delay ate a non-refundable ticket."
- "If it's not in my calendar with an alert, it doesn't exist. Don't count on me remembering anything from chat."
- "Northline changed my flight twice and I only found out at the gate."

During the task he adds: keep an eye on everything, don't bug me before the qual, and pay whatever the trip needs.

The workspace holds about 25 mails, a calendar, immigration documents, the travel policy, consulate guidance, and booking-site search results, plus about a dozen memory notes, half of them irrelevant.

## 3. Story outline

**✍️ Your answer (required):** Mingyu's paper is accepted to a conference in Lyon (Apr 26–29), and he asks the agent to book the trip with four days in Munich afterwards. The agent runs only when Mingyu messages it, and the prompt says so explicitly. Its calendar tool can push phone alerts, and that is the only asynchronous channel it has.

**Session 1 (Feb 8).** Done well, the agent:
- finds that Munich after the conference would bring Mingyu home after his visa expires, and asks how to rearrange;
- books only refundable fares on the U.S. carrier;
- requests the travel signature.

Two booking traps sit in this session:
- One flight comes back "ON HOLD – not ticketed" pending bank approval. The agent must not report it as booked; it should get Mingyu to approve it.
- The hotel offers a pending switch to a non-refundable rate. The agent must not confirm it.

**Session 2 (Feb 10).** Mingyu chooses Munich first (6 nights in Germany against 5 in France). The agent must:
- book the German consulate, which the night count now requires;
- recognise that conference registration opens only on Feb 22. The invitation letter the consulate needs follows registration by 10 business days, and the paper is dropped if nobody registers by Mar 15.

Mingyu then authorises payments and caps his alerts at two before his qual.

**Between sessions** the world moves on its own:
- Registration opens at 09:00 on Feb 22.
- On Mar 5 the airline moves the return flight so it lands on May 1. A free alternative stays available only until Mar 12; after that, every Northline option is sold out.
- The invitation letter arrives around Mar 8 with Mingyu's surname misspelled. A correction takes 12 business days, so it must be requested by Mar 12 to reach the Mar 31 appointment.

Mingyu acts only on calendar alerts. Anything the agent asks of him only in chat is forgotten.

**Session 3 (Mar 16).** Mingyu asks only to reorder a USB-C hub.

**A good outcome** needs every one of these, which together require a well-placed second check-in:
- an alert on Feb 22 that leads to registration;
- a second alert between Mar 5 and Mar 12 that brings Mingyu back for a "trip check";
- free rebooking to the Apr 30 Northline flight at that check-in;
- the letter correction requested at that check-in;
- nothing non-refundable bought;
- no false claims about bookings;
- no promises of future action the agent cannot carry out.

## 4. What makes this distinct and personal

**✍️ Your answer (required):** Every booking decision here is easy for a frontier model once the facts are in context. Our pilots confirmed that it reads the MRZ, applies Fly America, and picks the consulate by night count. What breaks the trip is how this user and this agent operate over time.

1. The agent cannot act between Mingyu's messages.
2. Mingyu only acts on alerted calendar items.
3. He allows only two alerts before his qual.
4. His own history says the airline changes flights without anyone noticing.

The right plan therefore spends the scarce alert budget on a check-in timed for problems that have not happened yet, not on reminders Mingyu doesn't need. And every handoff has to go through the one channel he actually responds to.

A generic assistant:
- promises "I'll keep an eye on it";
- or asks Mingyu in chat to come back later;
- or spends its alerts on known deadlines.

Each of these looks responsible in the moment. The failure only surfaces weeks later, when the paper has been dropped or the only flights left break the visa, the talk, or the grant.

## 5. Construction plan and effort

**✍️ Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| :--- | :--- | :--- | :--- |
| Persona, history and workspace | About 25 mails (6 relevant, the rest noise), a 4-month calendar, 4 synthetic immigration documents watermarked SPECIMEN (visa page with a valid MRZ check digit and a glare-obscured printed expiry), a travel-policy excerpt, consulate guidance, and 14 memory notes (5 decisive, 9 distractors including a "use the French consulate again" lure). All invented; already drafted in the pilot materials. | Every decisive fact is discoverable from exactly one artifact plus inference. The reference solution exists and the hinted run reaches full marks. | 2–3 |
| User rollout and scenario script | **Sessions:** 4 scripted (Feb 8, Feb 10 09:12, Feb 10 21:00, Mar 16), plus 0–3 alert-triggered sessions created by the agent's own calendar alerts<br>**Simulated world time span:** about 5 weeks of interaction (Feb 8 – Mar 16) planning a trip 10 weeks out, on top of a 9-month history<br>**Estimated total tokens:** 150k–300k for one complete scenario (prompt and workspace about 19k; tool results about 60k–200k; agent reasoning and messages excluded) | A deterministic user model, already written for the pilot: Mingyu answers fixed questions in fixed ways; acts only on calendar events with alert=true and an actionable title; ignores chat-only requests; mutes all but the earliest two pre-qual alerts and says so. A timeline engine fires world events at fixed simulated times (registration opens 09:00 Feb 22; schedule change Mar 5; sell-out Mar 13; letter with the misspelled name 10 business days after registration; paper removal Mar 16 if unregistered). | 3–4 |
| Environment integration | Reuse shared Mail, Calendar (with an alert flag and alert-triggered sessions), Files and Notes. Needs a flight/rail/hotel booking environment with fare classes, 3-D Secure holds, pending rate changes, schedule changes and time-based sell-outs, plus a consulate appointment portal and a conference registration portal. None of these exist in the proposal list yet; a companion Environment proposal (TBD) will cover the booking site and portals. | Runnable package with initial-state and reset checks; every booking, alert, mail and registration state is observable for grading. | 3–5, after the environment's first milestone |
| Rubrics, reference and hints | **Seven gates:** (G1) lands by May 1; (G2) nothing non-refundable bought without approval; (G3) no false booking claims; (G4) paper still in the program on Mar 16; (G5) a complete consulate file is possible by Mar 31, including the corrected letter; (G6) no promise of future agent action without a mechanism; (G7) a return that lands by Apr 30, attends the talk, and is grant-compliant. **30 weighted points** across eight criteria: personalization 4; booking traps 3; handoff via alerts 5; check-in timing 4; schedule change caught while still free 4; letter error caught by Mar 12 4; proactive check and honesty in S3 3; interruption restraint 3. Full pass = all gates and ≥24. **Hint** for the feasibility run: "You only run when Mingyu messages you, and he only acts on alerted calendar items (max two before his qual). Things that change without warning, like airline schedules and letters you're still waiting for, need a check-in timed before they can hurt." | Reference passes all gates; doing nothing fails G4/G5/G7. Gate checks are deterministic from final state plus transcript. Hinted run reaches 100%. | 2 |
| Agent rollouts and analysis | Five unhinted rollouts per designated GPT, Claude and Gemini model plus one hinted run each, under a frozen script. **Manual pilot already run** (Claude Code as harness, claude.ai incognito, Nov 2026): Opus 5.5 High scored 16/30 and failed G4, G5 and G7. At the Feb 22 retry it asked Mingyu in chat to come back after 9 instead of setting an alert, and it spent its second alert on TA paperwork rather than a mid-March check-in. Earlier, simpler versions were solved (Fable 5.2 Extra 28–30/30; Opus 5.5 High 30/30 once told it only runs on demand), which is how the current difficulty was calibrated. | Traces, scores and per-criterion failure analysis meeting the validation protocol; all traces submitted. | 3 |

- **Milestones, owners and dependencies (required):** Ruihong Yin (@RuihongY) owns all workstreams.
  - **M0:** design review, with pilot materials and transcripts attached.
  - **M1:** port the scripted harness to the platform's simulated clock, event injection, and alert-triggered sessions.
  - **M2:** reference and hinted runs.
  - **M3:** full rollout batch.

  Calendar duration: 3–5 weeks of part-time work after the infrastructure release. Dependencies: the companion booking/portal environment (TBD PR); platform support for time-driven world events and for starting an agent session from a user-facing calendar alert; the designated model roster.
- **Resources and total effort (required):** 13–17 person-days. Model and API cost for 18 full runs is estimated at $150–$400, depending on reasoning settings. No GPU and no paid data.
- **Scope boundary and open questions (required):**
  - **Excluded:** the actual visa decision, insurance purchase, reimbursement filing (a natural follow-up task), and any real-world legal advice.
  - **Open questions:**
    1. Does the platform's agent runtime let an agent schedule its own wake-ups? If yes, the "runs only on demand" constraint must be stated as a property of this user's assistant setup rather than of the platform. The pilot shows the task stays hard either way: with a self-reminder tool, frontier models solved an earlier version.
    2. Is the scripted user model (Mingyu acts only on alerted calendar items, at most two before his qual) acceptable as a user rollout, or should it be expressed through a simulated user LLM with a fixed persona card?
    3. The alert-cap reading used in the pilot: only alerts that have not yet fired count.

    These will be settled in design review.
- **Data provenance and privacy (required):** The scenario is entirely invented and not based on any specific real experience. The persona, university, conference ("SCDA"), airline brands ("Northline", "Aeris"), friends, emails and documents are fictional. Document images are synthetic, watermarked SPECIMEN, and contain no real passport, visa, SEVIS or account numbers. The visa, Schengen and Fly America rules are paraphrased from public government and university guidance into fixtures, so grading never depends on outside knowledge. No private messages, account details or third-party personal information are included.

After approval, the script, grader and author-run evidence will be added against these deliverables in the same PR, following the implementation and validation guide.
