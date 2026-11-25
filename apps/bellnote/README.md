# Bellnote

Bellnote is a resettable school–family portal, seen from one guardian's account. The school accepts whatever a permitted guardian submits before its cut-off, so an action the portal accepts can still be wrong for the family; Bellnote records enough to check that: which children, rights, lists, forms, menus and balances were read; what was reported, signed, declined, withdrawn, paid or changed, for which child and how long before each cut-off; what the office, the cafeteria and the other guardian did; and what the account was told.

- App ID `bellnote`, version 1.0.0, Core API 1.2.0, public runtime 1.6.0. Node.js 18+ built-ins only; nothing to install.
- Approved scope: [`proposals/environment/bellnote.md`](../../proposals/environment/bellnote.md). Validation, workflow-to-test mapping and the acceptance self-review: [VALIDATION.md](VALIDATION.md).
- A guardian web GUI (`gui/`) served by the repository's shared Web Host, added after plan approval at the maintainers' request (the approved plan said MCP-only); see [Web GUI](#web-gui). There is no staff or reviewer console: staff, the cafeteria and the other guardian act only through events.
- Everything is fictional: the Merrow Vale Unified School District, Alder Elementary, Kestrel Ridge Middle School, the families and staff. Phone numbers use the 555-01xx range. Workflow shapes were informed by public product pages of ParentSquare and the PowerSchool parent portal; no data, text, branding or icons were taken from them.

## Workflows

| Workflow | Agent operations | Events that change it |
| --- | --- | --- |
| W1 Attendance and absence reports | `attendance.list`, `absences.list`, `absences.report`, `absences.cancel` | `attendance.marked`, `absence.reviewed` |
| W2 Forms and permission slips | `forms.list`, `forms.get`, `forms.respond`, `forms.withdraw`, `payments.list` | `form.published`, `form.changed`, `form.answered` |
| W3 Pickup authorization and dismissal changes | `pickup.get`, `pickup.person_add`, `pickup.person_remove`, `dismissal.set`, `dismissal.cancel` | `pickup.person_reviewed`, `dismissal.recorded` |
| W4 Lunch account | `lunch.account_get` (the ID is each child's `lunch_account_id` in `children.list`), `menu.list`, `lunch.topup`, `lunch.settings_update` | `lunch.charged` |
| Account | `children.list`, `schools.get`, `notifications.list`, `preferences.get`, `preferences.update` | `school.day_changed` |

All 23 tools are `bellnote.<name>` (12 reads, 11 writes). Every write takes Core's `request_id` and `expected_version` (`{epoch, revision}`) and returns the object's `id` with the committed version. The object state in a write result is `state` (Core owns `status: committed`). The target is always the argument `id` (for a new report, change or answer: the child or form it is about, with `child_id` beside it for forms); a window is always `start` / `end` as `YYYY-MM-DD` dates. Errors: `not_found`, `not_permitted`, `not_yours`, `too_late`, `not_school_day`, `conflict`, `invalid_window`, `invalid_time`, `invalid_state`, `closed`, `already_answered`, `missing_answer`, `stale_form`, `payment_declined`, `amount_out_of_range`, `not_authorized_person`, `restricted_person`, `pending_review`, `in_use`, `invalid_arguments`; Core adds `permission_denied`, `stale_version` and `idempotency_conflict`. Any refused event is `invalid_event` with data and clock unchanged.

### Rules worth knowing

- **Rights are per guardian and per child** (`custodial`, `can_sign`, `can_pay`, `can_pickup`) and come from the seed. `custodial` is needed to report absences and to see or change who collects the child; `can_sign` to answer forms; `can_pay` to pay a fee, top up or change lunch settings. The other guardian's `form.answered` signing a form with a fee also needs their `can_pay` for that child.
- **A guardian who is not custodial for a child learns nothing of that child's pickup list.** `pickup.get` is refused, `children.list` omits the child's `default_dismissal` (the key is absent, not null), and no pickup or dismissal notification is written for that child (`dismissal.recorded`, `pickup.person_reviewed`, `dismissal.void`); a `school.day_changed` notice for that child's school carries no pickup detail. The events are still applied and logged in the activity rows.
- **Cut-offs are explicit rules resolved to dated instants.** A district policy (with per-school overrides) holds `absence_cutoff_local` and `dismissal_change_cutoff_local`, each either `{"anchor":"fixed","local_time":"08:30"}` or `{"anchor":"dismissal","minutes_before":90}`. `schools.get` shows the resolved instant for every day in the district's IANA time zone, so a daylight-saving change and an early dismissal (which moves a dismissal-relative cut-off) are both handled; the cut-off instant itself is already too late. A full-day absence uses that day's absence cut-off; a late arrival can be reported until the stated arrival time and an early leave until the stated leaving time (the time must be inside that day's school hours).
- **A restriction is matched by `person_id`, never by name.** `pickup.person_add` maps a person to one canonical ID: a supplied `person_id` is used as is; otherwise a phone number the school already holds (digits only, a leading country code 1 ignored) resolves to that person; otherwise a new school-held person record is created. A supplied `person_id` cannot take a phone number the school holds for someone else (`conflict`, or `restricted_person` when that number belongs to a person restricted for the child), so no other person's details are attached to the entry. The display name never decides identity, so a restricted person under another name is still refused, and a namesake with a different number is not.
- **Dismissal changes by either custodial guardian.** `dismissal.set` replaces the day's active change whoever recorded it, and `dismissal.cancel` cancels it the same way: both guardians are custodial and the school keeps one plan per child and day (the plan is silent on this; forms differ because an answer is the signer's own and `forms.withdraw` refuses another guardian's answer with `not_yours`).
- **Moot days.** Each day of a report reads `moot` when it became a closed day, or, for a late arrival or early leave, when an early dismissal moved the end of the day to or before the reported time; the whole report reads `moot` only when every day is moot, and otherwise lists its `moot_dates`. A dismissal change on a closed day reads `moot`.
- **Forms list phase** is `closed` once the due time passes; otherwise `answered` when every child in scope (one child with `child_id`, else every addressed child) has a signed or declined answer (a `needs_review` answer does not count), else `open`. `accepting_answers` tells whether answers are still taken.
- **Daily spending** for `over_daily_limit` is the day's purchases net of same-day meal refunds credited to the balance.
- **Time is the environment's.** Bellnote has no timers or clock event. A form's `closed`, a dismissal change's `past`, a passed cut-off, an expired card (after the last day of its expiry month), `moot` on a closed day, `restricted_item`, `over_daily_limit` and `excluded_for` are derived at read time from stored records and `ctx.virtual_now`, never stored.
- **Notifications are for what other people did**, never for the guardian's own writes and never for the passing of time. Their text names people, days ("Tuesday, November 17") and local times and never shows a record ID. Refusal messages are written the same way, except that a refusal of an ID the caller sent that the account does not hold (a child, form, payment method, school-held person or form question) repeats that ID back. When `email_notices` is on at that moment, the notification also stores the full Mail wire message.
- **The activity log** has one row per committed Agent write, one per applied event and one per effect of that event (`effect.form_response.needs_review`, `effect.dismissal_change.void`, `effect.notification.written`), each with sequence, virtual time, actor, action, child, object ID and the `request_id` or `event_id` behind it. A replay, a refusal or a clock move writes none.

## Data

`fixtures/reference.json` is the package seed: one account (`bellnote-maya`, owner `person-maya`) with three children across two schools and two other guardians, loaded at Tuesday 2026-11-17, 07:00 in America/Los_Angeles. It holds 879 records (444 KB pretty-printed, 294 KB as the compact JSON Infra sends; no media) in two parts.

- **The 2026–27 school year, hand-written**: six pickup people in every state and one restriction, 120 attendance records from 21 September with six reports, ten forms and fourteen responses (every kind and state, four with fees), three lunch accounts with 84 transactions (each opening with the balance carried over on 26 August), four weeks of menus with allergen tags, two payment methods (one expiring in November 2026), eight payments, five dismissal changes and 34 notifications (`ntf-0001` to `ntf-0034`, one for every event these records imply, in the App's wording).
- **The family's earlier history from 2025-01-01, generated.** The environment timeline has two dates: history starts on 2025-01-01 and the task window on 2026-01-01; the maintainers moved the history floor to 2025-01-01 after the plan was approved, so the reference now carries the spring of 2025 and the 2025–26 school year, with the summer breaks between. `scripts/history.cjs` generates it with a fixed seed (20250101; mulberry32, no clock, no `Math.random`), and `scripts/build-reference-fixture.cjs` puts it in front of the hand-written year, so rebuilding gives byte-identical output (`npm run fixtures:history`, also part of `npm run fixtures:check` and `npm test`). It follows the district calendar of each year (winter, mid-winter and spring breaks, holidays, early dismissals, and three unplanned changes announced to the family: an Alder power-outage closure, an Alder heating-failure early dismissal and a Kestrel water-main closure) and where each child was: Theo in grades 1 and 2 at Alder; Ines from kindergarten in August 2025; Nico in grade 5 at Alder until June 2025 and grade 6 at Kestrel after. It adds 27 attendance exceptions (absences, late arrivals and early leaves) with 14 reports by Maya or Dana (reviewed excused or unexcused, one cancelled before its cut-off) and 8 unexplained marks; 18 forms with 23 answers by Maya, Dana and Sam (one form changed to version 2 and signed again with no second charge, one fee refunded on withdrawal, one form never answered); a babysitter on Theo's and Ines's pickup lists (approved, then removed in June 2026) and 30 dismissal changes for those two children (some replaced by Dana or cancelled); 192 lunch transactions (159 purchases from that day's menu, mostly on Fridays, 22 top-ups (most of them after a low-balance notice), two refunds of a double charge, and a year-end rollover each June), 111 menu days, 26 payments and 88 notifications. Generated records have their own ID series (`rep-h0001`, `fr-h0001`, `tx-h0001`, `pay-h0001`, `ntf-h0001`, `dc-h0001`, `pp-h0001`, `form-2025-…`, `form-2526-…`), so new IDs the App assigns are unaffected.

What the generated history respects: school-day records fall only on school days of that year's calendar at the school the child attended then; rights are the seeded ones (Maya is not custodial for Nico and cannot sign for him, and Dana cannot pay for Ines), so the history holds no report, dismissal change or pickup person for Nico and no notification about his pickup; no restricted person and no pickup person outside the period they were approved is named; purchases avoid each child's restricted allergens; balances never pass the debt limit; each June the year-end rollover moves the balance to the next year, and the 2026 rollover equals the hand-written carry-over of 26 August 2026, so the balance at the start of the hand-written year is exactly what the generated top-ups, purchases and refunds produce. The child record holds only the current school and grade, so earlier grades and Nico's earlier school show in the dated records (Alder's office marks Nico's 2025 attendance; form titles name the grade). The App's calendar holds only the current term, so the earlier years' calendars live in `scripts/history.cjs` and are used by the checks. The earlier years keep attendance exceptions only (absent, late, left early), not a mark for every present day, to keep the state Core validates on every call small. `fixtures/minimal.json` is the smaller account the business tests start from and has no generated history; tests build their variations from it in code.

`scripts/check-fixtures.cjs` checks both fixtures beyond `validateSeed`: ledgers, payments, restrictions, form versions, school days for every dated record, allergen tags, fictional phone numbers, every date on or after 2025-01-01, the size budget (under 1 MiB pretty-printed and 384 KiB compact), the declared record count and the builder match. It also applies the App's own rules to every record of both fixtures, hand-written and generated alike: reports, pickup people and dismissal changes only by guardians with custodial rights and before their cut-offs; answers only by guardians who can sign, and a fee only by a guardian who can pay; collectors approved at the time and never restricted; top-ups inside the school's range; one notification for every event the records imply (none of a non-custodial child's pickup list); notification text with names and long dates, never a record ID, an ISO date or a field name. For the reference it also runs the generator's own checks (earlier calendars and enrollment, purchases from that day's menu, ledger rollovers, low-balance notices against the crossings of the whole ledger) and reports the size of the reads that take no window. A task supplies its own seed with `env.load_seed`; `validateSeed` rejects duplicate IDs, dangling references, a child without a guardian link for the account holder, a person both listed and restricted for the same child, two active dismissal changes for one child and day, a response whose version the form never had, a balance that does not equal the sum of its transactions, timestamps without a UTC offset and an account the binding does not declare.

**Reads with two years of rows.** Windowed reads keep their defaults (`attendance.list` and `lunch.account_get` the last 14 days, `notifications.list` 30, `payments.list` 60, `pickup.get` and `schools.get` the next 14, `menu.list` the next 6; at most 120 days), so a read without a window returns the current period. Two reads have no window in the approved plan and now list the earlier years too: `absences.list` (20 reports, 14.7 KB) and `forms.list` (28 forms, 25.1 KB). Reports and forms of earlier years read as they ended (reviewed, cancelled, closed); a report day before the current term is not `moot`. The GUI shows the current school year by default and folds earlier reports and closed forms under "Earlier school years".

`tools.json`, `schemas/seed.schema.json`, `schemas/events.schema.json` and `schemas/state.schema.json` are generated from `scripts/build-contracts.cjs` (`npm run contracts:check` in this folder detects drift). The other schema files are copies of the public shared contracts kept in sync by the repository's `npm run contracts:check`; `schemas/router-message.schema.json` is a byte-identical copy of Mail 1.3.0's generated wire schema.

## Web GUI

`gui/index.html` and `gui/src/app.js` are a guardian portal with seven views: Home, Attendance, Forms, Pickup & dismissal, Lunch, Notifications and Account. Every Agent write tool has a control in its view; the page reads and writes only through the Agent MCP connection of one run, so rights, visibility and refusals are the App's. `contribution/gui.json` declares the legacy reviewer renderer (`gui/src/view.js`) and the `pale.web` extension (`status: implemented`). Start it from the repository root:

```sh
node runtime/web/server.cjs --app bellnote --registry apps/bellnote/web.registry.json --run bellnote-web --profile sandbox
```

`web.registry.json` registers this package alone with its own clock, so nothing outside `apps/bellnote/` is needed. Views, covered workflows, design choices and per-view timings: [gui/README.md](gui/README.md).

## Optional Mail notices

Bellnote declares one `messaging.publishes` entry (`channel.email`, `urn:pale:email-message:2`, `org.pale.mail.notification.v1`, payload `urn:pale:email-payload:1`) for the existing receive declaration of Mail 1.3.0 in `examples/apps/mail` and receives nothing. The recipient is `{"kind":"person_ref","id":<owner_person_id>}`. `src/publisher.cjs` is an Infra-run sender: Infra gives it Bellnote's Infra connection (to read notifications through `env.snapshot`) and a Messaging publisher connection fixed to this account; it calls `router.publish` and never writes back into Bellnote. A rejected delivery creates no Mail record and leaves Bellnote unchanged; a receipt means Mail stored the message, not that anyone acted on it. Bellnote runs fully without Mail; `dependencies.required_apps` is empty.

## Commands

From this folder (the package alone, no runtime needed):

```sh
npm test                      # 49 business tests: T01–T19 (App-side), rules, wording, fixtures and history, contracts, diagnostics
npm run example               # walkthrough: report, two marks, one notification
npm run contracts:check       # generated tools/schemas match their source
npm run fixtures:check        # consistency of both fixtures, generated history, size, builder match
npm run fixtures:history      # rebuild the generated history and compare with the committed fixture
npm run fixtures:build        # rewrite fixtures/reference.json from its builder
```

Web GUI checks (pinned public runtime as below; the browser check also needs Playwright and Chromium installed at the repository root with `npm ci && npx playwright install chromium`):

```sh
npm run web:smoke             # 14 checks on the real shared Web Host, no browser
npm run web:browser           # 64 checks clicking the page in Chromium; screenshots in .artifacts/bellnote-web/
```

With the pinned public runtime (found automatically in a full checkout, or `--runtime DIR` / `PALE_RUNTIME_ROOT`):

```sh
node scripts/real-mcp.cjs  [--runtime DIR] [--output FILE]               # 54 real MCP checks
node scripts/mail-flow.cjs [--runtime DIR] [--mail DIR] [--output FILE]  # 17 Bellnote → Mail checks with Mail 1.3.0
```

From the repository root:

```sh
npm run app:verify -- --app apps/bellnote --output .artifacts/bellnote.json
npm run contracts:check
npm test
```

Run an MCP server pair by hand: `node apps/bellnote/service.cjs --role infra --run demo --state-dir .state` and, in another process, the same with `--role agent`. The default `scenario` profile allows only reads; Infra selects `sandbox` with `env.reset` to allow writes.

## Limitations

Out of scope in this version, as approved: school posts and announcements, replies to teachers, sign-up sheets, grades, assignments, timetables, enrollment, bus tracking, after-care billing, meal pre-ordering and free/reduced-price applications, real payments and saved-card management, form attachments, parent group chat, the staff side, the other guardian as a second account, several districts per account, push/SMS, and any staff or reviewer console. Guardian links and restrictions are set only by the seed. There is no outbox or cross-App transaction for Mail notices. Policy values, the school calendar and notification wording are illustrative and await human review.
