# Trip paperwork: Passage / ConfDesk → Mail, VisaSlot

From the repository root, run `npm run example:trip-paperwork` (or `node examples/workflows/trip-paperwork/run.cjs`). It uses temporary state and real public MCP processes for ConfDesk, VisaSlot, Passage and Mail plus Messaging, with no model API, installed packages or private host. It prints a report of 47 named checks and cleans up after itself. `registry.paperwork.json` assembles the four Apps; all clocks start at 2027-02-08T20:30:00-06:00.

The run follows the cross-App example in proposal [#192](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/192):

1. **Permissions.** No Agent connection lists an `env.*` operation or a publish/outbound tool. The Agent cannot issue a letter, hold an appointment, process a signature, deliver mail or advance time (`permission_denied`); the `scenario` profile cannot confirm a registration; a preview before the window opens is `registration_not_open`.
2. **History and reset.** Passage is loaded with the history before Mingyu asks (the fixture without `req-0142` and its notice) and Mail with an empty `mail-mingyu` mailbox; a `sandbox` reset restores the loaded Passage history, not the fixture.
3. **Appointment.** Competence gives Germany (6 nights against 5); the French booking is cancelled and the first German slot after the qual, 2027-03-31 09:00, is booked (`appt-0331`).
4. **Travel signature.** The current signature lapses on 2027-03-09. The Agent submits the request; Passage records `req-0142` due 2027-02-15, identical to the fixture's record and notice. An early `passage.request.processed` is `not_due`; on the due date Passage signs `sig-0142`, valid until 2028-02-15. Both notices reach Mail.
5. **Registration.** After `confdesk.registration.open`, a preview shows USD 720.00 and what it covers. Confirmed after 30 minutes it is `preview_expired` and nothing is recorded; a fresh preview is confirmed with the NPU travel card, and a used preview is `preview_used`. The confirmation reaches Mail.
6. **Wrong name and correction.** `confdesk.letter.issue` on the 10th business day prints `ZHOU Mingyu`, and Mail shows it. A visa file registered with it would fail `name_matches_passport` if held now. The correction is requested on 2027-03-10 and expected on 2027-03-26; the registration deadline keeps the paper and sends nothing; `confdesk.correction.issue` issues `letter-0388-c1` (`ZHAO Mingyu`), and the Agent finds it in the Mail inbox.
7. **Delivery guarantees.** A repeated publish returns the original receipt. A copy addressed to `mail-elise`, which has no Mail account bound in the run, is `recipient_unavailable`; a ConfDesk publisher granted only `mail-elise` is refused for `mail-mingyu` (`recipient_not_authorized`). Mail's version does not change.
8. **Visa file and hold.** The file is replaced with the corrected letter (version 2, nothing missing), with sources `confdesk:invitation_letter:letter-0388-c1`, `passage:travel_signature:sig-0142` and the hotel reservations `H-5521` and `H-5530`. `visaslot.appointment.held` at 09:00 on 2027-03-31 gives `complete` with `missing: []`; the file is locked, a replayed hold returns the original receipt and the file can no longer be replaced.
9. **Refused run.** In a separate run, the same appointment's file registers the original letter (`letter-0388`, `ZHOU Mingyu`). Held at the same time, it is `refused` with exactly one entry: `name_matches_passport`, expected `ZHAO Mingyu`, found `ZHOU Mingyu`.
10. **State.** Every App clock ends at the appointment time. ConfDesk has one registration, one payment, both letters and one correction. Mail holds exactly the five delivered notices and is otherwise its loaded seed; since that load only Infra deliveries and clock moves changed it.

Each delivery is checked from the receiver side: the router receipt targets `mail/mail-mingyu` and was applied at the notice's own time (the clocks are in step), Mail's record under the delivery event ID has the notice's CloudEvent ID as `thread_id`, the sender App, title and text, and Mail's `env.event_status` receipt names the same CloudEvent.

## How notices reach Mail

ConfDesk and Passage have no outbound tool. Each notice is written into the App's state with its Mail CloudEvent at `data.notices[].message` (Mail's `urn:pale:email-payload:1`, unchanged). The run's Infra side reads it from `env.snapshot` and publishes it with Messaging `router.publish` under that App's publisher identity. VisaSlot sends no mail.

Time is advanced only by Infra: each due event is applied at its time, then `env.advance_time` moves all four Apps to that time before the next action or delivery. Business-day events carry the computation each App checks against its own rule (`timeline.json`).

## Files

- `run.cjs`: the run, the Infra delivery step (`env.snapshot` → `router.publish`) and the receiver-side checks.
- `visa-file.cjs`: the visa file built from the ConfDesk letter and Passage signature the Agent read, and the hold event.
- `refused-run.cjs`: step 9.
- `confdesk-mail-config.json`, `passage-mail-config.json`: trusted publisher identities granting `mail-mingyu` on `channel.email`.
- `ungranted-config.json`: a ConfDesk publisher granted only `mail-elise`, for the refused grant.
- `timeline.json`: the times, the trip, the payment label and the business-day payloads.

Configs are trusted local run configuration. They name publisher identities and allowed recipients; production credentials do not belong in them.
