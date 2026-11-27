# University Course Registration

A resettable enrollment portal for one fictional university and one term. The App records the academic consequences of each action (seats, credits, timetable, waitlists, offers); a Task supplies the student, their history and the scenario. All records are synthetic. Public university enrollment pages informed the workflow design only; no catalog, branding or student data was copied.

Approved scope: [environment proposal](../../proposals/environment/university-course-registration.md) (PR #67). Runtime baseline: public runtime 1.6.0, Core API 1.2.0. App version 1.0.0.

## Status

This is the first runnable version (v1): milestones M1 to M3 of the proposal.

| Area | State |
| :--- | :--- |
| Workflow 1, inspect courses and eligibility: `catalog.search`, `course.get`, `record.get`, `schedule.get`, `waitlist.list`, `activity.list`, `change.preview` | Implemented |
| Workflow 2, enroll or withdraw: `enrollment.enroll`, `enrollment.withdraw` | Implemented |
| Workflow 3, waitlists and offers: `waitlist.join`, `waitlist.leave`, `offer.accept`, `offer.decline` | Implemented |
| Workflow 4, swap without losing the existing place: `enrollment.swap` (immediate) and a pending swap through `waitlist.join` with `swap_from_enrollment_id` | Implemented |
| Infra events `occupancy.change`, `section.reschedule`, `offers.expire` | Implemented |
| Seed / live data schema, ledger invariants on load and after every commit | Implemented |
| Default seed, six scenario seeds, versioned fixture generator | Implemented |
| Web views: Catalog, My schedule, Waitlists & offers | Implemented (see `gui/README.md` for what they do not cover) |
| Web views: course detail, academic record and rules, change review and activity receipts; browser validation | Not in v1 (M4) |
| Continuation integration-test script | Not in v1 (M4); its seed-level requirements are implemented and tested, see "For Task runners" |
| Agent trials, independent reproduction | Not in v1 (M5) |

## Run it

Node.js 18 or later; no package installation. From this directory, using only this package:

```sh
npm test          # node --test tests/business.test.cjs
npm run example   # node examples/run.cjs
```

Against the public runtime (real MCP over stdio, separate Agent and Infra connections, and the Web Host over HTTP), from this directory inside the public checkout:

```sh
npm run test:runtime   # node --test tests/runtime.integration.cjs
```

Each run of these starts from fresh state in a temporary directory and removes it afterwards. Set `UCR_STATE_DIR` to keep the state (every run writes a new subdirectory of it) and `UCR_EVIDENCE_DIR` to export the snapshots taken before each reset.

and from the repository root:

```sh
npm run app:verify -- --app apps/university-course-registration --output <report.json>
```

The package brings its own registry, `registry.local.json`, for launching it on its own. Start the Infra connection first, then the Agent connection for the same run and state directory:

```sh
node runtime/mcp-server.cjs --app university-course-registration --role infra --registry apps/university-course-registration/registry.local.json --run demo --state-dir <state-dir> --initial-profile sandbox
node runtime/mcp-server.cjs --app university-course-registration --role agent --registry apps/university-course-registration/registry.local.json --run demo --state-dir <state-dir>
```

These are MCP servers on stdio. The business Web interface is served by the public Web Host on loopback; open the access link it prints:

```sh
node runtime/web/server.cjs --app university-course-registration --registry apps/university-course-registration/registry.local.json --run demo --state-dir <state-dir> --profile sandbox
```

The page and the MCP tools are two entrances to the same handlers and the same ledger. Inclusion in the repository's shared registry is a maintainer decision and is not part of this package.

## How it behaves

- **One ledger.** The student and the synthetic competitors occupy the same ledger; `occupant_ref` tells them apart. Seats taken in a section are its background occupants (`base_enrolled`), plus enrolled ledger rows, plus live offer holds, and can never exceed capacity.
- **Bundles.** A course that requires a lab is taken as one lecture plus one lab. Every section of the bundle needs a seat; credits count once.
- **Writes either commit or change nothing.** A rule failure is returned as an error status (`section_full`, `prerequisite_missing`, `time_conflict`, ...) and the ledger is untouched. A committed write returns `status: committed`, the new `version`, and a `receipt_id` stored in `receipts`.
- **Preview, then confirm.** `change.preview` is a read: it lists every rule the change fails, the resulting credits and schedule, and stores nothing. Its `version` is the state it was computed from. The write re-checks everything and is refused with `stale_version` if anything was committed, or the clock advanced, in between.
- **A swap keeps the original place until the replacement commits.** The new bundle is taken and the old one given up in the same commit; on any failure the original enrollment is untouched. Eligibility is judged on the schedule with the old bundle replaced. A seat in a section shared by both bundles is reused, so only the other sections need a free seat, and a hold is taken only on those.
- **A waitlist entry is not an enrollment.** It counts toward neither credits nor the timetable. There is no queue for a bundle that has seats: `waitlist.join` is then refused with `seats_available`. Joining again for the same bundle returns the existing entry, rank unchanged. Changing sections of a course already held needs a swap (`swap_required`), and an enrollment can have one pending swap (`pending_swap_exists`).
- **One queue order.** Entries are served in the order they joined (`seq`), the student and competitors alike. After every committed write and every event the queues are walked in that order: an entry whose whole bundle has seats and which is eligible receives an offer and the seats are held. An entry that lacks a seat or fails a rule is passed over, holds nothing and keeps its place, so a later entry can be served first. The student's own blocking reasons are computed when read (`waitlist.list`), never stored.
- **An offer holds seats until it ends.** It ends by `offer.accept`, `offer.decline`, `waitlist.leave`, cancellation of its pending swap, or the `offers.expire` event. Accepting and declining both answer the offer and share its deadline: from `expires_at` on, each is refused with `offer_expired` and the offer keeps its seats until the `offers.expire` event closes it. Time passing alone releases nothing. Leaving the waitlist entry, or giving up the enrollment a pending swap belongs to, is not an answer to the offer: it stays possible after the deadline and releases the seats at once, and the offer is then recorded as `cancelled`. A failed acceptance leaves the offer and the original enrollment as they were. An offer still open when registration for its course closes can no longer be accepted (`registration_closed`) and keeps its seat until it is declined or expires. A seat held for the student's own offer is used by accepting that offer: a separate enroll or swap into it is refused with `section_full` and names the offer.
- **A pending swap belongs to its original enrollment.** Withdrawing or swapping out of that enrollment cancels the pending swap and releases any seat its offer was holding; it never turns into a plain enrollment. Leaving, declining or expiry drop the swap and keep the original. Nothing else is cancelled implicitly: an entry the student stops qualifying for stays in the queue, blocked, until she leaves it.
- **Only the student's own records are addressable.** Naming another occupant's enrollment, entry or offer returns `not_found`, exactly as an unknown ID does. Ledger rows are never deleted: a withdrawn or replaced enrollment, a finished entry and a closed offer stay as history with their end time.
- **Versions and retries belong to Core.** Every write carries `expected_version` and `request_id`. The App keeps no clock and no deduplication store.
- **Reads never change data** and expose only the student's own records and per-section totals.
- **Time conflicts.** A change may not introduce a conflict that is not already in the timetable; existing unrelated conflicts do not block it. A section-time change by the university can create a conflict: it stays in the schedule, attributed to the event that created it, and no enrollment is dropped. Later changes that keep the overlap do not replace that cause; an overlap the seed already contained has none (`caused_by: null`). If both sections were moved at the same instant, the change of the first section listed in the conflict is named.
- **The clock is not readable, so time-dependent facts are stated.** An Agent cannot ask for the current time. `course.get` says whether registration is open, `record.get` says whether an enrollment can still be given up, and `waitlist.list` says whether an offer has expired. Each is computed when read and never stored.
- **Every rule that can refuse a write can be looked up first.** The facts behind each rule error are in the plain reads (seats, valid bundles, prerequisites, credits, meeting times, windows, open offers); `change.preview` applies them to one proposed change.
- **Policy is visible data.** `enrollment_policy` in the seed, returned by `record.get`, is a versioned record of the rules the App implements: queue order, offer window, expiry boundary, pending swaps, conflicts, and who may see and change what (`access`). Every rule field admits only the implemented value, so a seed cannot state a policy the App does not follow; the offer window is the one setting a seed chooses.
- **Access.** `access.records: own_account_only`: every read and write concerns the bound student's own enrollments, waitlist entries, offers, notices and receipts; a row of anyone else is `not_found`. `other_students: section_totals_only`: other students appear only in the seat totals of sections. `academic_record: read_only` and `rule_exceptions: none`: no operation edits completed courses or the credit limit, and none waives a rule. `management: infra_only`: seeds, events, the clock, reset and snapshots belong to the Infra connection. A run's permission profile can only narrow the tools further.

## Operations, errors and permissions

`scenario` and `sandbox` are the two permission profiles in `fixtures/policies.json`; a Task can supply its own. Management operations (`env.*`) exist only on the Infra connection. The same permissions model is readable by the Agent as `enrollment_policy.access` in `record.get`.

| Operation | Effect | `scenario` | `sandbox` | Rule errors it can return |
| :--- | :--- | :--- | :--- | :--- |
| `catalog.search` | read | allowed | allowed | `not_found` (unknown term) |
| `course.get` | read | allowed | allowed | `not_found` |
| `record.get` | read | allowed | allowed | none |
| `schedule.get` | read | allowed | allowed | none |
| `waitlist.list` | read | allowed | allowed | none |
| `activity.list` | read | allowed | allowed | none |
| `change.preview` | read | allowed | allowed | `invalid_arguments` (wrong arguments for the action); rule failures are listed in the result, not returned as errors |
| `enrollment.enroll` | write | denied | allowed | `not_found`, `invalid_bundle`, `registration_closed`, `duplicate_enrollment`, `prerequisite_missing`, `section_full`, `credit_limit_exceeded`, `time_conflict` |
| `enrollment.withdraw` | write | denied | allowed | `not_found`, `invalid_state`, `withdrawal_closed` |
| `enrollment.swap` | write | denied | allowed | `not_found`, `invalid_state`, `invalid_bundle`, `withdrawal_closed`, `registration_closed`, `duplicate_enrollment`, `prerequisite_missing`, `section_full`, `credit_limit_exceeded`, `time_conflict` |
| `waitlist.join` | write | denied | allowed | `not_found`, `invalid_state`, `invalid_bundle`, `registration_closed`, `swap_required`, `pending_swap_exists`, `seats_available` |
| `waitlist.leave` | write | denied | allowed | `not_found`, `invalid_state` |
| `offer.accept` | write | denied | allowed | `not_found`, `offer_not_live`, `offer_expired`, and every rule error of `enrollment.enroll` (plain entry) or `enrollment.swap` (pending swap) |
| `offer.decline` | write | denied | allowed | `not_found`, `offer_not_live`, `offer_expired` |

Core adds `permission_denied`, `invalid_arguments`, `stale_version` and `idempotency_conflict` on any operation. When a write fails several rules, its status is the first in this order and its message names the others: `not_found`, `invalid_state`, `offer_not_live`, `offer_expired`, `invalid_bundle`, `withdrawal_closed`, `registration_closed`, `swap_required`, `pending_swap_exists`, `duplicate_enrollment`, `prerequisite_missing`, `seats_available`, `section_full`, `credit_limit_exceeded`, `time_conflict`.

`waitlist.join` does not judge eligibility for the seat (prerequisites, credits, timetable): that is checked when an offer is issued and again when it is accepted, and a blocked entry says why in `waitlist.list` and in the result of the join. So a pending swap that names an enrollment of another course is accepted even when the target course is already held: it waits, blocked by `duplicate_enrollment`, and until it is left the same bundle cannot be queued for as a swap from the right enrollment (`invalid_state`, naming the entry to leave). Its `swap_from_enrollment_id` may be omitted or `null` for an entry that is not a swap.

One refusal is not a registration rule. While the clock is behind the ledger's latest record (a seed loaded with too early a clock, see "For Task runners"), reads answer as usual, every write is refused with `invalid_state`, and `change.preview` reports that single failure; the message names the instant the clock has to reach.

Infra events, applied with `env.apply_event` (envelope `{event_id, at, operation, payload}` under `event`, plus `expected_version`). `schemas/events.schema.json` is the contract; `examples/scenario.json` is the proposal's `evt-0007`.

| Event | Payload | Effect | Refused with |
| :--- | :--- | :--- | :--- |
| `occupancy.change` | `change` and `occupant_ref`, plus `enrollment_id` (`withdraw`), `section_ids` and optional `enrollment_id` (`enroll`), `section_ids` and optional `entry_id` (`waitlist_join`), `entry_id` (`waitlist_leave`), `offer_id` (`offer_accept`, `offer_decline`) | Moves a synthetic competitor through the shared ledger under the same rules as the student. A withdrawal releases the whole bundle; capacity does not change | `invalid_event` (the occupant is the signed-in student, or an ID is already used), `not_found`, `invalid_state`, `invalid_bundle`, `duplicate_enrollment`, `section_full`, `seats_available`, `swap_required`, `offer_not_live`, `offer_expired` |
| `section.reschedule` | `section_id`, `meetings` | New meeting times, section `version` plus one, old times kept in `history` with the event ID. The student is told when a section she holds or waits for moved. Nothing is dropped | `not_found`, `invalid_event` (the times it already has, however they are written: in another order, split by day or listed twice; or a meeting that does not start before it ends) |
| `offers.expire` | `{}` | Closes every live offer whose `expires_at` is at or before the event time, in the order the offers were issued, releases its seats, takes its entry out of the queue and tells the student. With nothing due it closes nothing | only as any event is (below) |

Every event ends by re-checking the queues, so a freed seat is offered within the same event, and an offer that a seed left pending (see "Remaining work and limits") is issued by the first event, `offers.expire` with nothing due included. A refused event changes neither the ledger nor the clock. Any event dated before the ledger's latest record is refused with `invalid_event`.

## For Task runners

**Time and expiry.** The App has no clock and no scheduler. Core supplies the current time to every handler; `env.advance_time` runs no handler. An offer's deadline is its issue time plus `enrollment_policy.offer_window_minutes` (1440 in the packaged seeds), written with the same UTC offset as the instant of issue.

- Read deadlines from `env.snapshot`: `snapshot.data.offers[]` with `status: "live"` carry `expires_at`. A committed write or event can issue a new offer, so read again after each one.
- Before advancing the clock to T, apply the due events in time order, including an `offers.expire` event at every offer deadline up to T. At a deadline, apply the expiry before any Agent action at the same instant. Assign stable event IDs: an identical retry returns Core's original receipt (`duplicate: true`) and produces no second notice.
- If an expiry is not applied, the App still refuses to accept or decline the offer (`offer_expired`) and reads report `expired: true`, but the seats stay held until the event arrives. This is a defensive guard, not a substitute for the event. In that state the student can still leave the waitlist entry or withdraw the original of a pending swap; either closes the overdue offer as `cancelled` and releases its seats, and the late `offers.expire` then finds nothing to do for it.

**Events.** An event's `at` may not precede the App clock, and applying it sets the clock to `at`. Each `env.apply_event` needs the current `expected_version`. `occupancy.change` cannot act for the bound student. An `event_id` is any string of 1 to 100 characters (a longer one is `invalid_arguments`); the App stores it in notices and section history exactly as given, so the form of an ID never decides whether an event applies.

**Accounts and profiles.** `fixtures/binding.json` declares four student accounts. They are interchangeable seed accounts: one is loaded per App instance, they are not four students online at once. A seed names its `account_id`; one the binding does not declare is refused. `env.load_seed` does not select a permission profile; the active profile is chosen when the instance is created (`--initial-profile`, or `--profile` for the Web Host).

**Loading a scenario or a checkpoint.** Live data is itself a valid seed. Call `env.load_seed` with `data`, `binding`, `policies` and `virtual_now`, and without the `bundle` taken from a snapshot: that bundle declares the record count of the data it was made for, and Core refuses it once records have been added. The scenario seeds are loaded the same way, with the `virtual_now` listed in `fixtures/scenarios/index.json`.

**The clock a seed is loaded with.** Give a seed a `virtual_now` at or after its latest record: the latest of `enrolled_at`, `joined_at`, `issued_at`, the times rows ended or were resolved, notice and receipt times, and `history[].replaced_at` (offer deadlines and term dates do not count). The packaged seed's latest record is `2027-01-07T09:40:00-05:00`, and `fixtures/clock.json` and `registry.local.json` start at `2027-01-11T09:00:00-05:00`. With an earlier clock the seed still loads and every read works, but the App changes nothing: writes return `invalid_state` and events dated before that record return `invalid_event`, each naming the instant. It recovers by itself once `env.advance_time`, or an event dated at or after the record, brings the clock there. A registry whose `initial_time` is earlier than the default seed's history therefore starts this App read-only until a Task loads its seed with its own `virtual_now`.

**Reset and continuation are different things.** `env.reset` returns to the seed that was loaded last and starts a new epoch; it clears Core's request results and audit, so export `env.snapshot` first if the trace is needed. A bounded continuation loads a snapshot's `data`, `binding`, `policies` and `virtual_now` into the same or a fresh instance. What carries over is the business state: enrollments, queue order, live offers and holds, pending swaps, notices, receipts, and the ID counter, so IDs created afterwards do not collide. What does not: request results, the audit, cached versions (a new epoch starts, and every client must read again and use new request IDs), unresolved in-flight requests, and events not yet applied, which the runner submits again from its own cursor, expiry deadlines included. After such a load, `env.reset` returns to the checkpoint, not to the original seed. There is no crash recovery and no platform restore operation. The continuation test script that exercises this protocol end to end is M4; v1 tests the parts the App owns (see the table below).

## Data

`fixtures/minimal.json` is the default seed: eight courses and twelve sections at Larkhaven University (fictional), Winter 2027, one student account and two competitors. It starts with the student enrolled in two courses and first in the queue for a CS240 bundle whose lab is full, and it reproduces the proposal's three-event example exactly (`evt-0007`, `evt-0012`, `evt-0015`).

`fixtures/scenarios/` holds six scenario seeds on a larger catalog (21 courses, 34 sections), one per topic, spread over the four accounts; `index.json` lists each seed's account, clock and summary.

| Seed | Account | Covers |
| :--- | :--- | :--- |
| `eligibility.json` | `ucr-tomas` | Missing prerequisites, a course window that has closed, labs tied to one lecture, a full required lab, overlaps |
| `capacity.json` | `ucr-ife` | Partly free bundles, a last seat, queues shared with competitors |
| `credits.json` | `ucr-mei` | A credit limit judged on the resulting schedule; a blocked entry with an eligible competitor behind it |
| `offers.json` | `ucr-noor` | A live offer ninety minutes from its deadline; a blocked entry beside a free seat |
| `swaps.json` | `ucr-tomas` | A live offer on a pending swap and a three-entry queue; immediate, waitlisted and refused swaps |
| `timetable.json` | `ucr-ife` | A conflict created by a section-time change, attributed to the event, with a repair |

They are written by `dev/generate-fixtures.cjs` (version and seed recorded in `index.json`): a hand-written starting ledger per scenario, background occupancy from a fixed-seed generator, and a short history applied through the App's own handlers, so the offers, notices and receipts in a seed are what the App itself produces. The generator checks every seed against the schema and the ledger invariants (linked sections, bundles, capacities, credits, references), checks prerequisites, dates and the fixed UTC offset, and requires the seed to be settled: nothing in the queue could be offered a seat at the scenario's clock.

Missing data: a seed is rejected at load when a required field is absent or when a record points at a course, section, enrollment, waitlist entry or offer that does not exist (this includes the pointers inside notices and receipts), so the running App never meets incomplete records. Event IDs recorded in notices and section history, like the request IDs in receipts, belong to Core: they are kept exactly as the call carried them (1 to 100 characters, any form) and are not resolved. The only optional rule fields are a course's `registration_window` (the term window applies when absent) and a lab's `linked_lecture_ids` (any lecture of the course when absent). A tool call naming an unknown ID returns `not_found`.

Queue order: waitlist entries are served in `seq` order, and a seed whose `seq` order contradicts the `joined_at` times is rejected. Records dated after the clock a seed is loaded with do not make the load fail; they make the App read-only until the clock reaches them ("For Task runners"). A competitor's entry carries `blocked_reason` when the scenario wants it ineligible; competitors' academic records are not part of the ledger.

## Workflows and their tests

`tests/business.test.cjs` runs from this package alone and loads the suites below. `tests/runtime.integration.cjs` needs the public runtime. Tests assert stored ledger state and side effects, not just replies.

| Workflow | App-only tests | Real MCP and Web Host |
| :--- | :--- | :--- |
| 1. Inspect courses and eligibility | `business.test.cjs` (catalog), `suite-reads.cjs`, `suite-visibility.cjs` (including "the access rules the policy record states are the ones the App enforces") | "preview, then confirm"; "Agent and Infra see different operations" |
| 2. Enroll or withdraw | `business.test.cjs` (enroll, rejections, windows, credits), `suite-changes.cjs` | "one read and one write through MCP"; "preview, then confirm" |
| 3. Join and manage a waitlist, offers | `suite-waitlist.cjs`, `suite-events.cjs` | "an Infra event frees a seat"; "race for the last seat"; "the clock reaches an offer deadline" |
| 4. Swap without losing the place | `suite-changes.cjs` (immediate), `suite-waitlist.cjs` (pending) | "preview, then confirm"; "a scenario seed loads for another account" |
| Events and time | `suite-events.cjs` (including "an event ID is Core's") | the three above; "refused events keep the App's status over MCP"; "an event ID is stored as Core received it" |
| Seeds, reset, reload | `business.test.cjs` (invariants, IDs), `suite-scenarios.cjs` | "live data reloads as a seed"; "the scenario profile is read-only, and separate runs do not share state"; "a seed loaded with a clock behind its own records" |
| Boundaries of all of the above | `suite-boundaries.cjs`: "meetings that only touch do not conflict"; "a single remaining seat is a seat"; "a conflict is attributed to the change that created it"; "nothing is changed while the clock is behind the ledger's own records"; "competitors meet the same edges"; "offers that fall due together expire in the order they were made"; "a seed that is not settled is settled by the first commit"; "several conflicts are listed in one order"; "an offer that outlives the close of registration"; "a pending swap that gives up another course for one the student already holds" | the two named in the rows above |
| Web views | none in v1 (browser checks are M4) | "the business Web Host serves the three views on the same ledger" (HTTP level) |

Where the validation items named in the proposal are tested:

| Item | Test |
| :--- | :--- |
| Access to another account or run | `suite-waitlist.cjs` "another occupant's entries and offers"; `suite-visibility.cjs` "no result names a competitor" and "the access rules the policy record states"; integration "separate runs do not share state" |
| An expired offer; confirmation exactly at expiry, before and after `offers.expire` | `suite-events.cjs` "from the expiry instant an offer can be neither accepted nor declined" and "past its deadline an offer is not answered" |
| Advance without expiry processing | integration "the clock reaches an offer deadline before the expiry event" |
| A stale preview | integration "preview, then confirm" |
| Concurrent claims on the last seat | integration "the Agent and an Infra event race for the last seat" |
| A failed swap preserving the original | `suite-changes.cjs` "a failed swap preserves the original enrollment"; `suite-waitlist.cjs` "a failed acceptance keeps the original enrollment and the offer" |
| A lab swap sharing an already-full lecture | `suite-changes.cjs` "a lab swap reuses the seat in a shared lecture"; `suite-waitlist.cjs` "accepting a pending swap" |
| Duplicate enrollment and waitlist requests | `business.test.cjs` "a rejected enrollment changes nothing"; `suite-waitlist.cjs` "joining again returns the existing entry" |
| Renewed queue eligibility | `suite-waitlist.cjs` "an entry that fails a rule keeps its place"; `suite-events.cjs` "a section-time change re-checks the queue" |
| A source withdrawal invalidating a pending swap | `suite-changes.cjs` "withdrawing the original cancels its pending swap" and "also cancels a live offer" |
| A timetable change followed by repair | `suite-events.cjs` "a section-time change is recorded, attributed and told"; `suite-boundaries.cjs` "a conflict is attributed to the change that created it"; `suite-scenarios.cjs` "timetable scenario" |
| A target-time change after a swap offer is issued | `suite-waitlist.cjs` "a failed acceptance keeps the original enrollment and the offer" |
| A free lecture with a full required lab | `business.test.cjs` "a free lecture with a full required lab takes no seat at all"; `suite-waitlist.cjs` "served in one join order" |
| Two fresh runs restoring identical initial state; reset | integration "separate runs do not share state", "one read and one write through MCP" |
| The proposal's three-event example | `suite-events.cjs` "the proposal's three-event example replays exactly" |
| Live offer, pending swap and three-entry queue reloaded as a seed | `suite-events.cjs` "running data ... reloads as a seed and continues identically"; integration "live data reloads as a seed" (the full continuation script is M4) |
| Browser checks (stale forms, denied Infra access, isolation, same state after reload) | HTTP level only in v1: integration "the business Web Host"; real browser checks are M4 |

## Sources and licences

Everything in this package is newly authored and MIT licensed: code, documentation, the catalog, student records and ledgers. No data was scraped or copied, no course catalog, school name, logo or screenshot is reused, and there are no images.

Three public pages were read as references for how enrollment, swapping and waitlists work in practice. They informed the workflow design only; the rules implemented here are this App's own stated policies and do not represent that university's complete or current rules:

- UC Berkeley, Enrollment: <https://sis.berkeley.edu/services/enrollment>
- UC Berkeley, Swap: <https://sis.berkeley.edu/help/enrollment-faq/swap>
- UC Berkeley, Waitlists: <https://sis.berkeley.edu/topics/waitlists>

The package has no third-party dependencies and uses only Node.js built-in modules. The six shared schemas in `schemas/`, `tests/schema-validator.cjs`, `service.cjs` and the structure of `gui/src/view.js` are copies from this repository's public runtime (MIT); `src/domain-utils.cjs` is adapted from the runtime's SDK template (MIT). `contribution/dataset.json` declares the fixtures as synthetic.

## Remaining work and limits

Not in v1, planned:

- M4: the three remaining Web views and the browser actions the v1 views do not offer; browser checks with a real browser (stale forms, denied Infra and private access, account and run isolation, same state through MCP and after reload); the continuation integration-test script; combined waitlist, swap and timetable scenarios.
- M5: agent trials, independent reproduction in a fresh environment, fixes, demo. The independent reviewer and the trial budget are to be agreed with the maintainers before any validation cost is incurred.

Outside the approved scope, and not supported: more than one university or term; co-requisite chains and degree auditing; multi-course swap chains; a preference or timetable solver; Mail, Calendar or Messaging connections; tuition, financial aid or visa rules; real university systems.

Known limits of v1:

- The Web views offer swaps between sections of the same course only; a swap to another course is available through MCP.
- A competitor is eligible for an offer unless its entry carries `blocked_reason`: the ledger holds no academic record for competitors.
- A seed is expected to be settled. If a seed contains a queued, eligible entry whose seats are all free, the first committed write or event issues that offer.
- Tested locally on macOS (arm64) only, with Node.js 18.20.8 and 22; the repository's CI runs both versions on Linux.

Checks that only a deployment can make, and that this package does not claim: production authentication and HTTPS, multi-user sessions, rate limiting, remote hosting, and behaviour under real concurrent load. The Web Host is a loopback development host.

## Contracts

`dev/contracts.cjs` is the single authoring source for `schemas/seed.schema.json`, `schemas/events.schema.json` and `tools.json`; `dev/generate-fixtures.cjs` writes `fixtures/scenarios/`. After editing either:

```sh
npm run contracts         # regenerate; writes only inside this package
npm run contracts:check   # verify nothing drifted
npm run fixtures          # regenerate the scenario seeds
npm run fixtures:check
```

## Layout

```text
app.json, tools.json, plugin.cjs, service.cjs   manifest, tool catalog, Core hooks, provided launcher
src/model.cjs        ledger invariants; records / objects for Core
src/ledger.cjs       bundles, seats, holds, conflicts, ID allocation, notices and receipts
src/rules.cjs        eligibility evaluation shared by previews, writes and offers
src/queue.cjs        queue order, re-check and offers, entry and offer endings
src/views.cjs        read projections
src/operations.cjs   tool handlers
src/events.cjs       Infra event handlers
gui/                 business page and controller for the public Web Host
schemas/, contribution/, fixtures/               contracts, declarations, synthetic data
dev/                 contract and fixture generators (not used at run time)
tests/, examples/    App-only tests, harness, real-MCP tests, verifier inputs, walkthrough
```

## License

MIT; see `LICENSE`.
