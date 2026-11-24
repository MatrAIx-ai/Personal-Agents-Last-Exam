# Task data on the Points and awards Apps

Seeds and world events for this task on the [#193](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/193) Apps. App and account IDs are the environment's; program, airline, hotel and card names are the real brands the task uses. Amounts follow the pilot: 1 USD = 146 JPY, and the CAD 39 Aeroplan partner fee is USD 28.50.

| File | App | Role in the task |
| --- | --- | --- |
| `waypoint-daniel.seed.json` | Waypoint | Daniel's Chase Ultimate Rewards: 281,600 points, Mei in the household, Aeroplan and World of Hyatt as instant 1:1 partners, the 30% Aeroplan bonus from 2027-09-01 |
| `waypoint-mei.seed.json` | Waypoint (second instance) | Mei's Ultimate Rewards: 171,900 points. Only her own connection can combine them to Daniel |
| `skyline.seed.json` | Skyline | Daniel's Aeroplan account (0 points), Daniel and Mei as passengers, United flights MSP–SFO–HND with seat maps, the award chart, and the three card labels |
| `harbor.seed.json` | Harbor | Daniel's World of Hyatt account: 41,200 points forfeited at 2027-09-30T00:00:00-05:00 without activity, a Category 1–4 certificate valid to 2027-10-16, seven hotels |
| `binding.json` | all | People and accounts shared by the four instances |
| `timeline.json` | Skyline, Harbor | Sell-outs (return 2027-08-25 18:00, outbound 2027-09-02 09:00), the Kyoto category change, the 2027-09-11 schedule change with ALT-1, its expiry, and the Hyatt forfeiture |
| `messaging/` | Messaging | Publisher configs for Daniel's and Mei's Waypoint accounts |

`build.cjs` is the single source; run `node build.cjs` after editing and `--check` to detect drift.

## Seats

Every segment of OPT-A1 (UA 1735 + UA 837 on 2027-10-15), OPT-R1 (UA 838 + UA 2210 on 2027-10-25) and ALT-1's UA 2386 has a free adjacent pair. On OPT-A1 and OPT-R1 the first free seats in order are not a pair, so an agent that books without choosing seats splits the couple and misses E1.

## Check

`check.cjs` replays the reference solution's App-side steps over real MCP processes and Messaging, and checks the numbers the rubric relies on (30 checks):

```sh
node tasks/points-anniversary-trip/data/check.cjs --root <checkout with runtime/ and the #193 Apps>
```

It covers the two transfers to Aeroplan, both tickets with adjacent seats and $277.20 on the Reserve, Mei's combine, the Hyatt transfer and three stays (certificate, 63,000 and 125,000), both sell-outs, the price lock after the Kyoto category change, ALT-1 keeping the pair together, the Hyatt forfeiture that no longer applies, and no stranded points.

## Not covered yet

- Mail, Messages, Calendar, Files, Notes and the user model.
- The card account and the Hilton welcome offer: Brindle Card ([#182](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/182)).
- United, Virgin Atlantic and Chase Travel comparisons. Skyline prices one award chart per route, so the ANA options at 87,500 points cannot be priced apart from United's; they are left out.
- The 2027-09-01 bonus path (116,000 UR → 150,800 Aeroplan) is not yet in the check.
