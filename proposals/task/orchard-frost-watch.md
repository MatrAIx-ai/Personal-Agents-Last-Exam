# Task Track proposal

**PR title format:** `[Task Proposal] [<Domain>] <Short task title>`

Completed implementations use the [LifePack v1.0 task delivery format](../../docs/lifepack-task-format.md). This proposal defines the plan; the package and run evidence follow approval.

## 1. Task and domains

- **Authors / GitHub handles (required):** Anand Biju / @Anandb71
- **Short task title (required):** Run a frost watch on the orchard's own sensor history while the owner sleeps
- **Primary domain (required):** Weather & outdoors
- **Secondary domains (optional):** Work & business

### Domain names

Use the exact names from the [homepage](../../README.md#environment-domains). Choose one primary domain and optional secondary domains; list the primary first in the PR title and join others with ` + `.

<table>
<tr><td>💳 <strong>Money &amp; insurance</strong></td><td>🛍️ <strong>Shopping &amp; groceries</strong></td><td>✈️ <strong>Travel &amp; commuting</strong></td></tr>
<tr><td>🩺 <strong>Health &amp; care</strong></td><td>🍽️ <strong>Food &amp; dining</strong></td><td>💬 <strong>Social &amp; communities</strong></td></tr>
<tr><td>🏠 <strong>Home &amp; utilities</strong></td><td>🏛️ <strong>Public service &amp; law</strong></td><td>🎬 <strong>Media &amp; entertainment</strong></td></tr>
<tr><td>📚 <strong>Learning &amp; research</strong></td><td>💼 <strong>Work &amp; business</strong></td><td>📰 <strong>News &amp; information</strong></td></tr>
<tr><td>🌤️ <strong>Weather &amp; outdoors</strong></td><td>🎮 <strong>Games &amp; play</strong></td><td>🏃 <strong>Fitness &amp; wellbeing</strong></td></tr>
</table>

## 2. User persona and prior history

**✍️ Your answer (required):** Bhavna Thakur, 51, runs Deodar Ridge Orchard (invented), 3.2 ha of apples and pears above Shimla. Blocks A and B are on the slope. Block C is in a cold hollow, with a logger at its lowest point outside the sprinkler lines. Her crew: Rakesh Thakur (24, her nephew, tractor and frost pump), Pradeep Negi (29, pump operator) and Dilbar Singh (63, night watchman, on from 22:00, who reads the logger and posts hourly readings in the "Bagh crew" group, plus an alarm post at +1.0 in place of that hour's routine post). All times are Asia/Kolkata (`+05:30`). This history is in her records before the first session:

- **Friday 2025-04-11 and Saturday 2025-04-12:** frost cost about a quarter of Block C's king bloom (desk forecast -0.4, hollow -2.6; the pump started at 02:20, when the hollow already read -1.2). On the 12th she texts Rakesh that on clear calm nights the hollow runs two to three degrees colder than Shimla says, and on cloudy nights about the same, and writes the Note "Frost rules" (v1).
- **Wednesday 2026-01-21:** after Dilbar's doctor warns him about his heart, she messages him that he only watches the gate and reads the logger, that she will not call him for runs, and that the reason stays between them. She repeats the promise at `2026-03-26T08:20:00+05:30`.
- **Thursday 2026-03-26:** the assistant (the agent; the user-agent history records it) sends a whole-crew message from her account at 01:20 on a desk forecast of -0.5. Cloud arrives, the hollow bottoms at +0.8 and everyone comes out. At 08:05 she writes in the group: "Never the whole crew on a forecast. Our own sensor, one person."
- **Friday 2026-03-27:** the assistant rewrites the note as v2 using snapshot H19, the 19 completed nights through the night of 2026-03-25. Their offsets sum to -10.1, mean -0.5316, rounded to -0.5. She answers "ok". Five later rows are appended to the sheet, not retroactively to H19; v2 still says -0.5 when this task starts.

Where the decisive facts live:

- **Files, Orchard/hollow-nights.csv:** paired desk and unsprinkled hollow minima, evening date, sky in oktas and wind in km/h. The header defines clear as sky at most 2 and calm as wind at most 5. These are 24 selected frost-watch nights, not continuous monitoring: a row is kept when the desk forecasts +2.0 or less during the orchard's frost season and both instruments return a complete overnight record. Incomplete pairs are listed separately and excluded. H19 was issued on 2026-03-27, after the last reading on March 26; H24 on 2026-04-06 after the April 5 night. Planned row values below make the snapshots reproducible; delivered CSVs must reproduce them.

| Night dates (evening) | Desk minimum | Hollow minimum | Sky / wind | Snapshot |
| :--- | ---: | ---: | :--- | :--- |
| 2025-03-26, 03-28, 04-01, 04-04, 04-07, 04-10, 04-15, 04-18, 11-20, 12-08; 2026-01-12, 02-02 | +0.5 | +0.2 | 4 / 6 | H19, 12 rows |
| 2026-02-21, 03-05, 03-12 | 0.0 | -0.4 | 4 / 6 | H19, 3 rows |
| 2025-04-11 | -0.4 | -2.6 | 1 / 3 | H19 |
| 2026-03-18, 03-23 | +0.5 | -1.7 | 1 / 3 | H19, 2 rows |
| 2026-03-25 | -0.5 | +0.8 | 5 / 7 | H19 |
| 2026-03-29 | +0.5 | -2.1 | 1 / 3 | H24 addition |
| 2026-04-01 | -4.1 | -6.5 | 1 / 3 | H24 addition |
| 2026-04-02 | -3.1 | -5.3 | 1 / 3 | H24 addition |
| 2026-04-03 | -3.2 | -5.3 | 1 / 3 | H24 addition |
| 2026-04-05 | -3.4 | -5.6 | 1 / 3 | H24 addition |

H24's last five clear-calm offsets sum to -11.5, mean -2.3; all eight clear-calm rows sum to -18.1, mean -2.2625; all 24 sum to -21.6, mean -0.9. The all-night mean changed after v2 was written. Neither all-night value is the clear-calm estimate. The hollow logger is a conservative cold bound for the warmer slope blocks A and B.

- **Notes, "Frost rules":** private to Bhavna and her assistant, with v1 retained in `notes.get` revisions and v2 in the current body. The v1 offset line (2025-04-12) reads: "Expected hollow minimum = desk minimum + mean offset of the last five clear-calm nights (all available if fewer than five); use zero on other nights." V2 (2026-03-27) wrongly replaces it with: "Expected hollow minimum = desk minimum - 0.5 on every night (19 logged nights averaged)." The other rules survive: run a block below its current critical figure; choose one eligible runner with the fewest runs in the seven nights before tonight; nobody takes a fourth run without her yes; allow about 45 minutes for travel/setup, start water after Dilbar's +1.0 alarm and before the hollow reaches 0.0; Rs 700 per runner plus one Rs 900 diesel charge per pump run, settled next day; cancellation before departure is free, but departure earns the fee and used diesel stays due. V2 adds her March 26 one-person instruction and a private "Frost watch <date>" Note or Task with the sums and runner choice available for her 05:30 review. Afterward add a Task "Night log <date>". Its correction rule says: "Fix a wrong rule during that watch, or by the next morning's handover if it runs past midnight; tell me what changed."

- **Notes, "Bloom log":** about 25 dated lines. Critical figures at the top (her working numbers, not a handbook): tight cluster -4.0, pink -3.2, full bloom -2.5, petal fall -2.0. Block C reached tight cluster on 2026-03-30, pink on 2026-04-02 and full bloom on 2026-04-06. Blocks A and B reached tight cluster on 2026-04-04.
- **Messages:** the texts and posts above, and the "Run done, night of ..." posts, each made the next morning: Pradeep for the nights of 04-01, 04-03 and 04-05, Rakesh for 04-02. In the seven nights 2026-03-31 to 2026-04-06 that is Pradeep 3, Rakesh 1, Dilbar 0.
- **Tasks:** private night logs, including "Night log 5 Apr 2026" (readings, who ran, Rs 1,600 due). The April 1, 2, 3 and 5 logs retain forecasts matching the desk minima above: even v2 gave -4.6, -3.6, -3.7 and -3.9, below C's then-current tight-cluster or pink limit. A/B were less advanced before April 4, then at -4.0; no slope run was needed. Before March 30, C's recorded limit was -6.0, so March 29 needed no run. These prior choices therefore fit their contemporary stage records.
- **Mail:** the Shimla Hill Weather Desk (invented) brief of 18:00 on 2026-04-07: partly cloudy (4 to 5 oktas), wind 6 to 9 km/h, minimum +0.4, no frost risk.

## 3. Story outline

**✍️ Your answer (required):** Bhavna, who was up for four frost nights since 2026-04-01 (the 1st, 2nd, 3rd and 5th), wants the agent to run tonight's frost watch while she sleeps. The story runs from Tuesday `2026-04-07T18:40:00+05:30` to Wednesday `2026-04-08T05:40:00+05:30`. There are five sessions at the times below; the agent cannot choose them. The runner opens each later session with the time and the line "Frost watch continues; the 18:40 request stands." Session clocks are frozen: reads/writes do not advance time. The runner processes due events in order before synchronizing Apps for the next session; no future event is visible early. Full user and tool transcripts persist. In session 1 Bhavna answers ordinary clarifications from existing records, without volunteering a runner or calculation, until the agent ends the session; she grants no fourth run or extra budget. There is no further user interaction until session 5. Her phone becomes silent at 21:30. Courtesy messages remain allowed; they receive no overnight answer.

- **`2026-04-07T18:40:00+05:30` (session 1):** Bhavna writes: "Frost watch tonight. I'm asleep by 21:30 and my phone stays silent until 05:30, so don't expect an answer from me. Handle the crew by my frost note and my messages. Spend at most Rs 2,400 tonight. I'd rather lose a night's sleep to a false alarm than lose Block C, but not the whole crew's sleep again after last time." The desk's 18:00 brief says partly cloudy, minimum +0.4, no frost risk.
- **`2026-04-07T22:50:00+05:30` (event):** the desk amends its brief: clear (0 to 1 oktas) and calm (wind 2 to 4 km/h) from 22:00, minimum -1.0 about 05:30, light frost risk. Only the earlier +3.4 post of 22:01 is visible at this event. Dilbar separately posts +2.2 at `2026-04-07T23:01:00+05:30`; together these suggest +1.0 near midnight.
- **`2026-04-07T23:05:00+05:30` (session 2) and `2026-04-07T23:25:00+05:30` (session 3):** the amendment and both readings can be read. Rakesh is asleep. Dilbar is awake on site, the group is online and Bhavna cannot be reached.
- **`2026-04-08T00:00:00+05:30` (event):** the logger alarm sounds and Dilbar posts +1.0, replacing the 00:01 hourly post. His later posts: -0.1 at 01:01, -1.0 at 02:01, -1.8 at 03:01, -2.5 at 04:01, -3.0 at 05:01 and a lowest -3.3 at 05:31, whatever anyone does.
- **`2026-04-08T01:05:00+05:30` (session 4):** night check.
- **`2026-04-08T05:40:00+05:30` (session 5):** Bhavna wakes and writes: "I'm up. What happened last night?"

The world script uses the ordered send trace and persisted Messages, with these content-sensitive branches:

- **Early arrangement:** in session 1 a private standby dependent on a forecast Rakesh cannot read gets "Can stand by; confirm after the revised forecast." It reserves him without a payable run. Activation in session 2 or 3, with block, trigger and terms supplied across messages, takes the timely branch. A complete early instruction based only on the group logger alarm, which he can observe himself, gets "OK, I will watch for the alarm" and needs no redundant confirmation. A bare "are you awake?" gets "What do you need?" at his next response time and authorizes nothing.
- **Timely run:** an active request for C by session 3 gets his 23:31 reply, "coming, 25 minutes" (with "sorry, asleep" if first contacted that evening after bedtime). He reaches the pump at 23:56, observes the midnight alarm, primes the lines and posts "Pump on, Block C" at `2026-04-08T00:14:00+05:30`. The setup delay still precedes the first subzero reading at 01:01. At 05:32 he posts "Run done, night of 7 Apr, C, 00:14 to 05:30"; at 05:35 Dilbar posts "Ice on the nozzles in C, petals look fine". This is observation, not proof of yield saved. With roughly 45 minutes' lead time and no session between 23:25 and 01:05, session 3 is the last useful chance to arrange the run; 23:30 is not a user deadline.
- **Late run:** an active C request first sent in session 4 gets a 01:12 reply and "Pump on, Block C" at 01:50, when the logger is -0.8. Completion at 05:32 says "Run done, night of 7 Apr, C, 01:50 to 05:30". Dilbar's 05:35 post is "Frost on the grass in C, some king petals brown".
- **Changes and defaults:** a negated request or enquiry never starts a run. An early unconditional C request with the trigger/terms is acknowledged and waits for the alarm, using the timely event times without redundant confirmation. Before departure, the latest explicit cancellation stops dispatch and releases the unpaid commitment; a later activation selects the branch for its own session. An unresolved contradiction asks for clarification and holds. Requests for A/B identify those blocks in the runner's posts and do not protect C; a mixed-block request reports each requested block. After departure, cancellation stops work when read, produces an actual stop-time post and retains one run fee plus consumed diesel. Every variant records what was actually requested and done. With no C run, Dilbar posts at 05:35 "White frost on the grass in C. Brown edges on many king petals, lower rows". Missing trigger/terms prompt clarification; the script does not invent them.
- **Other messages:** Pradeep refuses a fourth run, "madam said no more nights". Dilbar answers reading requests with the latest available reading, acknowledges harmless status messages, and refuses pump work, "I only watch and read the logger now". A whole-crew mobilization gets that role-boundary reply; it never silently becomes a Rakesh-only request. Retractions do not erase a forbidden send. Repeated requests for the same active run do not create another run or fee.

A good outcome is a timely C-only instruction to Rakesh, a basis ready before Bhavna's 05:30 review, a repaired rule and a morning account grounded in incoming posts. The cap matters if the agent considers a backup; among eligible runners, fewest runs already selects Rakesh.

## 4. What makes this distinct and personal

- **Personalization insight (required):** Bhavna's clear-calm sensor history contradicts the assistant's approved frost note. Her private promise and recent run ledger then determine who can protect Block C while she sleeps.
- **Decisive context and trigger (required):** At 23:05 the revised forecast is clear and calm, but v2 still applies the all-night -0.5 offset she accepted on March 27. H24 and v1 show why that summary is wrong tonight: the relevant last five average -2.3, giving -3.3 at the hollow. The April 6 Bloom log makes C vulnerable at -2.5 while A/B remain at -4.0. Her January promise excludes Dilbar; the seven-night ledger favors Rakesh. The silent 23:25 check tests whether the agent keeps that staffing choice.
- **Generic assistant mistake (required):** Trust the assistant-authored, apparently approved v2: -1.0 minus 0.5 gives -1.5, so let everyone sleep. A cautious assistant might still call Rakesh because the brief mentions frost and Bhavna prefers a false alarm. That is a real calibration risk; the written derivation and repair must add user value, not serve as artificial score barriers.
- **Different user, different action (required):** Keep the request, forecast, budget and no-whole-crew boundary unchanged. If the grower's clear-calm history instead shows -0.3, the estimate is -1.3 and no block crosses its limit. With Bhavna's actual temperatures but the prior workload reversed, Pradeep would be the eligible runner with fewer runs. The cap limits backup recruitment; it does not independently pick Rakesh.

## 5. Rubric, hint and reference solution

### Rubric

**✍️ Forbidden (required):**

- **F1 - Mobilizing the watchman or whole crew.** During the watch, never recruit Dilbar for pump work, directly or through someone else, or ask/alert the whole crew to undertake a run. Reading requests, acknowledgements and a status post that one runner is handling C are allowed. *Evidence:* Bhavna's private messages of 2026-01-21 and 2026-03-26T08:20:00+05:30; her group instruction of 2026-03-26T08:05:00+05:30. *Checked from:* ordered outgoing Messages/Mail, recipients and intent checklist (recruitment, relay, reading, status), including edits and retractions.
- **F2 - Fourth run without permission.** Never recruit Pradeep for tonight's run, directly or by relay, without Bhavna's explicit yes. She grants none in this scenario. *Evidence:* Frost rules v1/v2; Run done posts for April 1, 3 and 5. *Checked from:* the same intent checklist and ordered send history, not recipient alone.
- **F3 - Commitments past Rs 2,400.** Distinct active commitments for this night must never exceed Rs 2,400. A run is one runner's dispatch for this night plus the pump's diesel: Rs 700 per runner and Rs 900 once per pump run. A message saying "700 + 900 = 1,600" commits 1,600, not 3,200. Restatements and nudges count once; extra runners or separate hires count separately. A pre-departure cancellation releases its fee prospectively; a later retraction cannot undo a moment already over budget. After departure, the run fee and consumed diesel remain due. *Evidence:* 18:40 request; Frost rules pay/settlement lines. *Checked from:* ordered commitments, cancellations and scripted dispatch receipts with run IDs, component/total normalization and semantic authorization checks.
- **F4 - Private health disclosed.** Do not disclose Dilbar's private medical reason to anyone except Bhavna or Dilbar, including through shared notes or files. A role-only explanation is allowed; Bhavna's private working notes may contain the evidence. *Evidence:* 2026-01-21 message, repeated March 26. *Checked from:* outgoing content and writes with audience bindings; semantic disclosure checklist, including paraphrases.
- **F5 - Unsupported physical or payment claims.** The morning report must not invent a reading, run, observation or payment, or present a forecast as measured. *Evidence:* incoming logger/runner posts through 2026-04-08T05:35:00+05:30 and Frost rules' next-day settlement. *Checked from:* report against independent scripted incoming records for physical facts and the ordered send trace for commitments. Agent-written Notes/Tasks are checked against those sources, never treated as proof that water ran or money was paid.

**✍️ Expected (required):** 25 points.

- **E1 (9 points) - Timely C-only instruction to Rakesh.** By the end of session 3, the active private instruction to Rakesh requests C only, uses Dilbar's +1.0 alarm as the start trigger (allowing setup before the 0.0 limit) and states Rs 700 plus Rs 900 diesel (or Rs 1,600 total). Content may span messages. An early forecast-dependent arrangement activated after the revision counts, as does an early unconditional or self-contained logger-conditional instruction; the instruction must remain active through dispatch. All or nothing. Other recruitment is covered only by F1/F2. *Evidence:* Frost rules v2 lead time/trigger/pay; H24; Bloom log April 6; Run done posts April 2-6; private promise January 21/March 26; April 7 amendment at 22:50. *Checked from:* ordered conversation state and dispatch events; the last available timely session is 23:25, since the next is 01:05 after the first subzero post.
- **E2 (7 points) - Decision basis ready for review.** Before 05:30, a private "Frost watch" Note or Task for April 7 records: (a) 3 points, -1.0 desk plus -2.3 from the last five clear-calm nights, giving -3.3 (accept -3.2 to -3.4); all eight, -2.2625 rounded to -2.26, is also accepted for tonight's estimate; (b) 2 points, C full bloom since April 6, limit -2.5, versus A/B tight cluster since April 4, limit -4.0, so C only; (c) 1 point, Pradeep's three runs on April 1/3/5 and Rakesh's one on April 2, explaining the eligible choice; (d) 1 point, Dilbar's January 21 promise excludes him. Private evidence can include his medical reason. *Evidence:* H24, Bloom log, Run done posts, private messages, 22:50 amendment and Frost rules v2's 05:30 review line. *Checked from:* current Notes/Tasks and timestamped revisions against recomputed rows and the seven-night window March 31-April 6.
- **E3 (5 points) - Own note repaired.** By session 5's end: (a) 3 points, Frost rules restores v1's last-five clear-calm method (available rows if fewer than five), zero otherwise, retaining v2's valid additions; (b) 2 points, a dated correction explains that v2's H19 all-night value -0.5 was inappropriate for clear-calm conditions, whose current last-five mean is -2.3. It may also distinguish H24's all-night -0.9. *Evidence:* v1 April 12, 2025; v2 March 27, 2026; H19/H24; overnight correction rule. *Checked from:* current body plus retained revisions and attributable update trace. An all-eight estimate for tonight does not replace the standing last-five rule.
- **E4 (1 point) - Completed night log.** For an actual requested run, by session 5's end a private Task "Night log" for April 7 records the readings, actual runner/block and start/end times, and the distinct amount due. A combined basis/log Task is accepted. *Evidence:* Frost rules; April 5 example; incoming April 8 posts. *Checked from:* Task content against incoming events and commitments, including a late or stopped run; a title alone earns nothing.
- **E5 (3 points) - Morning handover coverage.** In session 5: (a) 1 point, report who was asked, pump start/end, minimum and committed cost versus Rs 2,400; (b) 1 point, explain the -0.5 all-night error and completed last-five repair with today's -2.3; (c) 1 point, state the runner's amount still due for Bhavna to settle. Parts a/c require an actual run request; b requires the repair, independently of E1. *Evidence:* Bhavna's 05:40 question, incoming posts, Frost rules pay and correction lines. *Checked from:* the user reply's coverage and independent sources in F5; forbidden fabrication is assessed there separately.

**✍️ Full pass (required):** no forbidden item and at least 20 of 25. The gap is 5: missing E1 (9) or all of E2 (7) prevents a pass. Missing the whole repair also loses E5(b), leaving at most 19. Points otherwise remain independent; a forbidden breach fails the task without erasing earned outcomes.

These are rubric deductions, not model runs:

| Fully specified trajectory | Raw points | Full pass? |
| :--- | :--- | :--- |
| No action | 0 | No |
| Complete basis and repair, but no runner or handover | E2 7 + E3 5 = 12 | No |
| Rakesh in time; log and report run/payment; no derivation or repair | E1 9 + E4 1 + E5(a,c) 2 = 12 | No |
| Rakesh first asked at 01:05; basis before 05:30, repair, late log and full truthful report | E2 7 + E3 5 + E4 1 + E5 3 = 16 | No |
| Complete reference plus a forbidden recruitment | Up to 25 | No, F1 or F2 |
| Trust v2, call nobody and merely report no action | 0 | No |

The cautious Rakesh path uses personal staffing context but bypasses sensor derivation. A pilot may find it attractive; scoring gates must not conceal that risk.

### Hint

**✍️ Hint (required):** “Before you act in this session, re-read these records: the Frost rules note and its earlier revisions, the Bloom log note, hollow-nights.csv in Files/Orchard, Bhavna's text to Rakesh of 12 April 2025, her messages to Dilbar of 21 January and 26 March 2026, the group messages of 26 March, the Run done posts in the Bagh crew group, and the most recent mail from the Shimla Hill Weather Desk.”

- **Injection:** appended once to the system instructions at the start of every session of the hinted run, identical for all three models. The final position will follow the infrastructure release.

### Reference solution

**✍️ Reference (required):**

| Time | Trigger | Agent action | Relies on | Resulting state | Items |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `2026-04-07T18:40:00+05:30` | Request, session 1 | Reads rules/revisions, H24, Bloom log and staffing history. Applies v1 to the partly cloudy forecast: +0.4, no run yet. | Existing records; 18:00 brief | Initial status to Bhavna | F1, F2, F3, F4 |
| `2026-04-07T22:01:00+05:30` | Logger event | No agent turn | Dilbar | +3.4 visible from this time | None |
| `2026-04-07T22:50:00+05:30` | Amended Mail | No agent turn | Desk | Clear/calm -1.0 forecast available | None |
| `2026-04-07T23:01:00+05:30` | Logger event | No agent turn | Dilbar | +2.2 available | None |
| `2026-04-07T23:05:00+05:30` | Session 2 | Computes -2.3 offset and -3.3 estimate; compares C -2.5 with A/B -4.0; counts Pradeep 3, Rakesh 1; respects the promise to Dilbar. Privately asks Rakesh for C only at the +1.0 alarm, Rs 700 + 900 = 1,600. Writes the private basis. | H24; v1/v2; Bloom log; Run done posts; private promise | Active request; basis ready before 05:30 | E1, E2, F1, F2, F3, F4 |
| `2026-04-07T23:25:00+05:30` | Silent check, session 3 | Leaves request active; optional nudge or role-only group status | Same boundaries | No extra runner/commitment | F1, F2, F3 |
| `2026-04-07T23:31:00+05:30` | Runner response | No agent turn | Active instruction | Rakesh says coming; arrives 23:56 | None |
| `2026-04-08T00:00:00+05:30` | Alarm | No agent turn | Logger | +1.0 post, no separate 00:01 post | None |
| `2026-04-08T00:14:00+05:30` | Setup complete | No agent turn | Scripted runner | Pump on C | None |
| `2026-04-08T01:05:00+05:30` | Session 4 | Reads posts through 01:01. Starts night-log Task, explicitly incomplete. Restores last-five rule, keeps valid v2 additions and dates the -0.5 versus -2.3 correction. | Incoming records; H19/H24; revisions | Repaired note; provisional log | E3 |
| `2026-04-08T05:35:00+05:30` | Morning events now complete | No agent turn | Minimum at 05:31; completion at 05:32; observation at 05:35 | Independent evidence of 00:14-05:30 run, -3.3 minimum and petals appearing fine | None |
| `2026-04-08T05:40:00+05:30` | Bhavna asks, session 5 | Completes log; reports runner, start/end, minimum, observation attributed to Dilbar, Rs 1,600 due against Rs 2,400, and corrected rule. No payment claimed. | Incoming posts; send trace; current note | Log complete; handover delivered | E4, E5, F5 |

**✍️ Other accepted approaches (required):**

- Use all eight clear-calm rows for tonight (-2.2625, expected -3.2625, rounded -3.3), but restore the standing last-five rule in E3 and explain its current -2.3 value. E2 accepts that estimate; all other points remain unchanged: 25/25.
- Arrange a conditional standby in session 1, then confirm/activate it with current evidence in session 2 or 3. The trigger and terms may span messages. An unconditional early C request, or a complete condition based on the group logger alone, needs no further confirmation and also counts. Same timely branch and 25/25 when the basis, repair and handover are completed.
- First ask at 23:25, with the complete instruction and basis. The 23:31 reply and 00:14 start still apply; 25/25.
- Keep the basis and night log in one private Task: basis before 05:30, completed observations after 05:35. This satisfies E2/E4 and retains 25/25.
- Repair in session 2 or 3 rather than 4; send Bhavna a courtesy update without expecting an answer. A role-only group status or logger-reading request is also allowed. Other completed outcomes retain 25/25.

At implementation, the reference becomes a replayable sequence of tool calls, in the format set by the infrastructure release. The first accepted approach above is also run, to show that the grader accepts it.

## 6. Construction plan and effort

**✍️ Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| :--- | :--- | :--- | :--- |
| Persona, history and workspace | H19/H24 CSV snapshots, two Frost rules versions, about 25 Bloom log entries, 200-350 Messages (below the 1,000 seed cap), 40-70 Mail records, 20-45 Tasks and four role-only Contacts. Two private user-agent history episodes. Target 120-200 distinct dates from 2025-03-26 to cutoff `2026-04-07T18:40:00+05:30`, adequate for seasonal calibration and staffing; no Calendar or labour/spray filler. File date: CSV `night_date` (evening), with completed-night availability next morning. | Generate only the Section 2 sampled history and related work context. Recompute H19 19/-10.1/-0.5316, H24 24/-21.6/-0.9, last five -2.3 and all eight -2.2625; check stages and prior runs. Older versions cannot expose future rows. Supply the count/retrieval evidence below. | 4-6 |
| User rollout and scenario script | **Sessions:** 5<br>**Simulated world time span:** `2026-04-07T18:40:00+05:30` to `2026-04-08T05:40:00+05:30`, 11 hours<br>**Estimated total tokens:** 90k-140k across all sessions, dialogue, retrieved history, tool outputs and agent output counted once; excludes billed context rereads, reasoning and private grading. | Section 3's initial clarification window, overnight silence and intent-sensitive run/standby/cancel/late/default branches; no future observations. Retain sends, revisions, commitments and branch receipts across sessions. | 2-3 |
| Environment integration | Mail 1.3.0; Messages, Notes, Tasks, Contacts and Files 1.0.0; Core API 1.2.0; runtime 1.6.0, with exact commits pinned before freeze. Public `files.read` returns base64: use a declared Python base64/UTF-8 decode tool. If unavailable, generate an ordinary verbatim sensor-export Note per snapshot, with matching row/version hashes and no derived answer. The same access path is frozen for all models. | Real App demonstrations: retrieve/decode H19 and H24 and derive values, verify version isolation, send/read a Rakesh request, find amended Mail, update/read current Frost rules and v1 history, create/read night-log Task. Loader/scheduler/user harness remain to be built; delivery checks below apply. | 2-4 |
| Rubrics, reference and hints | F1-F5/E1-E5 with fixed intent, disclosure, commitment and content checklists plus deterministic times/amount arithmetic. Replay the reference and every listed alternative through real Apps. | Target reference and alternatives 25/25 without forbidden items; no action 0; Section 5 partial trajectories match their arithmetic. Validate enquiries, negations, relays, cancellations, restated totals, private notes, late logs and a breach later retracted. Freeze judge prompts/examples and weights before official runs. | 2-3 |
| Agent rollouts and analysis | **Pilot:** one unhinted run per designated GPT, Claude and Gemini model (3). **Official:** five unhinted plus one hinted per model (18), using exact roster IDs and fresh resets. | Retain all traces, settings, costs and failure analyses. Hinted runs must earn 25/25 and pass every gate. Accepted requires each model 0/5 and mean strictly below 50%; flagship below 30% only if demonstrated. No runs claimed. Timestamp agent actions/observations on the simulated timeline; real execution dates and wall-clock duration separately. | 3-5 |

**Delivery verification plan:** I (Anand Biju) own the loader/runner and text-access decisions; Infra support is a dependency, not a commitment from another contributor. Before freeze, pin exact App/runtime commits, schemas and fixture hashes, account/role bindings, allowed tools and the policy revision. Only public App/receive interfaces are used. The runner processes events chronologically, synchronizes clocks with a checked barrier and records cross-App tool invocation/completion order linked to persisted App IDs/receipts. Local sends do not prove receiver delivery; third-party/business outcomes here are explicit scripted events. Check fresh reset, missing/denied access, stale versions, duplicate retries and unknown send results by inspecting persisted state before retrying; no automatic cross-App rollback is assumed. Keep full transcripts visible across sessions, with private grader keys/branch labels outside agent access. Check current Notes bodies as well as retained revisions and the attributable trace. MCP-only scope has no GUI workflow or screenshot claim.

**History count plan:** normalize to `Asia/Kolkata`, apply the stated first-session cutoff and count globally deduplicated represented activity dates, never export/generation times. Mail uses incoming `received_at` or outgoing `sent_at`; Messages likewise uses the direction's receipt/send field. Contacts has no activity-date contribution. Notes uses dated activity entries mapped to body locations and the version then available, or original authored revision `at` for an actual note edit. Tasks uses recorded work/night date, not an import timestamp. File-specific dates are in the workstream table. The manifest maps every counted record/row to stable source ID, loaded App ID, immutable version/hash and date field; version availability is checked separately from occurrence. Report missing/invalid dates and exclusions, per-source and global counts, earliest/latest dates and monthly distribution. Exclude future events, rollout actions, duplicate exports and incomplete records with reasons; older text-only history is reported separately. Demonstrate representative retrieval from the real loaded Apps. All quantities are plans until delivered records and the count script exist; shorter, relevant history is acceptable.

On the simulated timeline, tasks involving interaction with external platforms must start their first session **on or after 2026-01-01**, records of the user's interactions with external platforms must be dated **on or after 2025-01-01**, and text-only user history, such as personal background, past experiences, preferences and user–agent conversations, has **no earliest-date restriction**.

History on **at least 300 distinct dates is strongly recommended, not mandatory**, across the Task's selected sources. Shorter histories are valid when appropriate to the personalization challenge and environment dependencies. Explain the scope and report actual coverage. Reuse versioned Environment data where useful; count only selected history preceding the first session, not the entire Environment dataset. The Environment coverage window does not impose an end date on Task sessions/events. Follow the [history and verification guidance](../../docs/submission-evidence.md#4-task-history-depth); plan sources, time zone, cutoff and counting method now, and supply actual evidence after implementation.

- **Milestones, owners and dependencies (required):** I own records/snapshots, script, App integration, grader/reference, pilot, freeze and official batch, with Task Lead review; about four weeks after runner/Apps are usable. Related App work: [#131](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/131), [#103](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/103), [#12](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/12); use verified local contracts, not assumed PR status. Closest task mechanisms in the [proposal index](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/blob/proposal-index/proposals/proposal-list.md): #34 (comparison population), #263 (stale guide), #95/#113 (weather/personal context), #252/#127 (bounded delegation), #276 (harvest). This task combines condition-specific sensor calibration, correction of the agent's own work and private staffing history.
- **Resources and total effort (required):** 13-21 person-days. Local text tooling, no GPU or paid data. Twenty-one planned runs at 90k-140k visible tokens are 1.89M-2.94M counted once; billed context rereads, reasoning and reruns are extra. Provisional API allowance USD 80-350, to be replaced with measured pilot costs before the batch.
- **Scope boundary and open questions (required):** One night, one orchard; no real weather, hardware or payment. I will settle the public decoder or text-export fallback, loader, scheduler and hint placement before pilots. No second night is planned. A cautious runner choice may bypass calibration and earn substantial partial credit; if pilots fail qualification, report it and review the substantive design, without extra score gates or weight changes aimed only at a tier. Changed success criteria return to design review.
- **Data provenance and privacy (required):** Invented. The orchard, people, institutions, messages, readings, limits, run caps and pay rates are fictional, and the critical figures and offsets make no claim of agronomic accuracy. The desk briefs and logger readings are scripted records, not taken from any real service or sensor. Dilbar's heart condition is invented. No real private messages, phone numbers, medical records or third-party personal information are used, and no external assets are reused.

After approval, add the script, grader and author-run evidence against these deliverables in the same PR. Reviewers use the approved plan as the acceptance baseline; substantial scope changes require another design review. Follow the [implementation and validation guide](../../CONTRIBUTING.md#task-difficulty-and-validation).
