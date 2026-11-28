# Task Track proposal

**PR title format:** `[Task Proposal] [<Domain>] <Short task title>`

Example: `[Task Proposal] [Travel & commuting] Adapt an airport pickup after a flight change`

Copy this template to `proposals/task/<slug>.md`. Keep the persona, story and personalization insight concise. Section 5 defines how the task is scored. The construction plan defines the scope, deliverables, quality checks and effort that reviewers will follow through implementation and merge in this same PR.

Completed implementations use the [LifePack v1.0 task delivery format](../../docs/lifepack-task-format.md). This proposal defines the plan; the package and run evidence follow approval.

✍️ Replace each `[Fill in: …]` with your answer. Optional fields can be `None`. For unresolved details, use `TBD` and explain how they will be resolved. See the [worked example](../task/lena-spring-gathering.md).

## 1. Task and domains

- **Authors / GitHub handles (required):** [@IsThatYou](https://github.com/IsThatYou)
- **Short task title (required):** Plan a ten-ticket festival pass from the viewer’s own film diary
- **Primary domain (required):** Media & entertainment
- **Secondary domains (optional):** None

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

Who is the user? Briefly describe the background, preferences and prior experiences that matter to this task.

**✍️ Your answer (required):** Ines is a translator in Porto who takes the week of the Ribeira Film Days off every October. This year she bought a ten-ticket festival pass (email receipt, 10 September 2026). She keeps a film diary in Notes: one short entry per film since January 2023, under the title she saw the film under, in the form `Title (Director, year) — where; a line of comment`. The entries that matter here:

- **14 March 2025:** *Dom przypływów* (Tomasz Brenner, 2025), seen at a Polish film week.
- **21 June 2025 and 9 October 2025:** two walk-outs from films shot handheld from start to finish, because of motion sickness. The second entry adds that a single handheld sequence is fine.
- **8 October 2025:** ten minutes into a festival film she realised she had seen it earlier that year under its Portuguese title. “The catalogue only gives the English title. A ticket wasted. I don’t rewatch at festivals. Check by director next time.”
- **12 October 2025:** her festival wrap-up. When a film screens twice she takes the screening with the director Q&A, unless that costs her a film.
- **2 November 2025:** *Drivhussommer* (Annika Solheim, 2024), rented at home.
- **6 May 2023:** *Sal* (Marta Queirós, 2022). Queirós’s 2026 film is a different film.

On 20 September 2026 she messages her friend Dario, who will visit from Friday 9 to Sunday 11 October. She is saving the new Queirós film to see with him and will not see it without him. They will have dinner on Friday at 20:00 (already in her calendar). Since her knee surgery she wears a brace and needs “a good half hour” between Cine Aurora and Sala Miradouro because of the hill; fifteen minutes is fine to and from Teatro Cordoaria.

On 24 September 2026 the festival emails the programme, saved in Files as `ribeira-film-days-2026-programme.csv`: 45 screenings of 31 films, with English title, director, country, year, runtime, venue, start, end, a Q&A flag and a notes column. The email says that all venues are within a 15-minute walk of each other, that pass tickets cannot be exchanged or refunded, and that tickets for 6–8 October are released on 3 October at 10:00 and tickets for 9–11 October on 8 October at 10:00. On 26 September she writes a ranked watchlist of 18 programme titles in Notes, headed: “Ten tickets. Go down the list in this order; when two clash, the higher one wins; stop when ten fit.” All of these records exist before she asks for help.

## 3. Story outline

What does the user want, what changes, and what would a good outcome look like? Mention the approximate time span if relevant.

**✍️ Your answer (required):** Ines wants her ten tickets planned from her ranked watchlist and kept right as the festival changes. She books the tickets herself; the agent only plans. The festival runs from Tuesday 6 to Sunday 11 October 2026 and there are five sessions between 1 and 11 October. All times are in Porto (`Europe/Lisbon`, UTC offset `+01:00` on every date in the story).

Her watchlist, with the screenings in programme version 1. A Q&A adds 25 minutes to the runtime.

| Rank | Film (director, year, runtime) | Screenings | What her records say |
| :--- | :--- | :--- | :--- |
| 1 | The Salt Road (Ilse Vantongeren, 2026, 118 min) | Tue 6, 19:00, Aurora, Q&A · Thu 8, 14:00, Cordoaria | |
| 2 | Harbour Lights, Winter (Kenji Morisaki, 2026, 104 min) | Wed 7, 18:00, Miradouro, Q&A · Sat 10, 11:00, Aurora | |
| 3 | The Tide House (Tomasz Brenner, 2025, 97 min) | Wed 7, 15:30, Aurora · Fri 9, 21:30, Cordoaria | Seen on 14 March 2025 as *Dom przypływów* |
| 4 | Low Water (Marta Queirós, 2026, 101 min) | Fri 9, 17:00, Cordoaria, Q&A · Sun 11, 11:00, Aurora | To see with Dario |
| 5 | Paper Lanterns for Ana (Soo-min Ha, 2026, 92 min) | Tue 6, 16:00, Aurora | |
| 6 | Running Water Blues (Dezi Marlowe, 2026, 88 min) | Thu 8, 18:30, Aurora · Sat 10, 16:00, Miradouro | Programme note: “Shot entirely handheld” |
| 7 | A Field in August (Per Lindqvist, 2025, 110 min) | Thu 8, 16:00, Aurora | Programme note: “Handheld in the harvest sequence” (fine for her) |
| 8 | Nightbus to Faro (Caetano Brandão, 2026, 95 min) | Wed 7, 23:45, Cordoaria | |
| 9 | The Cartographer’s Daughter (Leila Haddad, 2026, 105 min) | Thu 8, 18:10, Miradouro, Q&A · Sun 11, 16:30, Cordoaria | Q&A starts 20 minutes after rank 7 ends at Aurora |
| 10 | Vesper Service (Anselm Krug, 2026, 118 min) | Thu 8, 21:00, Cordoaria | Moved in programme version 2 |
| 11 | Sleepwalkers’ Almanac (Yevhen Bondar, 2026, 96 min) | Sat 10, 23:59, Aurora · Sun 11, 13:30, Miradouro | |
| 12 | Ninety Days of Rain (Priya Venkataraman, 2026, 107 min) | Sun 11, 14:00, Aurora | |
| 13 | Glasshouse Summer (Annika Solheim, 2024, 91 min) | Fri 9, 14:30, Miradouro · Sat 10, 13:00, Cordoaria | Seen on 2 November 2025 as *Drivhussommer* |
| 14 | The Weight of Bread (Tomás Arriaga, 2026, 89 min) | Fri 9, 14:00, Aurora | |
| 15 | Saltmarsh Wedding (Oona Kettleby, 2026, 99 min) | Sat 10, 15:00, Cordoaria | Sells out on 8 October |
| 16 | Kite Season (Hamid Rostami, 2026, 84 min) | Fri 9, 21:45, Miradouro · Sat 10, 17:30, Aurora | Programme note: “Shot entirely handheld” |
| 17 | The Last Ferryman of Olhão (Duarte Seixas, 2026, 94 min) | Sat 10, 16:30, Miradouro | |
| 18 | Postcards from the Interior (Mireille Aubry, 2026, 102 min) | Fri 9, 11:00, Cordoaria | |

- **`2026-10-01T19:00:00+01:00` (session 1):** Ines asks: “The Ribeira programme is in Files and my ranked watchlist is in Notes. Plan my ten tickets and put each screening in my calendar. When each release opens I’ll book exactly what’s in the calendar. Pass tickets can’t be exchanged, so get it right. If you leave anything on my list out, tell me why. Don’t book anything yourself.”
- **`2026-10-03T10:05:00+01:00`:** the first release is open. Ines books every festival screening that her calendar shows for 6–8 October. The box office confirms by email two minutes later.
- **`2026-10-05T16:00:00+01:00`:** the festival emails a programme update, and the revised file is saved as version 2 of the same file. Three rows differ. One matters: Vesper Service moves from Thursday 8 October, 21:00, Teatro Cordoaria to Sunday 11 October, 17:00, Sala Miradouro. The email says tickets stay valid for a moved screening and cannot be exchanged.
- **`2026-10-05T18:30:00+01:00` (session 2):** Ines asks: “The festival sent a programme update. Does anything change for me?”
- **`2026-10-06T21:10:00+01:00`:** Dario messages that his flight has moved: he now lands on Saturday 10 October at 12:30 and stays until Monday. He suggests dinner on Saturday. Ines replies at 21:25: “Yes, Saturday at 20:00, same place. And the Queirós waits for you.” She moves the dinner in her calendar herself. She does not tell the agent.
- **`2026-10-07T23:45:00+01:00`:** she sees Nightbus to Faro, which ends after 01:00.
- **`2026-10-08T08:30:00+01:00` (session 3):** Ines writes: “No more midnight screenings: anything that starts after 23:00 is out. Release two opens at ten and I’ll book what’s in the calendar.”
- **`2026-10-08T10:05:00+01:00`:** she books every festival screening that her calendar shows for 9–11 October. The box-office email at 10:07 confirms each one, except that the pass allocation for Saltmarsh Wedding is exhausted.
- **`2026-10-08T10:20:00+01:00` (session 4):** Ines writes: “Saltmarsh Wedding was gone. What do I take instead? I’ll book it at 10:40.”
- **`2026-10-08T10:40:00+01:00`:** she books the one new festival screening that her calendar shows.
- **`2026-10-11T22:30:00+01:00` (session 5):** Ines asks: “Add the ten I saw to my diary, in my usual format.”

A good outcome is ten tickets for ten films that Ines can attend and has not seen, none shot entirely handheld, chosen in the order of her own list. The Tide House and Running Water Blues are never booked. After the programme update she keeps the Vesper Service ticket, The Cartographer’s Daughter drops out and The Weight of Bread comes in, not Glasshouse Summer. At the second release Low Water is on Sunday morning with Dario, Sleepwalkers’ Almanac is on Sunday afternoon, and Ninety Days of Rain gives way to Saltmarsh Wedding. When that is sold out, The Last Ferryman of Olhão replaces it, not Kite Season. The final ten are ranks 1, 2, 4, 5, 7, 8, 10, 11, 14 and 17.

## 4. What makes this distinct and personal

Focus on the single most important decision point in your story rather than repeating the full timeline. Keep **Personalization insight** to 1–2 sentences (under 240 characters; it appears in the public proposal list).

- **Personalization insight (required):** Ines’s ranked watchlist holds a film her diary shows she already saw under its original title, and one shot like the two she walked out of. She books whatever is planned, and pass tickets cannot be exchanged.
- **Decisive context and trigger (required):** On `2026-10-01T19:00:00+01:00` Ines asks for a plan from her ranked watchlist and says she will book exactly what the calendar shows. Rank 3, The Tide House (Tomasz Brenner, 2025), is the film in her diary entry of 14 March 2025, *Dom przypływów*, with the same director and year. Her entry of 8 October 2025 says the catalogue gives only English titles and that she does not rewatch at festivals. Rank 6, Running Water Blues, carries the programme note “Shot entirely handheld”, and her entries of 21 June and 9 October 2025 record two walk-outs from such films. All of these records are in Notes and Files before the request.
- **Generic assistant mistake (required):** It treats the watchlist as the full specification: it takes ranks 1 to 10 as written, uses the programme’s 15-minute walking time, and puts The Tide House (Wednesday, 15:30) and Running Water Blues in the calendar. Ines books The Tide House at the first release and one of her ten tickets goes to a film she has seen. It also plans The Cartographer’s Daughter at its Q&A screening, 20 minutes after a film at Cine Aurora, which she cannot reach in time.
- **Different user, different action (required):** Keep the request and the watchlist word for word. A viewer whose diary has no entry for Brenner’s film and no walk-outs should get ranks 1 to 10 as listed, with The Tide House and Running Water Blues in the calendar. For Ines those two are left out and ranks 11 and 12 come in. The explicit constraints of the request (ten tickets, book what the calendar shows, no exchanges) are the same for both users.

Keep the current request's explicit constraints fixed in this comparison. Older preferences or standing permissions cannot override a newer explicit spending limit, refusal or consent boundary.

## 5. Rubric, hint and reference solution

Define how the task will be scored before implementation. Exact weights and thresholds can be calibrated with pilot runs before the freeze. Adding or removing rubric items, or changing what counts as success, needs another design review. At implementation, each item becomes either a rule-based check or an LLM-judge question, keeping the same ID. A first submission does not need all of this settled: mark open parts `TBD`, and they are worked out with reviewers before plan approval.

### Rubric

List **forbidden** items (lines the agent must not cross; crossing any one fails the task) and **expected** items (what a good outcome achieves, with points). Do not list the same thing in both. For each item, give the evidence (where and when the agent can learn what is required) and the data the grader checks. Every requirement in Sections 2–4 must map to at least one item. Give the decisive outcome more points than the gap between the total and the pass mark, so an agent that misses it cannot pass. Check outcomes, not whether the agent copied the reference.

**✍️ Forbidden (required):**

- **F1 — A ticket for a film she has already seen.** No ticket is ever booked for The Tide House or Glasshouse Summer. Ines books exactly the festival screenings in her calendar, so either film in the calendar at a booking time triggers this. *Evidence:* diary entries of 14 March 2025 (same director and year as The Tide House), 2 November 2025 (same director and year as Glasshouse Summer) and 8 October 2025 (no rewatches at festivals; check by director). *Checked from:* the box-office booking record, by timestamp.
- **F2 — A ticket for a film shot entirely handheld.** No ticket is ever booked for Running Water Blues or Kite Season. A Field in August, with one handheld sequence, is allowed. *Evidence:* diary entries of 21 June 2025 and 9 October 2025; the notes column of the programme (24 September 2026 and later versions). *Checked from:* the box-office booking record.
- **F3 — Wasting a ticket she holds.** Once a ticket is booked, no later ticket is booked for a screening she cannot attend together with it (an overlap, or less than her transfer time between the two venues). The agent never deletes the calendar entry of a held ticket, except to re-enter it at the screening’s new time after a programme change, and never tells her to skip it. An entry that is deleted and later restored still counts. *Evidence:* Ines’s request (1 October 2026); the festival’s emails of 24 September and 5 October 2026 (no exchanges; a ticket stays valid for a moved screening); her message to Dario (20 September 2026) for the transfer time. *Checked from:* the booking record by timestamp, the ordered record of the agent’s Calendar tool calls, and the agent’s messages to Ines.
- **F4 — A midnight screening after she ruled them out.** After her message of `2026-10-08T08:30:00+01:00`, no ticket is booked for a screening that starts after 23:00. *Evidence:* Ines’s message (8 October 2026). *Checked from:* the box-office booking record.

**✍️ Expected (required):** 20 points.

Two terms are used below. A plan is *valid* when its festival entries are real screenings in the current programme version, of different films, none seen before and none shot entirely handheld; no two overlap; consecutive screenings leave 15 minutes between different venues and 30 minutes between Cine Aurora and Sala Miradouro; none overlaps the dinner in her calendar; Low Water is at a screening during Dario’s visit; and, from her 8 October message on, none starts after 23:00. The *ranking rule* is the heading of her watchlist: go down the list, keep a film if it still fits with the tickets she holds and the higher-ranked films already kept, and stop at ten tickets.

The grader computes the films that the ranking rule yields from the tickets Ines actually holds at that moment, by an exact search over the 18 ranked films. An agent that diverged earlier is therefore scored against its own state later. Any choice of screenings that gives a valid plan with those films is accepted. The films named below are the ones on the reference path.

- **E1 (7 points) — The right ten at the first release.** All or nothing. At `2026-10-03T10:00:00+01:00` her calendar holds exactly ten festival screenings that form a valid plan, and their films are the ten that the ranking rule yields: ranks 1, 2, 4, 5, 7, 8, 9, 10, 11 and 12. In a valid plan The Cartographer’s Daughter can only be on Sunday at 16:30 and Sleepwalkers’ Almanac only on Saturday at 23:59. *Evidence:* the watchlist note (26 September 2026); programme version 1 (24 September 2026); the diary entries named in F1 and F2; her messages with Dario (20 September 2026). *Checked from:* Calendar at that time.
- **E2 (1 point) — Q&A screenings.** In that plan The Salt Road, Harbour Lights, Winter and Low Water are at their Q&A screenings. Scored only if E1 is met. *Evidence:* diary entry of 12 October 2025. *Checked from:* Calendar at `2026-10-03T10:00:00+01:00`.
- **E3 (1 point) — Omissions explained.** Before the first release, a message to Ines says that The Tide House is left out because she saw it on 14 March 2025 under another title, and that Running Water Blues is left out because it is shot entirely handheld, so that she can overrule either. Scored only if E1 is met. *Evidence:* Ines’s request (1 October 2026); diary entries of 14 March, 21 June and 9 October 2025; the programme notes column. *Checked from:* the agent’s messages to Ines, against a fixed checklist of the two films and their reasons.
- **E4 (3 points) — Programme update absorbed.** At `2026-10-08T08:30:00+01:00`: (a) the calendar shows Vesper Service on Sunday 11 October at 17:00 in Sala Miradouro, and no longer on Thursday (1 point); (b) the festival entries for 9–11 October form a valid plan with the films that the ranking rule yields, which on the reference path means The Cartographer’s Daughter is out and The Weight of Bread is in (2 points). *Evidence:* programme version 2 and the festival’s email (5 October 2026); diary entry of 2 November 2025; her message to Dario (20 September 2026). *Checked from:* Calendar at that time and the booking record.
- **E5 (5 points) — The right plan at the second release.** At `2026-10-08T10:00:00+01:00`: (a) Low Water is on Sunday at 11:00, the only screening during Dario’s new visit (2 points); (b) the festival entries for 9–11 October form a valid plan with the films that the ranking rule yields, which on the reference path means Sleepwalkers’ Almanac on Sunday at 13:30, Ninety Days of Rain out and Saltmarsh Wedding in (3 points). *Evidence:* Ines’s message (8 October 2026); Dario’s message and her reply (6 October 2026); her message to Dario (20 September 2026); diary entry of 2 November 2025. *Checked from:* Calendar at that time and the booking record.
- **E6 (2 points) — Replacement after the sold-out notice.** At `2026-10-08T10:40:00+01:00` the Saltmarsh Wedding entry is gone, and the calendar holds one new festival screening that keeps the plan valid and is the next film that the ranking rule yields. On the reference path this is The Last Ferryman of Olhão on Saturday at 16:30. *Evidence:* the box-office email and Ines’s message (8 October 2026); the programme notes column; diary entries of 21 June and 9 October 2025. *Checked from:* Calendar at that time and the booking record.
- **E7 (1 point) — Accurate diary.** After the last session her diary has an entry for each of the ten films she holds a ticket for, with the date of its screening, and no entry for a festival film she holds no ticket for. Scored only if she holds ten tickets. *Evidence:* the box-office confirmation emails (3 and 8 October 2026); Ines’s request (11 October 2026). *Checked from:* Notes after the final session, against the booking record.

**✍️ Full pass (required):** no forbidden item is triggered and the score is at least 16 of 20. E1 carries 7 points and E5 carries 5, each more than the 4-point gap, so an agent that misses the first plan or the second release cannot pass. An agent that does nothing scores 0, because every expected item needs calendar or diary entries that only the agent creates.

### Hint

Write the exact hint text. The hint points to the records that hold the decisive facts. It may name a record’s source, sender and date. It must not quote or paraphrase what a record says, prescribe actions, or name a record that does not exist yet when the hint is shown. Hinted runs follow the validation rules in [CONTRIBUTING](../../CONTRIBUTING.md).

**✍️ Hint (required):** “Before you plan or change the plan in this session, re-read these records: Ines’s diary entries in Notes dated 14 March 2025, 21 June 2025, 8, 9 and 12 October 2025 and 2 November 2025; the heading of her watchlist note of 26 September 2026; the notes column in the most recent version of the programme file in Files; her messages with Dario from 20 September 2026 and the most recent ones in that conversation; her most recent message to you; and the most recent email from the festival.”

- **Injection:** appended once to the system instructions at the start of every session, with the same text in all five sessions and for all three models. The final position will follow the infrastructure release.

### Reference solution

Give one timeline that completes the task with a full score: what triggers each step, what the agent does, which record it relies on, the resulting state and the rubric items it satisfies. One complete path is enough; it does not need to cover every way the conversation could go. Then list other approaches the grader must accept.

**✍️ Reference (required):**

| Time | Trigger | Agent action | Relies on | Resulting state | Items |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `2026-10-01T19:00:00+01:00` | Ines’s request | Reads programme version 1, the watchlist, the diary entries for the watchlist’s directors, the messages with Dario and the calendar. Creates ten calendar entries: Paper Lanterns for Ana (Tue 16:00), The Salt Road (Tue 19:00, Q&A), Harbour Lights, Winter (Wed 18:00, Q&A), Nightbus to Faro (Wed 23:45), A Field in August (Thu 16:00), Vesper Service (Thu 21:00), Low Water (Fri 17:00, Q&A), Sleepwalkers’ Almanac (Sat 23:59), Ninety Days of Rain (Sun 14:00), The Cartographer’s Daughter (Sun 16:30). Tells Ines the plan, that The Tide House is left out because she saw it on 14 March 2025 as *Dom przypływów*, that Running Water Blues is left out because it is shot entirely handheld, and that The Cartographer’s Daughter is on Sunday without the Q&A because of the walk from Aurora to Miradouro. | Watchlist (26 Sep); programme version 1; diary (14 Mar, 21 Jun, 8, 9 and 12 Oct 2025); messages with Dario (20 Sep) | Ten festival entries; ranks 1, 2, 4, 5, 7, 8, 9, 10, 11, 12 | F1, F2, E1, E2, E3 |
| `2026-10-05T18:30:00+01:00` | Ines asks about the programme update. She holds six tickets (6–8 October). | Compares version 2 with version 1. Moves the Vesper Service entry to Sunday 17:00, Sala Miradouro, and keeps the ticket. The Cartographer’s Daughter on Sunday 16:30 now overlaps it, and its Thursday Q&A is still too soon after A Field in August, so removes that film. Passes over Glasshouse Summer, which she saw on 2 November 2025 as *Drivhussommer*. Adds The Weight of Bread (Fri 14:00). Tells Ines what changed and why. | Programme version 2 and festival email (5 Oct); booking confirmation (3 Oct); diary (2 Nov 2025); message to Dario (20 Sep) | Vesper Service on Sunday; ranks 4, 11, 12, 14 planned for 9–11 October | F1, F3, E4 |
| `2026-10-08T08:30:00+01:00` | Ines rules out midnight screenings; the second release opens at 10:00 | Re-reads the messages and the calendar: Dario now arrives on Saturday and the dinner is on Saturday at 20:00. Moves Sleepwalkers’ Almanac to Sunday 13:30. That overlaps Ninety Days of Rain, which ranks lower, so removes it, passes over Glasshouse Summer again and adds Saltmarsh Wedding (Sat 15:00). Moves Low Water to Sunday 11:00. Tells Ines before 10:00, including that Low Water loses its Q&A and that Dario needs a ticket for Sunday. | Ines’s message (8 Oct); Dario’s message and her reply (6 Oct); message to Dario (20 Sep); programme version 2 | Planned for 9–11 October: The Weight of Bread (Fri 14:00), Saltmarsh Wedding (Sat 15:00), Low Water (Sun 11:00), Sleepwalkers’ Almanac (Sun 13:30) | F3, F4, E5 |
| `2026-10-08T10:20:00+01:00` | Saltmarsh Wedding is sold out; Ines holds nine tickets | Removes the Saltmarsh Wedding entry. Passes over Kite Season, which is shot entirely handheld. Adds The Last Ferryman of Olhão (Sat 16:30, Sala Miradouro), which ends before the dinner. Tells Ines what to book and why. | Box-office email and Ines’s message (8 Oct); programme notes column; diary (21 Jun and 9 Oct 2025) | The Last Ferryman of Olhão planned; Ines books it at 10:40 | F2, E6 |
| `2026-10-11T22:30:00+01:00` | Ines asks for the diary entries | Reads the three confirmation emails and adds ten diary entries in her format, each with the date of its screening. | Confirmation emails (3 and 8 Oct); her earlier diary entries for the format | Ten new diary entries; ranks 1, 2, 4, 5, 7, 8, 10, 11, 14, 17 | E7 |

Throughout, the agent books nothing itself, never deletes the entry of a ticket she holds and never tells her to skip one (F3).

**✍️ Other accepted approaches (required):**

- Deleting and re-creating calendar entries instead of updating them, for screenings she holds no ticket for. For Vesper Service, replacing the Thursday entry with the Sunday entry in one step.
- Asking Ines on 1 October whether to leave out The Tide House and Running Water Blues, instead of leaving them out and reporting it, as long as neither is in the calendar at the first release unless she says so. Her scripted answer is “Leave them out.”
- Making the 8 October changes in any order, or asking Ines to confirm the Low Water change, as long as the calendar is right at 10:00. She confirms within minutes.
- Adding entries for released days in any order or over several turns, as long as the calendar is complete at each booking time.
- Writing the ten diary entries as ten notes or as one note with ten dated lines.

At implementation, the reference becomes a replayable sequence of tool calls, in the format set by the infrastructure release. The first accepted approach above is also run, to show that the grader accepts it.

## 6. Construction plan and effort

Specify the work needed to turn the story into an executable, scoreable task. Include expected coverage and effort in person-days; estimates may be ranges. The user rollout is the planned sequence of user interactions and responses, including branches. Fix what the user does at the decisive moment; other replies may depend on what the agent asks. Agent rollouts are actual model executions against that scenario.

**✍️ Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| :--- | :--- | :--- | :--- |
| Persona, history and workspace | Programme file with 45 screenings of 31 films (the 18 ranked films above and 13 others) and a version 2 with three changed rows. About 330 diary entries in Notes from January 2023 to September 2026, including the eight named in Section 2. About 45 messages in three conversations, about 20 emails (pass receipt, programme, newsletters) and about 15 calendar events. Planned history depth: at least 310 distinct dates. I count distinct local dates (`Europe/Lisbon`) across Notes, Messages, Mail and Calendar before the first session at `2026-10-01T19:00:00+01:00`, counting a date once across sources. The diary is text-only personal history, so its 2023–2024 entries are allowed. Every record of an external platform (festival and box-office emails) is dated 2026. | A script confirms that only the designed diary entries match a programme film by director and year, that every fact a rubric item relies on is in the record named in Section 5, and that the search in the grader finds one set of films at each of the four checkpoints. Actual date coverage is reported with the delivery. | 3–4 |
| User rollout and scenario script | **Sessions:** 5, on the timeline in Section 3<br>**Simulated world time span:** 20 September to 11 October 2026 for the story (sessions on 1–11 October), on top of history from January 2023<br>**Estimated total tokens:** 150k–300k per complete scenario, including dialogue, prior context, tool instructions and results (two programme versions, diary searches) and agent output; excluding private grading and separately billed reasoning<br>Use timestamps with UTC offsets for sessions and events (e.g. `2026-11-12T08:30:00-08:00`). | An executable user script. At the three booking times Ines books exactly the festival entries in her calendar for the released days, and the confirmation emails and the booking record follow from that. Her answers at the decisive moments are fixed: asked for something already in her records, she says it is in her notes and messages; asked whether to leave out a film for a stated reason, she agrees. Tickets held, the programme version and the dinner time carry over between sessions. | 2–3 |
| Environment integration | Reuse Files, Notes and Messages (`apps/`) and Mail and Calendar (`examples/apps/`) at the runtime version pinned at implementation. The agent may read all five, create, update and cancel festival entries in Calendar, create notes and message Ines; it cannot book, email the festival or message Dario. The box office is not an app: the user script writes the booking record and the confirmation emails. Missing platform pieces: a session runner with timed and conditional events, state across sessions and the user harness ([issue #135](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/issues/135), open, blocking for official runs). Calendar change history ([issue #139](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/issues/139)) is not needed, because F3 reads the agent’s tool calls. | Each run starts from the same records with no festival entries and no tickets. Real runs against the pinned apps show the programme read at both file versions, calendar entries created, moved and cancelled, a diary note created, and the three booking emails delivered. Calendar states at the four checkpoints, the booking record, outgoing messages and tool calls are saved for grading. No GUI workflow is planned. | 2–3 |
| Rubrics, reference and hints | Build the grader for F1–F4 and E1–E7, including the exact search for the ranking rule (18 films, at most two screenings each). Build the replayable reference and run two accepted alternatives: delete and re-create entries, and ask before leaving films out. | The reference scores 20 of 20 and triggers no forbidden item. Doing nothing scores 0. The generic plan (ranks 1 to 10 as written) triggers F1. A plan that uses the diary but the programme’s 15-minute walk fails E1. Both alternatives pass. Weights are frozen before the official runs. | 2–3 |
| Agent rollouts and analysis | **Pilot:** one unhinted run per designated GPT, Claude and Gemini model before the freeze; not counted.<br>**Official:** five unhinted runs and one hinted run per model: 18 runs. | Every run’s trace, score, settings and cost, with a failure analysis per rubric item, following the linked validation protocol.<br>Timestamp agent actions and observations on the same simulated timeline as the user script; record real execution dates and wall-clock duration separately. | 3–4 |

Estimate token volume for **one complete scenario across all sessions** and state what is included, such as dialogue, prior context and tool outputs. The simulated time span is the time elapsed in the user's world; development duration is recorded below.

On the simulated timeline, tasks involving interaction with external platforms must start their first session **on or after 2026-01-01**, records of the user's interactions with external platforms must be dated **on or after 2025-01-01**, and text-only user history, such as personal background, past experiences, preferences and user–agent conversations, has **no earliest-date restriction**.

History on **at least 300 distinct dates is strongly recommended, not mandatory**, across the Task's selected sources. Shorter histories are valid when appropriate to the personalization challenge and environment dependencies. Explain the scope and report actual coverage. Reuse versioned Environment data where useful; count only selected history preceding the first session, not the entire Environment dataset. The Environment coverage window does not impose an end date on Task sessions/events. Follow the [history and verification guidance](../../docs/submission-evidence.md#4-task-history-depth); plan sources, time zone, cutoff and counting method now, and supply actual evidence after implementation.

- **Milestones, owners and dependencies (required):** I ([@IsThatYou](https://github.com/IsThatYou)) do all workstreams, in this order: programme and history records, user script, app integration, grader and reference, pilot, freeze, official runs. I estimate 3–4 weeks once the platform pieces in [issue #135](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/issues/135) are available; that issue is open and blocks the official runs, not the records or the grader. The five apps are in the repository. Two environment proposals could replace task-owned parts later, and neither is required: Kinodex ([PR #226](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/226), in validation) for the film diary, and Seatline ([PR #45](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/45), plan approved) for ticketing. The fallback is the Notes diary and the scripted box office described above.
- **Resources and total effort (required):** 12–17 person-days. The scenario is text records and runs locally without a GPU or paid data. The 21 runs (3 pilot, 18 official) are estimated at 3M–6M visible tokens, plus reasoning and any reruns. API cost is TBD; I will estimate it from the pilot before the official batch.
- **Scope boundary and open questions (required):** One festival, one pass and one visiting friend. The agent never books; there is no seat choice, payment, map or travel service, and Dario’s own ticket is out of scope. Walking times are the programme’s figure and her message, not computed. Before implementation I will confirm with the Environment and Infrastructure Leads how a booking that depends on the calendar state is written in the timeline and user script, how sessions resume, where the hint is injected, and how a task sets Calendar write permissions. Difficulty is unproven: if any model scores 50% or more in the pilot, I will harden the task before the freeze (more two-screening films and more diary entries by the same directors) and ask for another design review if a rubric item changes.
- **Data provenance and privacy (required):** Invented. The festival, venues, restaurant, films, directors, people and all messages are fictional; Porto is used only as a setting. No real private messages, account details or third-party personal information are included, and no programme text, images or screenshots are taken from a real festival. At implementation I will search for collisions between the invented titles and names and real films or film-makers, and rename any that collide.

After approval, add the script, grader and author-run evidence against these deliverables in the same PR. Reviewers use the approved plan as the acceptance baseline; substantial scope changes require another design review. Follow the [implementation and validation guide](../../CONTRIBUTING.md#task-difficulty-and-validation).
