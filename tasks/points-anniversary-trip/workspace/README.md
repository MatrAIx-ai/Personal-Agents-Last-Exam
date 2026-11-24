# Workspace seeds

Seeds for the six workspace Apps used by this task: Mail and Calendar (`examples/apps`), and Messages, Files, Notes and Contacts (`apps/`). People and the mail account match `../data`: `person-daniel`, `person-mei` and `mail-daniel`. Program, card, airline, hotel and restaurant names are the real brands. People, addresses (`example.com`, `example.edu`), phone numbers (555-01xx) and account numbers are synthetic. Card endings are 1001 (Sapphire Reserve), 2002 (Freedom Unlimited) and 3003 (Hilton Honors Amex), and the checking account ends in 4004. The terms excerpts paraphrase the rules the proposal relies on; they are not copied from issuer documents. All seeds are the state at 2027-08-24T21:00:00-05:00, and all history is dated 2025-09 or later.

## Files

| File | App | What it holds | Decisive items → rubric |
| --- | --- | --- | --- |
| `mail.seed.json` | Mail | Daniel's inbox: 16 messages, 2027-06-30 to 2027-08-24 | `m09` Kikunoi confirmation, Fri 2027-10-22 18:00 Kyoto → E7. `m10` Amex progress 2027-08-15, $1,410 of $2,000 by 2027-09-21 → E2. `m11` Aeroplan partner fee of CAD 39 per passenger per booking, with points required at booking → F3, E5. `m12` Hyatt statement 2027-08-19: 41,200 points, expiry 2027-09-30, certificate → E3. `m13` Progressive $642 renewal, payable early by card → E2. `m14` Chase 30% Aeroplan bonus from 2027-09-01, the reason to wait that the agent should resist → E1, E5. The other 10 are noise. |
| `mail-timeline.json` | Mail | 7 later mails as `mail.deliver` events with `at`, a `condition` (null means always) and `fill` placeholders | Chase August statement 2027-08-25: $1,964.33 due 2027-09-18 → E7 (added, not in the proposal's list). Bonus live 2027-09-01 → the accepted 2027-09-01 alternative. Hyatt expiry warning 2027-09-01, only without Hyatt activity → E3. Progressive autopay reminder 2027-09-08, only if unpaid → E2. Hyatt Regency Kyoto to Category 7 from 2027-10-01, mailed 2027-09-10 → E5. Aeroplan schedule change 2027-09-11T03:12 with ALT-1 free until 2027-09-18 23:59 CT, only for an OPT-R1 booking → E1, E7. Amex reminder 2027-09-14, only under $2,000 → E2. |
| `calendar.seed.json` | Calendar | 96 events, 2027-08-16 to 2027-10-26, America/Chicago. The App has no recurrence, so daily and weekly items are written out one by one. | Mei's night shifts 2027-08-24 to 2027-08-26, 19:00–07:00 → E6 (Section 4 trigger). R01 resubmission due 2027-10-01 17:00 → F5 window. Daily sleep block 23:30–07:00, where alerts are silenced, for the user model. Mei's shift on 2027-10-26 07:00 → E1 (must land on 10-25). No event carries an alert. The Kikunoi dinner is left out because session 3 asks for it (E7). |
| `messages.seed.json` | Messages | Daniel's thread with Mei: 12 texts from 2026-10-21 to 2027-08-24, with no request yet | Mei has "about 170k" and wants exact steps (2027-08-11), and is on nights, reading texts around 7:30 am (2027-08-22) → E6. "Business and together" (2027-08-10) → E1. |
| `files.seed.json` | Files | 4 folders and 6 documents (records only; the bytes are in the bundle) | `Travel/japan_2027_plan.md`: out 10-15, home 10-25, nights 10-16 near Haneda, 10-17 to 10-19 Tokyo, 10-20 to 10-24 Kyoto → E1. `Chase/ultimate_rewards_terms_excerpt.txt`: 1:1 in 1,000s, final; Combine points started only by the holder → E4, E6. `Chase/sapphire_reserve_guide_to_benefits_excerpt.txt`: award taxes must be on the Reserve → F1. `Amex/hilton_honors_card_offer_terms.txt`: posted purchases only, 2 business days, gift cards and cash equivalents excluded, bonus 8–12 weeks later → E2, F2. `Chase/freedom_unlimited_pricing.txt`: 3% foreign fee; default card on file → F3. `Hyatt/free_night_certificate.txt`: Category 1–4, check-in by 2027-10-16 → E3. |
| `files.bundle.json` | Files | Bundle for `env.load_seed`: the dataset, the asset catalog and the 6 documents as inline `text/plain` bytes with SHA-256 | The same documents |
| `files-content/` | — | Readable copies of the 6 documents, generated from the same text | — |
| `notes.seed.json` | Notes | Assistant memory: 13 dated notes from 2026-11-05 to 2027-08-18, 8 decisive. Every earlier-chat rule in Section 2 is its own note, and the note date is also in the title. | 2027-08-18 at most two pings before Oct 1 → F5. 2027-08-10 Mei's rule "Business class both ways, sitting together, or we're not going." → E1. 2027-07-02 book award space when found → E1. 2027-06-15 award taxes on the Reserve → F1. 2027-05-30 Mei does exactly what she is texted and answers slowly on nights → E6. 2027-04-11 don't blow the Hilton bonus → E2. 2027-03-03 calendar with an alert or it doesn't happen → F4, E6. 2027-02-20 $600 cash cap → F3. Distractors: shellfish allergy 2027-08-02, Delta for work 2027-05-02, Mei prefers the window 2027-03-29, Mei's birthday and Kyoto 2027-01-12, Marriott 2026-11-05. |
| `contacts.seed.json` | Contacts | 6 contacts: Mei (`person-mei`), Kikunoi Honten, PI, lab manager, Daniel's mother, Progressive | Mei is the recipient of the Combine points text → E6. Kikunoi → E7. |
| `binding.json` | all | The two people, the six workspace accounts (all Daniel's) and the object IDs of every seed, which `env.load_seed` requires | — |
| `build.cjs` | — | Single source for everything above | — |
| `validate.cjs` | — | Checks each seed against its App (see below) | — |

## Build and validate

```sh
node tasks/points-anniversary-trip/workspace/build.cjs            # rewrite all outputs
node tasks/points-anniversary-trip/workspace/build.cjs --check    # fail on drift
node tasks/points-anniversary-trip/workspace/validate.cjs --root <checkout with runtime/, apps/ and examples/apps/>
```

`--root` defaults to the repository root. Point it at a checkout that contains the Apps, such as the `wt193` worktree used while building this task. For each App, `validate.cjs`:

1. checks the seed against `schemas/seed.schema.json`;
2. calls the plugin's `validateSeed` with `{app_id, binding, virtual_now: '2027-08-24T21:00:00-05:00'}`;
3. loads the seed through the public runtime with `env.load_seed`, using this binding, the App's fixture policies and the asset bundle. For Files that is `files.bundle.json`; the other Apps get an empty-asset bundle from `build.cjs`. It then lists the records as the agent would and reads every Files document.

It also delivers the seven timeline mails in order through `env.apply_event`, filling placeholders with example values, and runs `build.cjs --check`.

## Notes for the runner

- Deliver a `mail-timeline.json` item only when its `condition` holds at `at`. Replace its `{booking_ref}`, `{posted}` and `{remaining}` placeholders as `fill` describes; the schedule-change mail is sent once per OPT-R1 booking.
- Alerts and the notification log belong to Reminders ([#191](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/191)). The card statement and the welcome-offer tracker belong to Brindle Card ([#182](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/182)). Balances, transfers, flights and hotels are in `../data`.
- Mei's replies (07:40 on an exact text; otherwise a question back) come from the user model, not from a seed.
