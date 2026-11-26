# Environment Track proposal

Proposed PR title: `[Environment Proposal] [Work & business] Payleaf employee self-service: pay, direct deposit, leave and benefits enrollment`

I checked this proposal against the public runtime on `main` (release 1.6.0, Core API 1.2.0, commit `61b6371`). The employer, people, banks and plans are synthetic, and no affiliation is claimed.

## 1. App and domains

- **Authors / GitHub handles (required):** Shubhashis Roy Dipta (@dipta007)
- **Reference app or website / URL (required):** Payleaf, an independently branded synthetic employee self-service portal. Workflow references: the Internal Revenue Service's page on Form W-4 (https://www.irs.gov/forms-pubs/about-form-w-4), its Publication 969 on flexible spending arrangements (https://www.irs.gov/publications/p969) and Nacha's page on Direct Deposit (https://www.nacha.org/content/direct-deposit). No data, text, branding or icons are reused.
- **Primary domain (required):** Work & business
- **Secondary domains (optional):** None

## 2. What you plan to build

**✍️ Your answer (required):** Payleaf is a resettable employee self-service portal, seen from one salaried employee's account. Every change to pay, leave or benefits waits for a deadline that the person did not choose. A new bank account applies only from the first pay run whose cut-off has not passed. Leave needs notice and hours. Benefits can be chosen only while a window is open. So the portal can accept a change that still arrives too late for this person's rent, trip or surgery, and a task can check whether the agent noticed.

Scope of one App instance:

- It holds one account at one fictional employer.
- Payroll staff, the manager and the benefits team are not accounts. What they do arrives as task-supplied events.
- Payleaf computes no tax. The earnings and taxes of each pay run are task data.
- Payleaf computes what follows from the person's own choices: the deductions, net pay, and the split of net pay across the deposit accounts.
- Money does not move. A deposit is a record, and a bank account is a label with its last four digits.
- A day is a calendar day in the employer's time zone. A working day is Monday to Friday, except company holidays.
- Each pay run has a cut-off. A setting change made before the cut-off reaches that run, and a change made at the cut-off or later does not.
- The employer has five rule values: `leave_notice_days`, `sick_backdate_days`, `inquiry_window_days`, `max_retirement_percent` and `pay_periods_per_year`.

Four workflows are complete in the first version.

1. **W1 Pay, the calendar and records (read only).**
   - The agent reads the employment record, and the pay calendar with the pay date and cut-off of each entry.
   - The agent reads pay statements, with their lines, their deposits and the settings each one used.
   - The agent reads the three pay settings: the deposit setup, the withholding form and the retirement percentage. Each one shows the value the last run used and any change that is waiting or locked. `settings.get` also returns the pay date that a change made now would first apply to.
   - The agent reads setting changes, pay inquiries, notifications and preferences.
   - The agent reads leave requests and leave balances, with what is available and what will expire. `leave.preview` returns what a request would cost and every rule it would break, and it writes nothing.
   - The agent reads enrollment windows, with their plans, the choices in force, the saved choices and the submitted set.
2. **W2 Pay settings and questions to payroll.**
   - The agent can replace the deposit setup, replace the withholding form, or set the retirement percentage. A deposit setup has up to three accounts: fixed amounts, percentages, and exactly one account that takes the remainder.
   - Each of these writes is a setting change, and it applies to one pay run. That run is the planned run with the earliest cut-off that is later than the moment of the change.
   - A newer change of the same setting for the same run replaces the older one. `changes.cancel` before the cut-off brings the older one back.
   - The agent can ask payroll about a statement or one of its lines, with an amount and a note. This is possible until `inquiry_window_days` after the pay date. An inquiry is not edited: the agent withdraws it and asks again.
   - The agent can set the preferences: the time zone used in notification text, and `email_notices`.
3. **W3 Leave.**
   - The agent asks for leave of one type, from a first day to a last day, with the hours for each working day.
   - The agent can cancel a request while it is pending. It can also cancel approved leave before its first day.
   - A request is not edited: the agent cancels it and asks again.
   - The manager's decision arrives as an event.
4. **W4 Benefits enrollment.**
   - While a window is open, the agent saves a choice for a plan: one of its options, a yearly amount for a plan that takes one, or no coverage.
   - The agent then submits the saved set. A submission needs a choice for every plan in the window.
   - A submitted set can be changed and submitted again until the window closes. There is no other way back. A choice that is saved but not submitted again is dropped at the closing time.

The table lists the 12 App errors. A call that returns an error changes nothing. When more than one error fits a call, Payleaf returns the first one in this table.

| Error | Returned when |
| :--- | :--- |
| `not_found` | The ID of an object, a plan or an option is unknown. |
| `invalid_state` | The agent calls `changes.cancel` on a change that is `replaced`, `cancelled` or `applied`, `inquiries.withdraw` on an inquiry that is not `open`, or `leave.cancel` on a request that is `denied`, `cancelled`, `taken` or `lapsed`. |
| `invalid_timezone` | The time zone in `preferences.update` is unknown. |
| `invalid_window` | A window ends before it starts. For leave, it is also returned when the last day is before the first day, the range is longer than 30 days, the range has no working day, or sick leave starts more than `sick_backdate_days` ago. |
| `window_closed` | The agent calls `benefits.elect` or `benefits.submit` before the opening time, or at or after the closing time, of the window. |
| `too_late` | The agent calls `changes.cancel` on a `locked` change, `inquiries.open` after the inquiry window, or `leave.cancel` on `approved` leave on or after its first day. It is also returned when vacation or personal leave starts sooner than `leave_notice_days` from today. |
| `invalid_split` | A deposit setup has more than three accounts, does not have exactly one account for the remainder, or has percentages above 100 in total. |
| `over_limit` | A retirement percentage is above `max_retirement_percent`, or a yearly amount is above the plan's maximum. |
| `already_open` | The statement line already has an open inquiry. |
| `conflict` | A day of a leave request overlaps another pending, approved or taken request. |
| `insufficient_balance` | A leave request needs more hours than are available. |
| `incomplete` | The agent calls `benefits.submit` while a plan in the window has no saved choice. |

The table lists the states of each object and what moves them.

| Object | States | What moves it |
| :--- | :--- | :--- |
| Pay calendar entry | `planned`, `paid` | `calendar.changed` adds a planned entry or moves its pay date or cut-off. `payroll.run_posted` makes it `paid` and writes its statement. |
| Setting change | `waiting`, `replaced`, `cancelled`, `locked`, `applied` | A setting write makes it `waiting`. A later change for the same run makes it `replaced`. `changes.cancel` makes it `cancelled`. It is `locked` when the clock reaches the cut-off. `payroll.run_posted` for its run makes it `applied`. |
| Pay inquiry | `open`, `withdrawn`, `answered` | `inquiries.open` makes it `open`. `inquiries.withdraw` makes it `withdrawn`. `inquiry.answered` makes it `answered`, with the outcome `corrected` or `no_change`. |
| Deposit | `sent`, `returned`, `reissued` | `payroll.run_posted` writes it as `sent`. `deposit.updated` moves it to `returned`, and then to `reissued`. |
| Leave request | `pending`, `approved`, `denied`, `cancelled`, `taken`, `lapsed` | `leave.request` makes it `pending`. `leave.decided` makes it `approved` or `denied`. `leave.cancel` makes it `cancelled`. Approved leave is `taken` when the clock passes its last day. A pending request that needs notice is `lapsed` when the clock reaches its first day. |
| Enrollment window | `upcoming`, `open`, `closed` | `enrollment.opened` adds it. The clock moves it at its opening time and at its closing time. |
| Election set | `submitted`, `final`, `defaulted` | `benefits.submit` makes it `submitted`, and a later submission in the same window replaces it. At the closing time a submitted set is `final`. If nothing was submitted, the set is `defaulted`. |

Rules:

- **Time.**
  - Payleaf has no timers, no scheduler and no clock event. Infra moves `virtual_now` with an event or with Core's `env.advance_time`, which runs no App code.
  - So every time-based state is stored as a due time. Payleaf computes the state from `ctx.virtual_now` each time it is read or checked. This holds for `locked`, `taken`, `lapsed`, the window states, `final`, `defaulted` and the end of the inquiry window.
  - Writes and events use the same computation. Nothing is rewritten when a due time passes.
  - Every read returns the current virtual time as `now`, with the employer's UTC offset. So the agent can compare it with any cut-off before it writes.
- **Day limits.**
  - A limit of N days starts on the day of a moment. It ends at the end of the calendar day that is N days later. This is the rule for `inquiry_window_days`.
  - Leave that needs notice must start on or after the day that is `leave_notice_days` after today.
  - Sick leave may start on or after the day that is `sick_backdate_days` before today.
- **The cut-off.**
  - A cut-off that has passed cannot be moved, and no cut-off can be put before the present. So once a change is `locked`, its run is fixed.
  - Until its run posts, the state of a change is computed when read. Only `cancelled` is stored. Among the changes of one setting for one run that are not cancelled, the latest one reads `waiting` or `locked`, and the earlier ones read `replaced`.
  - When the run posts, the handler uses, for each setting, the latest change for that run that is not cancelled. It stores `applied` on that change and `replaced` on the earlier ones. A stored state does not change again.
  - A change made after a cut-off does not replace the `locked` change of that run. It applies to the run after it.
  - A change made while no run is planned reads `waiting` with no pay date, until `calendar.changed` adds a run.
- **The pay run.** The handler computes net pay when a run posts.
  - Net pay is the earnings in the event, minus the taxes in the event, minus the deductions.
  - Deductions are taken in this order. First comes the per-pay cost of each option in the election set that is in force on the pay date, in the order of the plans. For a plan that takes a yearly amount, the cost is that amount divided by `pay_periods_per_year`, rounded up to the cent, and never more than what is left of the yearly amount. Then comes the retirement percentage in force times the salary lines, rounded half up to the cent.
  - If the pay left after the taxes does not cover a deduction, that deduction is taken in part and the later ones are not taken. The statement then reads `deductions_cut`.
  - Net pay is split in the order of the setup: first the fixed amounts, then each percentage of what is left after them (rounded down to the cent), and then the remainder.
  - If net pay does not cover the fixed amounts, they are filled in order. The statement then reads `short_deposit`.
  - No deposit is written for an amount of zero.
- **Inquiries.** A statement line has at most one open inquiry. A question on the whole statement counts as its own line. The money of a `corrected` answer arrives on a later pay statement, as a line that names the inquiry.
- **Leave hours.** Payleaf computes leave hours when they are read.
  - A request costs its hours for each working day in its range.
  - `balance` is the hours earned and corrected, minus the hours of `taken` requests.
  - `available` is `balance` minus the hours of `pending` and `approved` requests.
  - `leave.preview` runs the same checks as `leave.request` and lists every one that fails.
  - Each posted pay run adds, for each leave type, the hours that the type earns for one pay period.
  - A request that needs notice and is still `pending` on its first day reads `lapsed`, and its hours are free again. Sick leave needs no notice, so it stays `pending` until the manager decides.
  - A leave type can have a carryover cap: the most hours that stay after its carryover date. `expiring` is what would be above the cap on that date. It is `balance`, minus the hours of pending and approved requests for days on or before that date, minus the cap, and never below zero.
  - The forfeit itself is the employer's act, and it arrives as `leave.adjusted`.
- **Benefits.**
  - A plan year is a calendar year. It has one election set in force and at most one window. The window closes before the plan year starts.
  - When a window opens, the saved choices start as the choice in force for each plan that rolls over. They start empty for the other plans.
  - `benefits.elect` saves one choice and changes nothing in force.
  - The set in force for the plan year is the `final` set. If nothing was submitted, it is the `defaulted` set: the choice of the year before for each plan that rolls over, and no coverage for each plan that does not roll over or is new.
  - A plan outside the window takes the same default. So does every plan in a plan year with no window.
  - Deductions follow the set in force from the first pay date in the plan year.
- **Other people's acts.** Payroll, the manager and the benefits team are not checked against these rules. Payleaf rejects their events only for the reasons listed in section 3, and it applies every other event as given.
- **Flags.** Flags show where those acts leave a problem. They are computed when read and never stored.
  - On the account: `change_waiting`, `deposit_returned`, `leave_expiring`, `enrollment_open` (a window is open and no set is submitted) and `will_default` (a window is open, no set is submitted, and a plan that does not roll over has a choice this year).
  - On a pay statement: `short_deposit` and `deductions_cut`.
  - On a leave request: `lapsing` (it needs notice, is `pending` and starts within `leave_notice_days`).
- **Notifications.** Payleaf writes one notification for each event. Payleaf writes none for the account holder's own writes, and none for a change that time alone causes.

Illustrative uses, not Task Track submissions:

- "Move my pay to the new account." The cut-off for this week's run has passed, so Friday's pay still goes to the old account. The agent must say which pay date is the first to change, and that the old account must stay open until then.
- The enrollment window closes on Friday, the person has said nothing, and one plan does not roll over.
- A travel reimbursement paid through payroll is missing from a statement. The agent must ask payroll once, inside the window, with the right amount. Task #129 meets this problem with a task-owned payroll inbox. Task #100 meets a moved pay date that is known only from emails.

No Task proposal depends on Payleaf, and each task loads its own seed.

**Boundaries and overlap.** I checked the proposal list on 2026-11-22. No Environment proposal covers pay statements, direct deposit, payroll cut-offs or benefits enrollment.

- The nearest is #173 (Pegboard). Both have a leave request with a notice period and a manager's decision. Both use the same error names where the case is the same (`too_late`, `conflict`, `invalid_window`). Pegboard is time off from a posted schedule for an hourly worker. Payleaf is paid leave from an hour balance for a salaried worker, with no shifts, coworkers or schedule. One person's leave is modelled in one of the two, never in both.
- #42 (Claimline) builds expense reports and tracks their reimbursement. Payleaf only shows a reimbursement once payroll has paid it.
- #64 (Larkfield Health) is the health plan's own portal after enrollment.
- #6 (Personal Finance Workspace) is the bank that receives the pay.

## 3. Potential app connections

- **Internal personal apps (required):** Payleaf uses Mail only, and Mail is optional and send-only. All four workflows complete with Payleaf alone.
  - When `email_notices` is on, each notification also carries a plain-text message for the existing receive declaration of Mail 1.3.0 in `examples/apps/mail`: channel `channel.email`, wire `urn:pale:email-message:2`, payload `urn:pale:email-payload:1`, type `org.pale.mail.notification.v1`, receiver operation `mail.receive_notification`. I reviewed it at `main` commit `61b6371` ([wire schema](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/blob/61b6371/examples/apps/mail/schemas/router-message.schema.json)).
  - Payleaf declares the matching `messaging.publishes` entry and builds no inbox.
  - Calendar 1.3.0 has no messaging receiver, and Payleaf never reads or writes it. An agent that wants approved leave or a pay date in Calendar adds it with Calendar's own tools.
  - Payleaf does not use Messages, Contacts, Files, Notes or Tasks 1.0.0.
- **Other apps and websites (required):** None: no external website, payroll provider, bank, tax agency or benefits carrier is called at run time.
  - A task that also uses Mail or Calendar seeds consistent data in each. There is no App-to-App channel.

### Integration details

- **Operations and access (required):** Payleaf has 25 Agent-facing MCP operations over stdio, on the Agent connection of the public host (`node runtime/cli.cjs serve --app apps/payleaf --role agent`). They are registered in `tools.json` as `payleaf.<name>`.
  - Read (14): `employment.get`, `calendar.list`, `pay_statements.list`, `pay_statements.get`, `settings.get`, `changes.list`, `inquiries.list`, `leave.balances`, `leave.list`, `leave.preview`, `benefits.windows`, `benefits.get`, `notifications.list`, `preferences.get`.
  - Write (11): `deposit.update`, `withholding.update`, `retirement.set`, `changes.cancel`, `inquiries.open`, `inquiries.withdraw`, `leave.request`, `leave.cancel`, `benefits.elect`, `benefits.submit`, `preferences.update`.
  - Every write takes Core's `request_id` and `expected_version`. It returns the object's `id` with the committed version.
  - Every read returns `now`, the current virtual time.
  - The target object is always the argument `id`. A time window is always `start` and `end`. The reference host's audit projection at `61b6371` keeps these three inputs. So its rows show the object and the window of every call that has them, reads included.
  - Where an operation creates an object, `id` is the object it is about. It is the account for the three setting writes, and the pay statement for `inquiries.open`. It is the leave type for `leave.request` and `leave.preview`, where the first and last day are `start` and `end`. It is the enrollment window for `benefits.elect`, `benefits.submit` and `benefits.get`.
  - The Agent acts as the bound account holder set by Infra, never through an argument. A task can restrict the allowed tools with `policies.json`.
  - The 12 App errors are listed in section 2. Core adds `invalid_arguments`, `permission_denied`, `stale_version` and `idempotency_conflict`. The input schemas reject an amount or a number of hours of zero or less, more than eight hours for a day, and a choice that names both an option and no coverage. So Core returns `invalid_arguments` for these cases before any App error.
  - Infra-only operations: `env.load_seed`, `env.apply_event`, `env.reset`, `env.snapshot`, `env.event_status`, `env.validate_bundle`, and the host's clock operation `env.advance_time`. They are not listed on the Agent connection. Core returns `permission_denied` if the Agent calls them.
  - The first version has no GUI, no reviewer console, and no console for payroll, a manager or the benefits team.
- **State and lifecycle (required):** State is separate per run and App instance, and one instance holds one account (`isolation_keys: run_id, app_id`).
  - A task loads its own seed and starting time with `env.load_seed`. The seed holds every record of section 2 for the employer and the account, with their history. So a task can start from any situation, for example a change that is locked for the next run, a returned deposit, leave above the cap, or a window that is about to close.
  - The seed is history. Facts from other people arrive only through events.
  - `validateSeed` rejects a seed with `invalid_seed` for any of these:
    - duplicate IDs, a reference to an object that does not exist, a timestamp without a UTC offset, or an account that the binding does not declare;
    - a cut-off after its pay date, or a paid entry with no statement;
    - a statement whose net pay and deposits do not follow from its lines and its setup, or a setup that breaks the split rules;
    - two open inquiries on one statement line;
    - leave requests that overlap while pending, approved or taken, or a leave request with no working day;
    - a window that closes before it opens or after its plan year starts, or two windows or two sets in force for one plan year.
  - Writes follow Core: an exact repeat of a committed `request_id` or `event_id` returns the stored receipt marked `duplicate` and makes no second change. The same ID with different input returns `idempotency_conflict`. A stale `expected_version` returns `stale_version`. A failed call leaves data, version and notifications unchanged, and a read never changes business data.
  - Reset is Core's: it restores the loaded seed and the time loaded with it, for this App instance only (`reset_scope: app_instance`). Messages already delivered to Mail stay there.
  - Evaluator records come from three places. They join on `request_id`, `event_id` and version.
    - App state in `env.snapshot` has activity rows with sequence, virtual time, actor `agent` or `event`, action, object ID and the `request_id` or `event_id` behind them. There is one row for every committed Agent write, one for every applied event and one for each effect of an event (a change applied, a statement written, leave hours earned or a notification written). It also has the history of each setting change, statement, inquiry, leave request and election set.
    - Core audit rows carry the projected `id`, `start` and `end`. There is one row for every allowed business call that is not a replay, one for every denied call and one for every `env.advance_time` that is not a replay.
    - The supplied Agent execution trace has the full arguments and results.
  - Counting rules:
    - A replay returns the stored receipt before an audit row is written. So it appears only in the trace, and it counts as a retry of the original.
    - A rejected attempt writes no activity row. Count it from the denial rows and the trace.
    - A time-driven change runs no App code and writes no row. Read it from the stored due times and the clock.
    - Take the snapshot before a reset, because reset clears the audit.
- **Events and notifications (required):** Payleaf has seven events. They arrive through `env.apply_event`, in Core's envelope. An event is handled at its own time, which is `ctx.virtual_now` inside the handler.
  - Core rejects an event dated before the App's current time. Core also validates the data after every event with the same rules as the seed.
  - Payleaf also rejects the events below, with `invalid_event` and state unchanged:
    - an object ID that already exists;
    - an unknown reference, except in a `calendar.changed` that adds an entry with its pay period, pay date and cut-off;
    - a pay run for an entry that is already `paid`, or whose cut-off has not passed;
    - a pay run with no earnings line, or with taxes above its earnings;
    - a pay run whose pay date is in a plan year whose enrollment window has not closed;
    - a calendar change to a paid entry;
    - a calendar change that moves a cut-off that has passed, or that puts a cut-off before the event's time or after the pay date;
    - a deposit update that does not follow the order `sent`, `returned`, `reissued`;
    - an answer to an inquiry that is not open;
    - a decision on a leave request that is not pending. So a decision that arrives after a request lapsed is rejected;
    - a leave correction that would take `available` below zero;
    - a window that closes before it opens, that does not close before its plan year starts, or whose plan year already has a window.

  | Event | Example (`at` carries the UTC offset) | Effect |
  | :--- | :--- | :--- |
  | `payleaf.payroll.run_posted` | `{"event_id":"ev-pl-401","at":"2026-11-20T06:00:00-05:00","operation":"payleaf.payroll.run_posted","payload":{"entry_id":"pd-2026-24","statement_id":"ps-2026-24","earnings":[{"line_id":"e1","kind":"salary","text":"Regular pay","amount":3200.00}],"taxes":[{"line_id":"t1","text":"Federal income tax","amount":412.00},{"line_id":"t2","text":"Social security and Medicare","amount":228.00}]}}` | The entry becomes `paid`. Its statement is written with the computed deductions, net pay and one `sent` deposit for each account that receives money. The changes it used become `applied`. One leave entry is added for each leave type. |
  | `payleaf.calendar.changed` | `{"event_id":"ev-pl-402","at":"2026-11-23T10:15:00-05:00","operation":"payleaf.calendar.changed","payload":{"entry_id":"pd-2026-25","pay_date":"2026-12-07","reason":"The bank holiday schedule."}}` | A planned entry is added, or takes a new pay date, a new cut-off, or both. A pay date can move at any time before the run posts. A cut-off can move only while it has not passed. A waiting change then applies to the run that the new calendar gives, from the next read. |
  | `payleaf.deposit.updated` | `{"event_id":"ev-pl-410","at":"2026-12-08T09:00:00-05:00","operation":"payleaf.deposit.updated","payload":{"deposit_id":"dep-0191","state":"returned","reason":"The receiving account is closed."}}` | A sent deposit becomes `returned`. Or a returned one becomes `reissued`, with the account or the check it went to. |
  | `payleaf.inquiry.answered` | `{"event_id":"ev-pl-420","at":"2026-12-10T14:00:00-05:00","operation":"payleaf.inquiry.answered","payload":{"inquiry_id":"inq-0006","outcome":"corrected","correction_amount":412.50,"answered_by":"Payroll","note":"The reimbursement will be on your next pay statement."}}` | The open inquiry becomes `answered`, with its outcome and note. No statement changes. |
  | `payleaf.leave.decided` | `{"event_id":"ev-pl-430","at":"2026-12-03T11:30:00-05:00","operation":"payleaf.leave.decided","payload":{"leave_request_id":"lv-0044","decision":"approve","decided_by":"person-okoro","note":"Enjoy the break."}}` | The pending request becomes `approved` or `denied`. A denial frees its hours. |
  | `payleaf.leave.adjusted` | `{"event_id":"ev-pl-431","at":"2027-01-01T00:05:00-05:00","operation":"payleaf.leave.adjusted","payload":{"entry_id":"le-0310","leave_type_id":"vacation","hours":-6.0,"reason":"forfeited","note":"Hours above the carryover cap."}}` | A leave entry is added. The balance of that type changes by that many hours, up or down. |
  | `payleaf.enrollment.opened` | `{"event_id":"ev-pl-440","at":"2026-11-23T09:00:00-05:00","operation":"payleaf.enrollment.opened","payload":{"window_id":"win-2027","plan_year":2027,"opens_at":"2026-11-30T00:00:00-05:00","closes_at":"2026-12-11T23:59:59-05:00","plan_ids":["medical","dental","fsa"]}}` | A window is added for a plan year, with its times and its plans. It reads `upcoming`, then `open`, then `closed` by the clock. |

  - Each event writes one notification, named after the event. Payleaf publishes `channel.email` only, and it receives no messages.
  - The App writes the notification. When `email_notices` is on at that moment, it stores the full wire message with it.
  - An Infra-run sender in the package sends the messages. It is an outbound adapter that Infra runs with its own Infra and publisher connections. It reads notifications through `env.snapshot` and calls `router.publish`, the call that Mail's `src/publisher.cjs` uses.
  - Infra runs one sender for the whole run. It chooses when the sender publishes, and it waits for each result before it moves the clock. Mail records the message at Mail's own virtual time.
  - The sender publishes each notification that has a stored wire message, once. It never sends a notification that was in the loaded seed: it notes the seed's notification IDs when it starts.
  - The message `id` and the `request_id` are the notification ID. So publishing the same notification again is an identical retry: the router returns the first receipt, marked `duplicate`, and Mail keeps one inbox record.
  - A delivery needs a Mail account bound in the run and an Infra grant for `channel.email`. Without them the router rejects the delivery before dispatch, and Mail has no record.
  - The sender does not write back into Payleaf, so no cross-App transaction is assumed. If the receiver rejects the message, or its answer is unknown, the router halts the run for inspection. None of these outcomes rolls back Payleaf.
  - The message below is an example notification as a full wire message. I validated it against Mail's `urn:pale:email-message:2` schema at `61b6371` with `runtime/contracts/schema-validator.cjs`: it passes, and two broken variants fail. This is a schema check, not a completed integration test. `{"specversion":"1.0","id":"ntf-0074","source":"urn:pale:app:payleaf:account:payleaf-kai","type":"org.pale.mail.notification.v1","time":"2026-11-23T10:15:00-05:00","datacontenttype":"application/json","dataschema":"urn:pale:email-payload:1","data":{"channel":"channel.email","recipient":{"kind":"person_ref","id":"person-kai"},"source_object":{"app_id":"payleaf","account_id":"payleaf-kai","object_type":"pay_date","object_id":"pd-2026-25"},"content":{"title":"Your next pay date moved from 4 December to 7 December","body":{"format":"text/plain","text":"Payroll moved the pay date for the period 16 to 29 November from Friday 4 December to Monday 7 December. Reason given: the bank holiday schedule. Changes to your pay settings for this pay date are still accepted until Tuesday 1 December at 17:00. Open Payleaf to see your pay calendar."},"asset_ids":[]},"subscription_ref":"payleaf-kai:pay-calendar","extensions":[]}}`
- **Shared data and dependencies (required):** Every object has a stable ID. Payleaf is the source of truth for its pay statements, settings, inquiries, leave and elections. It keeps no copy of another App's records.
  - The account's `account_id` and `owner_person_id` are the shared values of the run's `binding.json`. So the person has one ID in Payleaf and Mail, and notifications address the recipient by `person_ref`.
  - The manager is named by `person_id`. A task that has the same person in Contacts or Messages gives them the same ID in its seeds. Payleaf stores only a display name and a job title.
  - Missing data is explicit. An unknown ID returns `not_found`. A setting with no waiting change has `waiting: null`. A leave type with no cap has `carryover_cap: null` and nothing `expiring`. A plan with no yearly maximum has `yearly_max: null`.
  - All records are JSON. There are no images, audio, video or attachments (`capabilities.resources: false`, 0 of the profile's 64 assets).
  - Payleaf needs the public Core/Messaging runtime 1.6.0 (Core API 1.2.0) at `main` commit `61b6371`. Mail is optional, `dependencies.required_apps` is empty, and there is no external service.
  - The package runs on its own: a copy that holds only `apps/payleaf/` and the pinned runtime starts the App, and it imports nothing outside its own folder.
  - Days and working days use IANA time zones through Node's built-in `Intl`.
  - Amounts are numbers with two decimals in one currency, kept as integer cents inside the App. Leave is kept in tenths of an hour.

## 4. Construction plan and effort

**✍️ Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| :--- | :--- | :--- | :--- |
| Web / app construction | `apps/payleaf/` per the App contribution guide: 25 operations, the states and rules of section 2, time-based states computed from the environment clock, and the activity log. It reuses the reference package layout, the generated shared schemas, the launcher and the reference test-harness pattern, and it has no GUI. | Every transition and rule in section 2 works. A read leaves the business data in `env.snapshot` byte-identical. A failed call or event leaves state unchanged. | 4 to 5 |
| Data and image collection | Not applicable: nothing is crawled or copied, and the public workflow references are recorded. | Provenance is recorded in `contribution/dataset.json`. | 0.25 |
| Synthetic data and assets | The fixtures are authored JSON, with no generator at run time: 1 fictional employer with its five rules and 11 company holidays; a pay calendar of 26 entries for one year and 4 for the next; 22 pay statements with 150 lines and 44 deposits; 9 setting changes that cover every state; 4 pay inquiries; 3 leave types with 70 leave entries and 12 leave requests; 4 benefit plans with 9 options; 2 enrollment windows and 2 election sets; 26 notifications. They are under 1 MB in total. | The seed passes validation. A consistency script checks four things: every statement follows from its lines and the settings in force, every change points at the right run, leave balances match their entries and requests, and each election set fits its window. | 1 to 1.5 |
| App integrations | The optional Mail notifications need the wire-message builder, the `messaging.publishes` declaration and the Infra-run sender script. | Example messages pass Mail's wire schema. A notification appears as a received message in the bound Mail account with a committed receipt. An identical retry returns the first receipt and leaves one inbox record. Without a grant the delivery is rejected and Mail has no record. The App runs fully without Mail. | 0.5 to 0.75 |
| Validation and reset | The validation has five parts: the local business tests T01 to T20 (table below); the public verifier (`npm run app:verify -- --app apps/payleaf`); a package real-MCP script for what the verifier does not exercise (a task seed with `virtual_now`, time moved with `env.advance_time` and no App event, a failed call that changes nothing, replays, and reset to the loaded time); one Payleaf to Mail flow; and the repository `npm test`, which must stay green. | After implementation, the PR gives the exact App, runtime and Mail versions, the commands, reproducible reports and a workflow-to-test mapping. It also lists the remaining manual review: the realism of the employer rules, the amounts, the plans and the notification wording. | 2 to 2.5 |

**Acceptance plan.** Each row gives a main path (initial state → action or event → expected result) and controls. A control that returns an error must leave state unchanged. Every App error of section 2 has at least one test in T01 to T20. These are planned tests, not implementation results.

| Workflow | Main path | Control | Tests |
| :--- | :--- | :--- | :--- |
| W1 Pay, the calendar and records | A pay statement has earnings of 3,200.00, taxes of 640.00, a medical option of 120.00 for each pay and a retirement percentage of 5. It reads deductions of 280.00 and net pay of 2,280.00.<br>With a setup of 300.00 fixed to savings and the remainder to checking, its deposits are 300.00 and 1,980.00.<br>`calendar.list` shows the next pay date, Friday 4 December, with its cut-off on Tuesday 1 December at 17:00. | An unknown statement → `not_found`.<br>A window that ends before it starts → `invalid_window`.<br>The business data in `env.snapshot` is byte-identical after every read, `leave.preview` included. | T01 to T04: the calendar, statements, settings and changes, and the leave, benefits and inquiry reads |
| W2 Pay settings and questions to payroll | On Wednesday 2 December, after that cut-off, `deposit.update` to a new checking account → `waiting`, and `settings.get` shows 18 December as the first pay date it applies to.<br>`payroll.run_posted` for 4 December still pays the old accounts. The run of 18 December pays the new ones and marks the change `applied`.<br>`retirement.set` to 8 on 10 December → the run of 18 December has deductions of 376.00.<br>`inquiries.open` on the statement of 4 December for a missing reimbursement of 412.50 → `open`. `inquiry.answered` with `corrected` → `answered`. The run of 18 December also carries a reimbursement line of 412.50 that names the inquiry. Its net pay is 2,596.50, which is 2,184.00 plus that line. | A setup with no account for the remainder → `invalid_split`.<br>`changes.cancel` after the cut-off → `too_late`.<br>An inquiry 61 days after a pay date, with a window of 60 → `too_late`.<br>A second inquiry on the same line → `already_open`.<br>The version is unchanged in each.<br>A change made on 30 November, before the cut-off, applies to the run of 4 December. | T05 to T10: the split, the cut-off rule, the pay run, the withholding form and retirement, calendar and deposit events, inquiries and preferences |
| W3 Leave | With 86.0 hours of vacation, a cap of 80 and a carryover date of 31 December, `leave.balances` reads 6.0 hours `expiring`.<br>On 2 December, `leave.preview` for Monday 21 to Friday 25 December, with 25 December a company holiday, reads 4 working days and 32.0 hours.<br>`leave.request` → `pending`, and 54.0 hours are available.<br>`leave.decided` with `approve` → `approved`.<br>After `env.advance_time` past 25 December it reads `taken`, with no App event, and the balance is 54.0. | Vacation that starts in 5 days, with 14 days of notice → `too_late`.<br>96 hours with 86 available → `insufficient_balance`.<br>Days that overlap the approved request → `conflict`.<br>The version is unchanged in each.<br>Sick leave for today is accepted.<br>A vacation request still `pending` on its first day reads `lapsed`, and its hours are available again. | T11 to T14: preview and request, decisions and cancelling, time-driven states, sick leave and the carryover |
| W4 Benefits enrollment | The person has medical, dental and spending-account choices in 2026. `enrollment.opened` for 2027, open from 30 November to 11 December. The saved choices start as the medical and dental choices of 2026, with nothing for the spending account, which does not roll over.<br>On 3 December `benefits.elect` saves the medical option at 95.00 for each pay and a yearly amount of 2,600.00 for the spending account. `benefits.submit` → `submitted`.<br>After the window closes the set reads `final`. From the first pay date of 2027 the spending account costs 100.00 for each pay (2,600.00 over 26 pay periods).<br>In a second run with nothing submitted, the set reads `defaulted` after the closing time. The medical and dental choices of 2026 are kept and the spending account has no coverage. | A choice on 12 December, after the closing time → `window_closed`.<br>A yearly amount of 3,500.00 with a maximum of 3,200.00 → `over_limit`.<br>A submission before any choice is saved for the spending account → `incomplete`.<br>The version is unchanged in each.<br>While the window is open and nothing is submitted, the account reads `enrollment_open` and `will_default`. | T15 to T18: window states, choices, submission, the default |
| All: events, the clock and Core contracts | After `env.advance_time` and no App event, a change reads `locked`, a window reads `closed`, and an election set reads `final` or `defaulted`. Business data is unchanged.<br>Reset restores the loaded seed and time.<br>There is one activity row for each committed write, each applied event and each effect of an event. There is one notification for each event. | Each invalid event listed in section 3 → `invalid_event`, state unchanged.<br>A repeated `request_id` returns the stored receipt and makes no second change.<br>Changed input → `idempotency_conflict`, and a stale version → `stale_version`.<br>The Agent calling `env.apply_event`, `env.reset` or `env.advance_time` → `permission_denied`.<br>No activity row for a replay, a rejected call or a time-driven change.<br>No notification for the account holder's own writes. | T19 to T20: invalid events and notifications; the platform clock, Core contracts and records |

- **Milestones, owners and dependencies (required):** The author owns every milestone, and nothing blocks the first version.
  - M0: design review in this PR.
  - M1 (days 1 to 4 after plan approval): package skeleton, schemas, seed validation, W1 with the calendar and the cut-off rule, T01 to T04.
  - M2 (days 5 to 9): W2, W3 and W4, the seven events, the pay run, time-based states, notifications and the activity log, T05 to T20.
  - M3 (days 10 to 12): fixtures, the consistency script, the Mail flow, the public verifier and the real-MCP script.
  - M4 (days 13 to 14): README, workflow-to-test mapping and evidence. Then `/submit-implementation` inside the 14-day first-version deadline.
  - Related: [#173](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/173), [#42](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/42), [#64](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/64), [#100](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/100), [#129](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/129), [#6](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/6).
- **Resources and total effort (required):** The total is 7.75 to 10 person-days. The work needs Node.js 18+ and nothing else: no GPU, no paid data, no model or API cost and no external service.
- **Scope boundary and open questions (required):** The first version is MCP-only and follows the platform clock.
  - Not in the first version: the calculation of any tax; hours, shifts, time sheets and overtime (see #173); expense reports (see #42); health claims (see #64); dependents, beneficiaries and life events; tax forms and other document files; the checks a bank makes on a new account; several jobs or accounts in one instance; the manager's, payroll's and the benefits team's side of the app; the law of any real place; push, SMS and chat channels; a GUI or CUA interface.
  - Open question 1: should Payleaf compute the deductions and the deposit split of a pay run, or take them from the event? The plan: compute them, because they follow from the person's own choices.
  - Open question 2: should hours be taken from the balance when leave is asked for, or when it is taken? The plan: they are held when asked for and counted as used once taken.
  - Open question 3: should a new bank account wait for a check before it can be paid? The plan: no, because the cut-off is the only wait.
  - Open question 4: do tasks need life events that reopen enrollment? The plan: not in the first version.
- **License and external dependencies (required):** The code is under the repository's MIT License. The fixtures are synthetic and offered under the same terms. Nothing is hosted, and everything is redistributed in the package. The references are public pages, used only for the shape of the workflows. Nothing is copied from them, and no real employer, bank, payroll provider or benefits carrier is used.
