# Task data on the Points and awards Apps

Seeds and world events for this task on the [#193](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/193) Apps. App and account IDs are the environment's; program, airline, hotel and card names are the real brands the task uses. Amounts follow the pilot: 1 USD = 146 JPY, and the CAD 39 Aeroplan partner fee is USD 28.50.

| File | App | Role in the task |
| --- | --- | --- |
| `waypoint-daniel.seed.json` | Waypoint | Daniel's Chase Ultimate Rewards: 281,600 points, Mei in the household, Aeroplan, World of Hyatt, United and Virgin Atlantic as instant 1:1 partners, the 30% Aeroplan bonus from 2027-09-01 |
| `waypoint-mei.seed.json` | Waypoint (second instance) | Mei's Ultimate Rewards: 171,900 points. Only her own connection can combine them to Daniel |
| `skyline.seed.json` | Skyline | Daniel's Aeroplan account (0 points), Daniel and Mei as passengers, United flights MSP–SFO–HND and ANA flights via Chicago with seat maps, the award chart (ANA itineraries at 87,500), and the three card labels |
| `skyline-united.seed.json` | Skyline (second instance) | United MileagePlus (12,400 miles): the same United flights at 110,000 out and 98,000 back per person |
| `skyline-virgin.seed.json` | Skyline (third instance) | Virgin Atlantic Flying Club: ANA from Chicago only, 52,500 each way plus USD 286 in carrier surcharges, one seat |
| `harbor.seed.json` | Harbor | Daniel's World of Hyatt account: 41,200 points forfeited at 2027-09-30T00:00:00-05:00 without activity, a Category 1–4 certificate valid to 2027-10-16, seven hotels |
| `binding.json` | all | People and accounts shared by the instances |
| `timeline.json` | Skyline, Harbor | Sell-outs in every program (return 2027-08-25 18:00, outbound 2027-09-02 09:00), the Kyoto category change, the 2027-09-11 schedule change with ALT-1, its expiry, and the Hyatt forfeiture; each event names the account it goes to |
| `messaging/` | Messaging | Publisher configs for Daniel's and Mei's Waypoint accounts |

`build.cjs` is the single source; run `node build.cjs` after editing and `--check` to detect drift.

## Seats

Every segment of OPT-A1 (UA 1735 + UA 837 on 2027-10-15), OPT-R1 (UA 838 + UA 2210 on 2027-10-25) and ALT-1's UA 2386 has a free adjacent pair. On OPT-A1 and OPT-R1 the first free seats in order are not a pair, so an agent that books without choosing seats splits the couple and misses E1.

## Check

`check.cjs` replays the App-side steps of two paths over real MCP processes and Messaging, and checks the numbers the rubric relies on:

```sh
node tasks/points-anniversary-trip/data/check.cjs --root <checkout with runtime/ and the #193 Apps>
```

- **Reference** (39 checks): the comparison searches (Aeroplan, ANA at 87,500, United, Virgin), the return booked in session 1 with Daniel's own points, Mei's combine, the outbound and three Hyatt stays at 08:00 the next morning, both sell-outs, the Kyoto price lock, ALT-1 keeping the pair together, no forfeiture, $277.20 on the Reserve and no stranded points.
- **Bonus path** (44 checks), the first accepted alternative: the outbound on 2027-09-01 with 116,000 UR credited as 150,800 Aeroplan. At the end it also transfers 1,000 UR each to United and Virgin, delivered through each instance's own router.

`--dump <absolute dir>` writes each path's end state (every instance's business data at session 3) for the grader.

In both, each sell-out is checked on award seats nobody booked (ANA's one seat on Aeroplan, United's own space, Virgin's ANA seat): open one minute before the cutoff and gone at it. Every world event must have its expected outcome: committed, except the Hyatt forfeiture (`not_due` after the transfer) and United's copy of the schedule-change expiry (`not_found`, no booking there).

## Not covered here

- The workspace Apps (Mail, Calendar, Messages, Files, Notes, Contacts) are in `../workspace/`, and the user model is in `../script/`.
- The card account and the Hilton welcome offer: Brindle Card ([#182](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/182)).
- The Chase Travel portal quote (USD 13,680 cash or 1,368,000 points): no environment sells cash travel through a points portal.
- United's dynamic prices after the sell-outs (195,000 and up): Skyline has no price-change event, so United's business space sells out with Aeroplan's instead. Either way, no affordable seats remain.
