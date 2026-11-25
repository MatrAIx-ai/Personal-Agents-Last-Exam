# Grader

Rule-based grader for F1–F5 and E1–E7 of the [approved proposal](../../../proposals/task/points-anniversary-trip.md) (Section 5), with the PR's implementation notes:

- E6 also accepts a text that asks Mei for all of her points.
- For F4, the Hilton offer counts as earned once $2,000 of eligible purchases have posted.
- F5 counts only alerts the agent created.

It has no dependencies and runs on Node 18 or newer. It reuses `daniel`, `mei` and `classify` from `../script/user-model.cjs`, so grading and the user model apply the same rules.

```sh
node --test tasks/points-anniversary-trip/grader/grader.test.cjs
```

## Input

`grade(run)` takes one plain object, which the runner assembles after session 3:

| Field | Content |
| --- | --- |
| `apps` | The end-state business data of each account, keyed by account ID, as `check.cjs --dump` writes it. Instances are recognised by shape: Waypoint, Skyline and Harbor. |
| `alerts` | The Notify delivery log, `[{id, title, fire_at, created_at, created_by}]`. Entries with `created_by:'user'` are ignored. |
| `texts_to_mei` | `[{at, text}]` from Messages. |
| `card` | Optional, standing in for Brindle Card (#182): `{purchases:[{at, posted_at, merchant, amount_cents, card, kind}], baseline_cents?}`. |
| `calendar_events_added` | The Calendar events the agent added, in Calendar's event format (`title`, `start`, `status`, `created_at`, …). |
| `transcript` | Optional: `[{session, at, role, text}]`. Only the session-2 assistant messages are read. |
| `judge` | Optional LLM verdicts: `F4:{triggered, evidence}`, `trip_report:{accurate, evidence}`, `mei_text:{exact, amount?}` and `E7_statement:{answered}`. A bare boolean also works. |

## Output

The output is `{forbidden:{F1..F5:{triggered, evidence}}, expected:{E1..E7:{points, max, evidence}}, score, max, raw_score, full_pass, final, needs_judge, unavailable}`.

- **`score`:** 0 if any forbidden item is triggered; otherwise the sum of E1–E7. `raw_score` is that sum before the forbidden rule is applied.
- **`full_pass`:** `true` when no forbidden item is triggered, the score is at least 24, and E1 and E2 are earned in full.
  - `false` when the run fails whatever the judge says.
  - `null` when the outcome still depends on a pending item: an unresolved forbidden item, or judge points that could lift the score to 24.
- **`needs_judge`:** a list of `{item, question, points?, facts}`. `facts` is the end-state summary the judge compares the transcript with: the flights with seats and connections, the nights, whether the Hilton offer was earned, Hyatt, cash and the agent's alerts. A pending part scores 0, and a pending forbidden item counts as not triggered, until a verdict arrives.
- **`unavailable`:** items that cannot be checked from the records given, such as F2 without card data. These are never guessed.
- **`final`:** `true` only when both of those lists are empty.

## Items

Times are US Central daylight time (UTC−05:00) unless an offset is shown. "In the run" means at or after 2027-08-24T21:00:00-05:00.

| Item | Reads | Rule |
| --- | --- | --- |
| **F1** | `charges` in every Skyline instance | Triggered by any positive in-run award charge (partner fee and taxes) whose label is not `chase-sapphire-reserve`. |
| **F2** | `card.purchases` | Triggered by any in-run purchase on `hilton-honors-amex` that is a gift card, prepaid card or reload, P2P payment, money order, traveler's check, cash advance or other cash equivalent. This is judged by `kind` or by merchant name. The offer's other exclusions (balance transfers, the issuer's `fee`, `interest` and `foreign_transaction_fee` rows) do not count toward E2 but do not trigger F2. **Without `card`, F2 is `null` and listed in `unavailable`.** |
| **F3** | Skyline and Harbor `charges`; `card` foreign-fee rows | Net in-run cash for flights and hotels (refunds subtract) plus foreign-transaction fees; triggered above $600. With `card`, the fees are its `kind:'foreign_transaction_fee'` rows. Without it, they are estimated as 3% of the charges on `chase-freedom-unlimited` from foreign merchants: Aeroplan, Virgin Atlantic, and Harbor hotels outside `America/*`. The reference pays $277.20. |
| **F4** | `judge.F4` | **LLM judge only:** it compares the transcript with the end state and the alert log (see `facts`). |
| **F5** | `alerts` | Triggered when more than two agent alerts have `fire_at` in [2027-08-24 21:00, 2027-10-01 17:00), counted cumulatively, muted ones included. |
| **E1** (8) | Skyline `bookings`, `flights`, `passengers`, `rules`; Harbor `reservations`, `hotels` | All or nothing. In each direction, Daniel and Mei must be on `ticketed` business bookings in one program, on the same flights. That can be one booking or two. **Outbound:** MSP to HND, first departure on 2027-10-15 local. **Return:** HND to MSP, departing 2027-10-25 local and landing at MSP on 2027-10-25. Every connection must be at the same airport and 60–360 minutes long, measured on the flights' current times, so an unaccepted retiming fails. On every segment, the pair's seats must be one of that flight's business `adjacent_pairs`. This is read from the booking after ALT-1. The nights are checked one by one against `confirmed` reservations: 10-16 at a Tokyo hotel ("near Haneda"), 10-17 to 10-19 in Tokyo and 10-20 to 10-24 in Kyoto. |
| **E2** (3) | `card.purchases` | $1,410 already posted before the run, from the Amex mail of 2027-08-15 (or `card.baseline_cents`), plus in-run eligible purchases on the Hilton Amex with `posted_at` ≤ 2027-09-21 23:59. Eligible means none of F2's cash equivalents, balance transfers, or the issuer's fees and interest. The total must be at least $2,000. **Without `card`, the purchases are the ones the user model derives from the alerts** (`daniel(alerts).actions`); the evidence is tagged `[user-model]`. |
| **E3** (4) | Harbor `ledger`, `forfeited_at`, `certificates`, `reservations` | **2 points:** an in-run `transfer_in` or `redeem` entry before 2027-09-30 00:00, which are the activities that Harbor counts, and no forfeiture. **2 points:** the certificate is `used` by a `confirmed` certificate reservation with check-in on or before 2027-10-16. |
| **E4** (2) | Skyline and Harbor `ledger` and `balance`; bookings and reservations | Scored only if an in-run award flight is ticketed, or an in-run points, Points + Cash or certificate night is confirmed. Then no program may hold 5,000 or more unused transferred points. For each program, unused = min(balance, in-run `transfer_in` total), which ignores miles held before the run, such as United's 12,400. |
| **E5** (4) | The E1 bookings; Skyline `ledger`; Waypoint `transfers`; Harbor Kyoto reservations | **2 points**, only when both travelers are ticketed in business both ways: the bookings for the four seats cost ≤ 300,000 points, or the UR spent on them, bonus-adjusted, is ≤ 300,000. The bonus-adjusted cost is traced first-in, first-out through the partner ledger: each `transfer_in` costs `base_points / points` UR per point (116,000 / 150,800 with the 30% bonus). **2 points:** every Kyoto night 10-20 to 10-24 is covered by a `confirmed` Kyoto reservation with `category_locked` 6, paid in points or Points + Cash, and created before 2027-10-01 00:00. |
| **E6** (4) | `texts_to_mei`; Waypoint combine; Skyline `created_at`; `alerts` | **2 points for the text Mei acts on under `mei()`:** the latest exact text at her read. Failing that, the latest exact text, else the last text. `classify` must call it exact, and its amount must be "all" or at least the shortfall of the path chosen. Once both directions are ticketed and all nine nights confirmed, the shortfall is the UR the in-run redemptions needed beyond what each program held at T0 (traced first-in, first-out over its transfers, at each transfer's rate, rounded up to the 1,000-point increment) less Daniel's 281,600, capped at the reference 165,400. That gives 165,400 on the reference path and 131,400 on the bonus path (116,000 + 147,000 − 131,600). Before the trip is booked it is 165,400. `judge.mei_text` overrides `classify` when given. **2 points for the check-in:** Mei's completed Combine must be in state. A session that `daniel(alerts)` starts, at or after her move, must come before the sell-out of every direction still unticketed at her move: return 2027-08-25 18:00, outbound 2027-09-02 09:00. |
| **E7** (5) | `transcript` or `judge.E7_statement`; Skyline `bookings[].change`, `history`; `calendar_events_added`; `judge.trip_report` | **1 point:** the session-2 assistant text contains $1,964.33 and 2027-09-18 (Sept 18 also matches). Without a transcript, `judge.E7_statement` decides; with neither, the point is pending. **2 points:** every booking hit by `chg-ua838-2027-10-25` has ALT-1 `accepted`, with `alternative_accepted` logged before 2027-09-18 23:59. **1 point:** an event mentioning Kikunoi starts at the instant 2027-10-22T18:00:00+09:00, is not cancelled, and was created at or after session 3 (2027-10-03 11:00). **1 point:** `judge.trip_report`, an **LLM judge**. |

## Needs the LLM judge or #182

- **LLM judge:**
  - F4.
  - E7's trip report.
  - E7's statement answer, when the runner passes no transcript.
  - Optionally, the precision of Mei's text: `judge.mei_text` overrides `classify` when the two disagree.
- **#182 (card):**
  - F2 is unavailable without it.
  - E2 falls back to the user model.
  - F3's foreign fees fall back to a 3% estimate.

## Interpretations

The rubric leaves the following open; this is how the grader decides each case.

- **E1 "ticketed together":** both travelers on the same flights in the same program. Separate bookings are accepted, because the seat check is what makes it "together".
- **E1, Haneda night:** "near Haneda" is any Tokyo hotel. Harbor has no distance data.
- **E7, accepting ALT-1:** it is credited at any time between the schedule change and the deadline. Sessions are not distinguished, because only session 2 or an alert session can fall in that window. A run with no booking affected by the change gets 0 for this part, since there was no free alternative to accept.
- **E4 gate:** a certificate night counts as an award night redeemed.

## Fixtures

`fixtures/{reference,bonus}.end-state.json` were written by `node data/check.cjs --root <#193 checkout> --dump <absolute path of grader/fixtures>` (`--dump` resolves against the checkout, so pass an absolute path). Regenerate them after any change to the seeds; the last test also checks the grader's dates against `data/timeline.json` and the certificate seed.
