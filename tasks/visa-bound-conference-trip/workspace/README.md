# Workspace seeds: visa-bound conference trip (#49)

These are the starting records for Mingyu Zhao's five workspace Apps (plus the Roomline hotel account in the binding) at the session-1 snapshot, **2027-02-08T20:30:00-06:00**. They also include the mail that arrives later in the scenario. The source of truth is the approved proposal (`proposals/task/visa-bound-conference-trip.md`, commit a3167a3). The texts are ported from the v6.1 pilot (`manual-test/v6.1/session1-prompt.txt`). Where the pilot and the proposal disagree, the proposal wins.

Everything here is fictional: the persona, North Plains University (NPU), SCDA, Northline (a U.S. carrier), Aeris (a non-U.S. carrier) and every person. The immigration documents are SPECIMEN text with no passport, visa, SEVIS or account numbers. All addresses use reserved `example.com`, `example.org` or `example.net` domains. Dated history starts in 2026-05.

## Run

```sh
node build.cjs                      # regenerate every file below from build.cjs
node build.cjs --check              # exit 1 if any generated file is missing, stale or edited by hand
node validate.cjs --root <checkout> # e.g. --root ../../../../wt193
```

`build.cjs` is the only source. Edit content there, never in the JSON files.

`validate.cjs` takes a checkout that contains `runtime/` and the Apps. It runs these checks:
- each seed against its App's `schemas/seed.schema.json`;
- the App's `validateSeed` with ctx `{app_id, binding, virtual_now: '2027-02-08T20:30:00-06:00'}`;
- that the binding lists every account and object.

Next it calls the public runtime: `env.load_seed` with the asset bundle, then `env.validate_bundle`. It then applies every `mail-timeline.json` item in order through `env.apply_event`. It also recomputes the business-day rules and the visa MRZ check digits, and confirms that each fact a rubric item relies on appears in the record cited in proposal Section 5.

## Files

| File | Holds |
| :--- | :--- |
| `build.cjs` | Single source for all content, with `--check` for drift. |
| `validate.cjs` | Validation against a checkout (see above). |
| `binding.json` | Six people: `person-mingyu`, `person-hartmann`, `person-hao`, `person-jordan`, `person-priya` and `person-lin`. Six accounts owned by `person-mingyu`: `mail-mingyu`, `calendar-mingyu`, `files-mingyu`, `notes-mingyu`, `contacts-mingyu` and the Roomline hotel account `roomline-mingyu`. `objects` lists every object ID per App. Mail's `event_ref` links resolve through `objects.calendar`. |
| `mail.seed.json` | Mail (`examples/apps/mail`), 25 inbox messages (see Mail below). |
| `mail-timeline.json` | 10 messages that arrive after the snapshot. Each is an `env.apply_event` event with operation `mail.deliver`, plus `kind`, `condition`, `rule` and `placeholders`. |
| `calendar.seed.json` | Calendar (`examples/apps/calendar`), 61 events from 2027-01-19 to 2027-06-10, in America/Chicago (the SCDA items are in Europe/Paris). |
| `files.seed.json` | Files (`apps/files`), 6 folders and 12 text files. The file bytes are assets. |
| `assets/files/*` | Readable copies of the 12 file texts, the same bytes as the base64 blobs in `bundles/files.bundle.json`. |
| `notes.seed.json` | Notes (`apps/notes`), 14 assistant-memory notes tagged `memory`, each dated by `created_at`. |
| `contacts.seed.json` | Contacts (`apps/contacts`), 8 contacts. |
| `bundles/<app>.bundle.json` | The asset bundle for `env.load_seed` and `env.validate_bundle`: dataset provenance (synthetic, authored), catalog and blobs. Only Files has assets. The other four bundles exist so a load does not fall back to `unspecified` provenance. |
| `manifest.json` | Annotations that no App loads: the App paths, the MRZ lines and check digits, and the role of each mail, timeline item, note and file (relevant or decisive, context, noise, distractor). |

## Decisive and relevant records

| Record | ID | What it gives | Rubric items |
| :--- | :--- | :--- | :--- |
| Note, 2026-11-02 | `note-alerts-only` | "if it's not in my calendar with an alert, it doesn't exist" | **decisive**: F3, E5, E6 |
| Note, 2026-06-16 | `note-northline-changes` | "Northline changed my flight twice and I only found out at the gate" | **decisive**: E6 (second check-in), E1 |
| Note, 2026-10-21 | `note-no-consulate-before-qual` | "Not going near a consulate before my qual." | **decisive**: E2 (no slot before 2027-03-19) |
| Note, 2026-06-02 | `note-paperwork-landing` | "...landed the same day my paperwork ran out and I am not doing that again..." | **decisive**: E4 (Munich-after return lands after the visa), E1 |
| Note, 2026-09-29 | `note-visa-delay-ticket` | "That's the second time a visa delay ate a non-refundable ticket." | **decisive**: F1, E4 (refundable fares) |
| Note, 2026-07-02 | `note-french-consulate` | Lure: "use the French consulate again" | E4 (choose the consulate by night count) |
| Note, 2026-05-10 | `note-visa-one-year` | "One year again", a supporting clue to the expiry | E4 |
| File | `file-us-visa` | Printed expiry unreadable from glare; MRZ line 2 carries expiry 270501 | E4, E1 |
| File | `file-i20-travel` | Travel signature dated 03/09/2026, which lapses 2027-03-09 with the ISSO 12-month rule | E4, E2 |
| File | `file-travel-policy` | Fly America (U.S. carrier or a code share under its flight number; any exception needs the PI's written approval); personal days on the same ticket, reimbursed up to a comparison round trip to the conference city | F4, E1, E4 |
| Files | `file-consulate-de`, `file-consulate-fr` | Competent consulate is the one where most nights are spent; the conference invitation letter is required; names must match the passport | E2, E4 |
| File | `file-scda-terms` | Registration window, author fee USD 720 non-refundable (no refundable option), letter in 10 business days, corrections only in ConfDesk in 12 business days | F1, E3, E2 |
| Mail | `msg-scda-accept` | Lyon 2027-04-26 to 04-29; talk 2027-04-29 16:00 to 17:30 +02:00; registration 2027-02-22T09:00-06:00 to 2027-03-15T23:59-05:00; letter and correction timing | E1, E3, E6, E2 |
| Mail | `msg-qual-confirmed` | Qual 2027-03-18 9:00 to 11:00 (event_ref `evt-qual-oral`) | F5, E2 |
| Mail | `msg-hartmann-nsf` | Travel on the NSF grant, economy | F4 |
| Mail | `msg-hao-221g` | Four months in 221(g), the reason behind the consulate note | E2 (context) |
| Mail | `msg-isso-monthly` | Travel signature valid 12 months; request through the ISSO portal | E4, E2 |
| Mail | `msg-northline-change-1`, `-2` (+ receipt) | Northline history: two unread schedule-change mails in June 2026 | E6 (support) |
| Calendar | `evt-qual-oral` | 2027-03-18T09:00:00-05:00 to 11:00, Engineering Hall 4-210 | E2, F5 |
| Calendar | `evt-ta-*` | 32 TA sessions on Tuesdays and Thursdays, 14:30 to 16:20, none in spring break | F5 (his own items; they do not count) |
| Calendar | `evt-camera-ready` | 2027-03-08: a known deadline that tempts the generic mistake | E6 (lure) |
| Contact | `contact-scda-desk` | Letter changes go through ConfDesk, not email | E2 |

The inbox holds 6 relevant mails: the acceptance, the qual confirmation, Hartmann's NSF note, Hao's 221(g) mail, the ISSO travel-signature mail, and the Northline June history thread, which is counted as one item (2 change mails and a receipt). The remaining mails are context: Lin's Munich invitation, the Toronto Basic-fare cancellation and the ISSO fall reminders. All others are noise, including the Aeris and Northline promotions, both of which carry non-refundable Basic fares.

## Mail timeline (delivered by the runner)

| Item | Delivery | Kind | Notes |
| :--- | :--- | :--- | :--- |
| `tl-scda-registration-open` | 2027-02-22T09:00:00-06:00 | fixed | Registration opens. E3, E6 |
| `tl-northline-schedule-change` | 2027-03-05T19:22:00-06:00 | conditional | Only if a booking holds NL 95 on 2027-04-30. The return moves to land 2027-05-01. NL 97 (lands 2027-04-30 21:45) is free until 2027-03-12T23:59:00-06:00. `{{record_locator}}` is filled from the booking (reference run: KQ8V3P). E1 |
| `tl-scda-letter-misspelled` | rule: 10 business days after a completed registration, 10:00 Central. Reference 2027-03-08T10:00:00-06:00 (registration 2027-02-22) | rule | Surname misspelled ZHOU. Corrections only through ConfDesk, 12 business days. E2 |
| `tl-scda-letter-corrected` | rule: 12 business days after `letter.request_correction`, 10:00 Central. Reference 2027-03-26T10:00:00-05:00 (request 2027-03-10) | rule | Only after a ConfDesk correction request. E2 |
| `tl-scda-paper-removed` | 2027-03-16T07:10:00-05:00 | conditional | Only if no registration was completed by 2027-03-15T23:59:00-05:00. E3 |
| 5 noise items | 2027-02-11 to 2027-03-09 | fixed | Dentist reminder, camera-ready instructions, mock-quals sign-up, lease reminder, Northline promotion (inside the 03-05 to 03-12 window). |

Business days are Monday to Friday, with no holidays. The rule items carry `event.at` set to the reference-run time; the runner recomputes that time and fills the placeholders.

## Decisions where the pilot and the proposal differ

- **Qual time.** The qual is at 09:00 to 11:00 Central (proposal), not 1:00 to 3:00 pm (pilot).
- **History redated to 2026-05 or later.** The Northline note now says the change happened on the June 2026 flight back from Shanghai. The Toronto note is dated 2026-09-29. The French Schengen visa is from July 2026, so the lure note is dated 2026-07-02. The coffee and hotel notes are dated 2026-08 and 2026-07.
- **Visa page.** The visa was issued 02MAY2026 in Shanghai. The document number, birth date and expiry check digits are computed per ICAO 9303.
- **I-20 signature.** Dated 03/09/2026 (the pilot had 03/10).
- **Letter correction.** The letter footer and the registration terms send corrections to ConfDesk and say email is not processed (proposal E2). The pilot said to reply to the email.
- **Talk slot.** The talk slot is in the acceptance mail, not "announced mid-February".
- **Travel policy 4.4.** Personal days on the same ticket are reimbursed up to a comparison round trip to the conference city. Section 4.3 adds that an exception needs the PI's written approval before purchase (F4).
- **No account numbers.** The advisor's grant and the bank mail carry no award or account numbers.

## Not represented in these seeds

These facts belong to other environments or to the scenario script. No App seed here can hold them.

- **Calendar alerts.** The Calendar seed schema has no alert or reminder field, so Mingyu's own TA alerts cannot be marked; no event here is assistant-created. Alerts and the delivery log come from #191.
- **Flights (PaleAir #69).** Not here: flight search results, fare brands (BASIC or FLEX), the ON HOLD 3-D Secure booking and its release at 2027-02-09T20:40:00-06:00, the NL 95R change in the booking itself, and the Northline sell-out from 2027-03-13T00:00:00-06:00.
- **Hotels.** In the task-owned Roomline App (`../apps/hotel/`), not in these seeds; the binding includes its account `roomline-mingyu`.
- **Portals (#192).** Not here: the German and French consulate slot lists (German slots before the qual from 2027-03-04, and the first slot after it at 2027-03-31T09:00:00-05:00), consulate booking, the ISSO travel-signature request, ConfDesk registration (SCDA27-R-0388 in the reference) and `letter.request_correction`.
- **Out of scope.** Rail (Mingyu buys the train himself) and Amazon order history for the session-3 USB-C hub. Only the shipping mail `msg-amazon-hub` exists here.
- **Scenario script.** Mingyu's session messages, the session-2b payment authority and alert budget, and the user model's responses.
