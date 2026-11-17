# Task Track proposal

Proposed PR title: `[Task Proposal] [Travel & commuting + Money & insurance] Book a points-funded anniversary trip while keeping the points still being earned`

## 1. Task and domains

- **Authors / GitHub handles (required):** Ruihong Yin ([@RuihongY](https://github.com/RuihongY))
- **Short task title (required):** Book a points-funded anniversary trip while keeping the points still being earned
- **Primary domain (required):** Travel & commuting
- **Secondary domains (optional):** Money & insurance

## 2. User persona and prior history

**✍️ Your answer (required):** Daniel Cho is a postdoc in Minneapolis. He and his wife Mei plan their fifth-anniversary trip to Tokyo and Kyoto (Oct 15–25) and want to pay for it with points. Their wallet:

| Account | State | What matters |
| :--- | :--- | :--- |
| Chase Sapphire Reserve (Daniel) | 281,600 Ultimate Rewards | 1:1 transfers to Aeroplan and Hyatt are final; trip-delay coverage applies only if award taxes are charged to this card |
| Chase Sapphire Preferred (Mei) | about 170k UR, not visible to the agent | Only Mei can start a household "Combine points" move |
| Hilton Honors Amex (new) | $1,410 of a $2,000 welcome-offer spend, due Sep 21 | Counts posted purchases only; gift cards excluded; bonus credited 8–12 weeks later |
| World of Hyatt | 41,200 points | Forfeited Sep 30 without activity |
| Hyatt free night certificate | Category 1–4 | Check-in by Oct 16 |
| Chase Freedom Unlimited | Default card on file | 3% foreign transaction fee |

Earlier chats give the agent the rules that decide the trip:
- "Business class both ways, sitting together, or we're not going." (Mei's rule)
- "Lisbon 2025: we waited for a transfer bonus and the seats were gone. When you find award space that works, book it."
- "Every flight goes on the Reserve, including the taxes on award tickets."
- "I opened the Hilton Amex only for the bonus. Don't let me blow it."
- "If it isn't on my calendar with an alert, it doesn't happen."
- "Grant due Oct 1. Until then, at most two pings from you, total."
- "$600 cash out of pocket, max, for flights and hotels."
- Mei "does exactly what you text her and nothing more", and answers slowly during night-shift weeks.

The workspace holds about 16 mails, a calendar, card and program terms excerpts, Daniel's draft itinerary, and 13 memory notes (8 decisive).

## 3. Story outline

**✍️ Your answer (required):** The agent runs only when Daniel messages it; calendar alerts are its only way to reach him. It can text Mei from Daniel's phone.

**Session 1 (Tue Aug 24, 21:00).** "Use our points and get the whole thing booked." The searches show:
- Aeroplan has United Polaris business both ways at 75,000 points per person each way, with only two seats left in each direction. United's own dynamic price, Virgin Atlantic's ANA option with $286 surcharges, and the Chase Travel portal at 1 cent a point are all far worse.
- A mail announces a 30% Chase→Aeroplan transfer bonus starting Sep 1.
- The certificate cannot be used at the Category 5 Shinjuku hotel. Only Hyatt Regency Tokyo Bay qualifies for the arrival night.
- Daniel's own points cover both return seats now, but not the whole trip. Mei must move about 165k more, and she reads messages only after her night shift.

**Between sessions** the world moves on its own:
- Mei acts at 07:40 Wednesday if the request was precise; if it was vague, she asks back and goes to sleep.
- The return award seats disappear at 18:00 on Wednesday; the outbound seats disappear on Sep 2.
- Sep 10: Hyatt announces that Hyatt Regency Kyoto moves to Category 7 for bookings made from Oct 1.
- Sep 11: United retimes the return so the SFO connection becomes illegal; a free alternative is offered until Sep 18.
- The welcome-offer and Hyatt deadlines (Sep 21, Sep 30) pass while the agent is not running.

**Session 2 (Sep 12).** Daniel asks only for his Sapphire Reserve statement balance. **Session 3 (Oct 3).** He asks only to put the Kikunoi dinner on his calendar.

**A good outcome:**
1. In session 1, lock the scarce return seats with Daniel's own points and charge the taxes to the Reserve.
2. Send Mei an exact request.
3. Set an alert for after she acts, and book the outbound and Kyoto in that session.
4. Have Daniel prepay the $642 car-insurance renewal with the Hilton Amex, named explicitly in the alert.
5. In session 2, check mail and take the free schedule-change fix.

Done this way, the whole trip costs $277 in cash.

## 4. What makes this distinct and personal

**✍️ Your answer (required):** Points travel is a puzzle of real program rules, and frontier models know the rules. Our pilot confirmed they pick the right redemption, apply the certificate category limit and get the pooling arithmetic exactly right. What breaks this trip is acting on that knowledge in time.

1. **Earning and spending pull against each other.** Charging the $220 of award taxes to the Hilton card would help the bonus but void the delay coverage Daniel insists on. The bonus needs an eligible, early, explicitly-carded purchase instead, and its points arrive too late to fund this trip.
2. **Irreversible steps meet scarce inventory.** Transfers cannot be undone, and seats vanish. The right move is to lock the scarcest leg with the points already in hand, not to wait until everything can be booked together.
3. **Handoffs go through two people with their own rules.** Mei acts only on precise instructions. Daniel acts only on alerts, and he allows two before Oct 1.
4. **Narrow questions hide changes in the world.** A schedule change and a category increase arrive while Daniel is asking about something else.

A generic assistant does each step sensibly in isolation. It waits for the full balance before booking, answers the balance question as asked, and reports honestly. The trip is lost anyway.

## 5. Construction plan and effort

**✍️ Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| :--- | :--- | :--- | :--- |
| Persona, history and workspace | About 16 mails (6 decisive: transfer bonus, insurance renewal, Hyatt expiry, Aeroplan fee notice, Amex progress, Kikunoi), a 10-week calendar, 5 terms excerpts (Ultimate Rewards transfers and household pooling, Sapphire Reserve trip delay, Hilton Amex offer terms, Freedom Unlimited fees, Hyatt certificate), Daniel's draft plan, and 13 memory notes. Already drafted in the pilot. | Every decisive rule appears in exactly one workspace artifact. The reference solution passes all gates. | 2 |
| User rollout and scenario script | **Sessions:** 3 scripted (Aug 24, Sep 12, Oct 3), plus alert-triggered sessions the agent creates (at most 2 count before Oct 1)<br>**Simulated world time span:** about 6 weeks of interaction (Aug 24 – Oct 3) for a trip 7–9 weeks out<br>**Estimated total tokens:** 120k–250k for one complete scenario (prompt and workspace about 12k; tool results about 40k–150k from repeated award searches; agent reasoning excluded) | A deterministic user model, already written for the pilot. Daniel acts only on alerted calendar events, does small tasks only if an alert spells them out (including which card), and enforces a cumulative two-alert budget. Mei acts at fixed times, and only on precise requests. A timeline engine fires seat sell-outs, the bonus window, the category change, the schedule change with a 7-day free fix, and the expiry and posting deadlines. | 3 |
| Environment integration | Reuse shared Mail, Calendar (with an alert flag and alert-triggered sessions), Files, Notes and Messages. Needs a points-and-travel fixture: card accounts with point balances and household pooling, partner transfers with bonus windows, an award search with time-based inventory, Hyatt search and booking with certificates and category changes, and a card-offer tracker with posting dates. None exists in the proposal list. #44 (hotel guest portal) and #47 (flight disruption) touch nearby flows without points. A companion Environment proposal (TBD) or a task-local fixture will cover it. | Runnable package with reset; every transfer, ticket, payment card, alert and message is observable for grading. | 3–5 |
| Rubrics, reference and hints | **Seven gates:** (G1) both travelers ticketed together, business both ways, Oct 15 out and home Oct 25, legal connections; (G2) trip cash ≤ $600; (G3) welcome offer earned without excluded purchases; (G4) Hyatt points and certificate not forfeited; (G5) no ≥5k points stranded in a partner program; (G6) truthful reporting, no promise without a mechanism; (G7) award taxes on the Sapphire Reserve. **30 weighted points:** redemption choice 4; points math and pooling 4; handoffs 5; earning side 4; Hyatt rules and timing 4; card choice 2; session-2 world check 4; session-3 honesty and alert restraint 3. Full pass = all gates and ≥24. **Hint** for the feasibility run: "Lock scarce award seats with the points you already have; set an alert for right after Mei acts; check mail every time you run." | Reference passes all gates ($277.20 cash). Waiting for Mei without an alert fails G1. Booking Kyoto after Oct 1 fails G2 (about $782). Gate checks are deterministic from final state plus transcript. | 2 |
| Agent rollouts and analysis | Five unhinted rollouts per designated GPT, Claude and Gemini model plus one hinted run each, under a frozen script. **Manual pilot already run** (Claude Code as environment, claude.ai incognito, Nov 2026): Opus 5.5 High scored 21/30 and failed G1. Its redemption choice, certificate handling, message to Mei (166,000 against the 165,400 needed) and Hilton bonus plan were all correct. But it did not book the two remaining return seats with points it already held. It waited for Mei's points and set the check-in alert for 18:00, by which time the seats were gone. In session 2 it again answered only the question asked and never read the mail. | Traces, scores and per-criterion failure analysis meeting the validation protocol; all traces submitted. | 3 |

- **Milestones, owners and dependencies (required):** Ruihong Yin (@RuihongY) owns all workstreams.
  - **M0:** design review, with pilot materials attached (prompt, harness, reference solution, transcript).
  - **M1:** port the scripted world and user models to the platform's simulated clock, event injection, messaging and alert-triggered sessions.
  - **M2:** reference and hinted runs.
  - **M3:** full rollout batch.

  Calendar duration: 3–4 weeks of part-time work after the infrastructure release. Dependencies: shared Calendar with alerts and alert-triggered sessions; a messaging channel with a scripted third party; the points-and-travel fixture (TBD); the designated model roster.
- **Resources and total effort (required):** 13–15 person-days. Model and API cost for 18 full runs is estimated at $120–$300. No GPU and no paid data.
- **Scope boundary and open questions (required):**
  - **Excluded:** actual card applications, real payments, credit or financial advice, travel insurance claims, and in-trip changes.
  - **Open questions:**
    1. **Real brands.** The task uses real program and card names (Chase, Aeroplan, United, Hyatt, Hilton, American Express), with rules paraphrased from public 2026 terms into the workspace. The prompt states that the workspace overrides the model's memory of these programs. Is this acceptable, or should brands be renamed?
    2. **Timing rule.** When an alert asks Daniel to do small tasks before messaging the agent, the pilot starts the session after he finishes them (about 3 minutes per task). In the pilot this put the session at 18:06, after the 18:00 sell-out. Under a lenient reading the agent would have booked in time. It would then likely still have failed G1 by missing the Sep 11 schedule change, but that path was not run. We propose fixing the rule in the script before validation.
    3. Same platform question as our other proposals: is "the agent only runs when the user messages it" acceptable as a stated property of the user's setup?
    4. Should Mei be a scripted responder, as in the pilot, or a simulated user LLM with a fixed persona card?

    These will be settled in design review.
- **Data provenance and privacy (required):** The scenario, people, balances, mails, seat inventory and timeline are entirely invented and not based on any specific real experience. Brand names are real. Program rules (transfer ratios, household pooling, partner booking fee, certificate categories, points expiry, welcome-offer exclusions and posting delay, foreign transaction fee, trip-delay conditions) are paraphrased from public 2026 terms into fixtures, so grading never depends on outside knowledge. Prices and category changes are scenario values: the Kyoto recategorisation is a fictional event. No real account numbers, private messages or third-party personal information are included.

After approval, the script, grader and author-run evidence will be added against these deliverables in the same PR, following the implementation and validation guide.
