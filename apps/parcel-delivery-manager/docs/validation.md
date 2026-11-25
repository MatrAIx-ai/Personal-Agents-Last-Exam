# Parcel Delivery Manager: v1 validation report

This report is the author's evidence for the first runnable version (v1) of the Parcel Delivery Manager App. It follows the [implementation review guide](../../../docs/review/app-implementation.md) and the [acceptance checklist](../../../docs/review/app-implementation-checklist.md). It claims that v1 is ready for implementation review. It does not claim acceptance: reviewer reproduction, human review and a maintainer's decision are still to come.

All checks below used synthetic data, temporary state directories and local stdio MCP. No credential, network service or model API was used.

## 1. Scope and revisions

| Item | Value |
| --- | --- |
| Approved scope | The whole proposal [`proposals/environment/parcel-delivery-management.md`](../../../proposals/environment/parcel-delivery-management.md) at commit `4e27c750d8658e06863d9724b236b2b2314c0363`, approved by @Chenngzz with `/approve-plan` on 2026-11-23T23:09:02Z (PR MatrAIx-ai/Personal-Agents-Last-Exam#101). The proposal file is unchanged since approval. |
| v1 deadline | 2026-12-07T23:09:02Z |
| Package | `apps/parcel-delivery-manager/`, App version 0.1.0 |
| Evidence baseline | Commit `2dc8aed17c307bdbe158138d9c74e34ec3d11041`, package sha256 `2e416fc7f7d333e977e180f0cad799eeaca265e81fcafeee5e5dfa056cfb6b07` |
| Runtime | Public runtime 1.6.0, Core API 1.2.0, contribution revision 0.4.0. The branch includes upstream `main` at `a4bce02`; `runtime/` is identical to it. |
| Environment | Linux x86_64 container. Node.js v22.23.5 and v18.20.8. Browser acceptance: Chromium 158.0.8127.36 with Playwright 1.63.0 on Node 22. |
| Date of the runs | 2026-11-25 (UTC) |

This report and the JSON reports in [`validation/`](validation/) were updated in the commit after the baseline. That commit changes only files under `docs/`. The package hash covers every file in the package, so it differs at the submitted commit; `git diff --stat 2dc8aed..HEAD -- apps/parcel-delivery-manager` shows the difference is documentation only.

**Delivered in v1.** Sixteen Agent MCP tools and ten trusted `carrier.*` events for the four workflows W1–W4; a business Web App with the six planned views on the shared Web Host; the data catalog (24 parcels in eight seeds, six identities, nine verified addresses, six pickup points, six policy profiles); reset and replay; tests and the reports here. The tools and events are listed in the package [README](../README.md).

## 2. Results

| Evidence | Result | What was exercised |
| --- | --- | --- |
| App-only business tests | **Passed**, 94 of 94, on Node 22 and Node 18 | The real plugin hooks with schema checks on every call: W1–W4 success and refusal paths, time and window boundaries, role boundaries, the data catalog, diagnostics, corner cases, 63 incoherent-seed rules and a short random walk |
| Deeper random search | **Passed**, 72,000 steps | `FUZZ_RUNS=30 FUZZ_STEPS=300`: from each of the eight seeds, 30 walks of 300 random operations and events with invariants checked after every step. 11,179 events and 3,502 Agent writes were committed and 39,124 steps were refused. No unexpected failure and no invariant broken. Run at `b21387b`; `src/` is unchanged since. |
| Mutation analysis | 589 of 599 changes noticed (98.3%) | `npm run test:mutation` changes the business code in 604 single places (5 do not parse) and runs the App-only tests against each. The ten changes the tests do not notice are checks that another rule already guarantees; they are listed in section 5. |
| Coverage of the business code | Lines 100%; branches 95.6% to 100% per module | Measured with `node --test --experimental-test-coverage` on Node 22 |
| Public verifier (`app:verify`) | **Passed**, 46 checks, on Node 22 and Node 18, same package hash | An isolated copy of the package with real Core and separate Agent and Infra MCP processes: discovery, argument and role restrictions, read, history load, event apply and retry, reset, separate run, restart |
| Unmodified upstream validator | **Passed**, 46 checks, same package hash | `runtime/ci/verify-submissions.cjs` from a separate checkout of upstream `main` (`a4bce02`), run against this branch. It selected only this App. This is what the `base-runtime-compatibility` job does. |
| Real-MCP workflow check | **Passed**, 105 checks, on Node 22 and Node 18 | W1–W4 through real Core: permissions, retries, stale versions, clock-only advance, separate runs per person, reset from history, concurrent collectors, every catalog seed, host diagnostics |
| Browser acceptance | **Passed**, 76 checks, Node 22 | The real page in Chromium on the shared Web Host, with independent Agent and Infra MCP inspection: recipient, pickup, failure-and-return, read-only profile, collector and catalog-seed runs. Each workflow's requests are made through the page. |
| Repository reference suite (`npm test`) | **Passed**, 22 of 22 stages | Confirms the existing reference Apps and runtime are unaffected by this package |
| Shared contract copies (`contracts:check`) | **Passed** | Schema copies and derived declarations match the runtime sources |
| Upstream CI | See the PR checks for the submitted commit | At the earlier commit `c8b4353` the "App runtime validation" workflow concluded Success (run 45516090987). Its `business-web` job tests only the seven reference Apps, so the browser acceptance above is author-run. |
| Agent trials | **Not run** | See section 8 |
| Independent reproduction | **Not run** | See section 8 |
| Human review | **Pending** | Realism, usability and provenance are for reviewers |

Machine-readable reports: [`verify-node22.json`](validation/verify-node22.json), [`verify-node18.json`](validation/verify-node18.json), [`base-validator.json`](validation/base-validator.json), [`mcp-workflows-node22.json`](validation/mcp-workflows-node22.json), [`mcp-workflows-node18.json`](validation/mcp-workflows-node18.json), [`web-acceptance.json`](validation/web-acceptance.json). Each lists every check by name. The 18 screenshots from the browser run (7.7 MB) are not committed; the command in section 3 regenerates them.

## 3. Reproduce

From a clean checkout of the submitted commit. Node.js 18 or newer; no install is needed except for the browser run.

```sh
# App-only (no runtime needed); from apps/parcel-delivery-manager
npm test                 # 94 tests
npm run example
npm run check:schemas    # generated tool and event contracts match their source
npm run check:fixtures   # catalog files match the generator
FUZZ_RUNS=30 FUZZ_STEPS=300 node --test tests/fuzz.test.cjs   # optional: the deeper random search, about five minutes
npm run test:mutation    # optional: the mutation analysis, about four minutes

# From the repository root: real host
npm run contracts:check
npm run app:verify -- --app apps/parcel-delivery-manager --output .artifacts/parcel-delivery-manager.json   # 46 checks
node apps/parcel-delivery-manager/tests/mcp/workflows.cjs .artifacts/parcel-mcp-workflows.json              # 105 checks

# Independent base validator: from a separate checkout of upstream main
node runtime/ci/verify-submissions.cjs /path/to/this/checkout /path/to/reports <base-commit-sha>

# Browser acceptance (Node 20+, which Playwright requires)
npm ci && npx playwright install chromium
node apps/parcel-delivery-manager/tests/web/acceptance.cjs .artifacts/parcel-web                            # 76 checks, report.json and screenshots

# Look at it
node apps/parcel-delivery-manager/scripts/load-seed.cjs 08-expiry-return --run demo
node runtime/web/server.cjs --app parcel-delivery-manager --registry apps/parcel-delivery-manager/web.registry.json --run demo --profile sandbox
```

On the machine used here the App-only tests take about four seconds on Node 22 and five on Node 18, the verifier about four seconds, the real-MCP check about six seconds and the browser run about sixteen seconds.

## 4. Review items from the plan approval

| Item from the review of 2026-11-23 | Resolution | Evidence |
| --- | --- | --- |
| 1. Use the shared Web Host; provide only `gui/index.html` and `gui/src/app.js`, declared with `pale.web`; drop the self-built bridge | Done as requested. There is no App-owned server or bridge. | `contribution/gui.json`; App test "Web App declaration, registry and controller are consistent with the package"; browser check "Shared Web Host serves the App-owned page from the package registry" |
| 2. Describe the state after the clock passes a deadline and before its event arrives; baseline runtime 1.6.0 | The parcel keeps its status and records. Reads report the deadline as passed. Passes and authorizations stop working. Redirects, holds, redelivery and new or replacement authorizations are refused with `deadline_passed`. Return processing starts only when the trusted `carrier.deadline_reached` event is applied, and that event is rejected before its deadline. Built and verified on runtime 1.6.0 with `env.advance_time`. | Real-MCP: "Advancing time changes no business record", "Pass is invalid at its exact expiry although no event ran", "Changes are refused after the deadline passes by the clock", "Authorizing a collector is refused after the deadline passes by the clock", "Deadline event before the deadline is rejected", "Pickup expiry starts the return". Browser: "After the deadline passes by the clock the page shows it and offers no change". Catalog seed `08-expiry-return` holds a parcel in this state. |
| 3. Start date and weekly time | Answered in the PR on 2026-11-24: start 2026-11-24, about 30 hours per week | PR comment |
| Suggestion: seed history from 2026-01-01, covering parcels, redirect records, authorizations and notices; let tasks use their own dates | Every catalog record is dated on or after 2026-01-01 and none after its seed's clock. Seeds include applied, rejected and withdrawn requests, authorizations and notices from January and February 2026. A seed loads with any `virtual_now`. | App tests "every seed loads for each of its actors with coherent, non-future timestamps" and "each seed presents the situation it is named for"; real-MCP checks named for each seed |
| Case: both orders of a cancellation and a carrier decision give one effective plan (proposal line 54) | Cancel first: a later approval is rejected. Apply first: cancellation returns `too_late`. | App tests "W1 cancel first: a later approval cannot apply", "W1 apply first: cancellation is too late and cannot reverse the plan"; real-MCP "Cancel first: a later carrier approval cannot apply", "Cancelling after the decision is too_late" |
| Case: two collectors at once, only one succeeds; a repeated arrival does not extend the deadline (line 56) | One of two concurrent handoffs commits; the other is refused even with a fresh version. A repeated arrival is rejected and the deadline is unchanged. | Real-MCP "Exactly one of two concurrent collectors commits", "The other collector is rejected even with a fresh version", "A repeated arrival, with either epoch, is rejected", "The pickup deadline was not extended" |
| Case: collection exactly at the deadline fails (line 64) | Fails at the deadline instant, succeeds one second earlier | App test "W2 collection exactly at the deadline fails; one second earlier succeeds"; real-MCP "Collection exactly at the deadline fails", "Collection one second before the deadline succeeds" |
| Case: the web page and MCP change the same data (line 78) | A browser write is read through MCP at once and after reload; an MCP write and an Infra event appear in the page after Refresh | Browser "Independent Agent MCP reads the browser's pending request", "Reload shows the committed pending request", "Refresh shows the applied plan and the carrier's timeline entry", "Refresh shows the request made through MCP" |

The proposal file is not being changed. It stays as approved, and the places where v1 differs from its text are listed in section 7.

## 5. Workflow evidence

Names in quotation marks are test titles in `tests/*.test.cjs` (App), check names in `tests/mcp/workflows.cjs` (MCP) and `tests/web/acceptance.cjs` (Web). The default seed starts at 2026-03-02T14:00Z with S001 on its way to a home address for 2026-03-04, S002 ready at a pickup counter until 2026-03-04T15:00Z, and S003 under a signature policy.

### W1 Change home delivery

| Start, then action | Observed | Control | Evidence |
| --- | --- | --- | --- |
| S001 in transit. Preview and submit a later date; the carrier then applies it; later a `delivered` event. | The request is `pending` and the plan is unchanged at revision 1. After the decision the plan is revision 2 with the new date. `delivered` closes the parcel. | A second request while one is pending gets `change_pending`. Events naming revision 1 are rejected after the change. A closed parcel rejects every event. | App "W1 reschedule: pending until the carrier applies it, then delivered by a trusted event"; MCP "Submission commits a pending request", "Agent reads the applied plan"; Web "Sent request appears as pending; the plan is unchanged" |
| Address change, hold, ending a hold early | A verified address of the recipient is accepted. A hold that ends lets delivery resume and never delivers the parcel. | Restricted, unverified and other people's addresses, out-of-range dates and changes the policy forbids each return a specific code and write nothing. | App "W1 destination, date and argument rules", "W1 hold: ending it resumes delivery but never delivers the parcel", "W1 a hold can be ended early, and a request still pending at hold end is closed"; Web "A request the App refuses stays in the form with its reason and no confirm step" |
| Withdraw a request before or after the decision | Cancel first: the request is `cancelled` and a later approval cannot apply. Apply first: cancellation is `too_late`. | Exactly one effective plan in both orders | App "W1 cancel first…", "W1 apply first…"; MCP "Cancel first: a later carrier approval cannot apply"; Web "Withdrawing in the browser cancels the request in the App" |
| The carrier declines a request | The prior plan stays and the reason is stored and notified | A decline without a reason is rejected | App "W1 a rejected request keeps the prior plan and gives a reason" |
| The parcel changes after a preview, or the cutoff passes | Submission fails with `stale_confirmation` or `cutoff_passed` | The last second before the cutoff is allowed; the cutoff instant is not. No partial change. | App "W1 a stale or mismatched confirmation is rejected without partial changes", "W1 change cutoff: the last second is allowed, the cutoff instant is not"; Web "A stale form shows the conflict and sends nothing" |

### W2 Redirect to a pickup point

| Start, then action | Observed | Control | Evidence |
| --- | --- | --- | --- |
| Redirect S001 to a counter; carrier applies; arrival event | An applied redirect leaves the parcel in transit with no pass. Arrival starts pickup epoch 1, sets the deadline to arrival plus the policy window and issues the recipient's pass. | Arrival at another point, for an old plan or repeated is rejected; the deadline is not extended. | App "W2 redirect: an applied redirect is not readiness; arrival starts the deadline once"; MCP "Deadline is the arrival time plus the policy window", "A repeated arrival, with either epoch, is rejected"; Web "Redirect sent from the browser is pending in the App", "An applied redirect shows the new plan and no pass before the parcel arrives", "Arrival shows the pass and the deadline, the same as MCP", "The handoff is shown with who collected and where" |
| Handoff at the point | The first valid handoff closes the parcel and consumes the pass | Wrong code, person, point or epoch, a closed hour and the deadline instant are each refused and consume nothing | App "W2 collection needs the right pass, person, point, arrival and opening hours", "W2 collection exactly at the deadline fails; one second earlier succeeds"; MCP "Collection exactly at the deadline fails" |
| The point closes, then reopens | Collection is refused while closed; the deadline does not move; the recipient is notified | The carrier cannot apply a redirect to a point that closed after the request | App "W2 a closed point cannot hand over parcels and does not extend the deadline", "W2 the carrier cannot apply a redirect to a point that closed after the request" |
| The carrier moves a ready parcel to another point | The old pass is invalid at once. Nothing can be collected until arrival at the new point, which starts epoch 2 with a new pass and deadline. | The old code and the old epoch fail at the new point | App "W2 relocation: the old pass dies at once and the new one needs arrival at the new point" |
| Change a ready parcel back to home delivery | The pass stays valid while the request is pending and ends when the carrier applies it | An arrival for the old plan is rejected | App "W2 changing back to home delivery: the pass stays valid until the carrier applies it" |

### W3 Authorize another collector

| Start, then action | Observed | Control | Evidence |
| --- | --- | --- | --- |
| S002 ready. Preview and authorize a saved collector until a time. | The collector gets their own pass. In a separate run for the collector, they see only that parcel's pickup point, hours, deadline and pass. | Only saved collectors; never beyond the pickup deadline or the policy maximum; not for policies without delegation. The collector cannot change the parcel, see other parcels or authorize anyone. | App "W3 preview shows who may be authorized and until when, without changing state", "W3 a grant gives the collector one parcel's pickup details and their own pass, nothing more"; MCP "Collector sees only the authorized parcel, without tracking number or sender", "Collector cannot authorize anyone else"; Web "Collector sees no tracking number, sender, address, plan, options or timeline" |
| The collector collects | The parcel is collected; the recipient sees who collected; every other pass is invalidated | A pass presented by someone else fails. Two collectors at once: exactly one succeeds. | App "W3 only the named collector with the current pass can collect; the recipient sees the result"; MCP "Exactly one of two concurrent collectors commits", "Parcel was handed over once: one pass consumed, the other invalidated" |
| Revoke, replace, let expire, or the parcel leaves the point | The authorization and its pass stop working at once, or at the expiry instant with no event | The recipient's own pass is unaffected. After the pickup deadline no new or replacement authorization is possible. | App "W3 revocation ends the collector's pass and access at once", "W3 replacement swaps the authorization atomically", "W3 a grant that expires before the pickup deadline stops working by the clock alone", "W3 leaving the pickup point invalidates the authorization; a new arrival needs a new one"; Web "Replacing in the browser swaps the authorization in one step" |
| Someone with a tracking number, or a saved collector without an authorization | Nothing is visible; unknown and unauthorized parcels are both `not_found` | Notices are readable only while their parcel is | App "W3 knowing a tracking number or being a saved collector grants no access", "role boundaries hold in every seed"; MCP "Unauthorized person sees no parcel, pass or notice" |

### W4 Recover from failure or expiry

| Start, then action | Observed | Control | Evidence |
| --- | --- | --- | --- |
| A delivery fails | The reason, the action deadline and the available options are shown | A `delivered` event is rejected while the failure is open | App "W4 a failed delivery shows its reason, deadline and next actions"; Web "Failed delivery shows its reason, the action deadline and the recovery options" |
| Recover by redelivery, by redirect and a collector, or by a hold | Each path completes through W1, W2 and W3 to `delivered` or `collected`; the failure stays in the timeline | The old failure deadline cannot return a recovered parcel | App "W4 recovery by redelivery completes through W1", "W4 recovery by pickup redirect completes through W2 and W3", "W4 recovery by hold completes after the hold ends"; Web "Redelivery requested in the browser after a failed attempt is pending in the App", "Once the carrier applies it the parcel is on its way again and the failure stays in the timeline" |
| No action; the clock passes the deadline; then the deadline event; then return completion | In the gap nothing changes and nothing can be requested. The deadline event starts the return with its reason. Only `return_completed` finishes it. The failure reason stays visible on the returned parcel. | A deadline event is rejected before its deadline or for the wrong state | App "W4 an unanswered failed delivery: the deadline event starts the return, a later event completes it", "W4 deadline events are rejected before their deadline and for the wrong parcel state"; MCP "Pickup expiry starts the return", "Only the trusted completion event finishes the return"; Web "Terminal outcome keeps the failure reason and timeline visible" |
| A parcel being returned | Changes, authorizations and every event except return completion are refused; a pending request is closed with `return_started`; passes and authorizations end | Refused through MCP and when sent directly from the page | App "W4 a request still pending at the deadline is closed with return_started", "W4 pickup expiry: passes and authorizations end, the parcel returns"; MCP "Submitting a change on a returning parcel fails with return_started"; Web "A change sent directly for a returning parcel is refused" |
| The pickup point closes | The closure note and the unchanged deadline are visible; another eligible point completes pickup with a new epoch | A closed point cannot receive a parcel that is on its way | App "W4 point closure: reason and unchanged deadline are visible; another point completes pickup", "W4 a point that closes while the parcel is on its way cannot receive it" |

The other focus cases named in the proposal are covered as follows. Delayed old decisions: App "W1 decisions must name the right request and plan revision", MCP "Event for a superseded plan is rejected". Changed-payload retries: MCP "Same request ID with a changed payload is rejected", "Identical retry returns the original receipt", and Web "Retrying after a lost response has exactly one effect". Reset and replay from a seed with a pending request and a live authorization: MCP "Infra loads history containing a pending request and a live grant", "Reset restores the loaded history exactly", "Grant and pending request are live again after reset", and for each catalog seed "example schedule replays to the same outcome after reset to the loaded baseline".

### Corner cases

After the workflow tests passed, the code was probed for cases the workflow tests did not reach. Five defects were found and fixed before this baseline; each now has a test in `tests/corner-cases.test.cjs`.

| Found | Fix | Test |
| --- | --- | --- |
| A point open all day (`00:00` to `23:59`) was closed in the last minute of the day, so a handoff then was refused | An opening-hours entry may close at `24:00`. This also allows hours past midnight, written as two entries. | "a point open until 24:00 is open in the last minute of the day, and hours can run past midnight" |
| `options.get` offered a kind of change when nothing could be chosen for it: a zero-day date window, no eligible pickup point, no other address | Such a kind is refused with `no_available_date` or `no_eligible_destination` | "an option is offered only when something can be chosen for it" |
| An empty or very long person name in the Task's binding made `collectors.list` and `grants.list` fail their output contract | A name is optional; none is shown for an empty one and the first 120 characters of a long one | "names from the binding may be missing, empty or very long" |
| Seed validation accepted a repeated tracking number and a pending request that could never be applied (superseded plan, missing destination) | Both are rejected when a seed is loaded | "every rule that makes a ledger incoherent is enforced when a seed is loaded" (63 rules, each checked for its own message) |
| With a run clock earlier than the loaded history, a preview said yes and the submission then failed | Preview, options and submission all give `invalid_time`; reads still work | "a run whose clock precedes the loaded history can read but not request anything" |

The same file also covers cases that already behaved correctly: day boundaries on daylight-saving days and in distant time zones, service days counted in the carrier's zone, times written with a UTC offset, the longest texts a seed and a carrier may supply, new IDs that do not collide with seeded ones, an empty ledger, a request still pending when the parcel is delivered, fails or goes out, a parcel moved before it reaches its point, a note-only point update, one person who is both a recipient and a collector, and one collector authorized for two parcels.

`tests/fuzz.test.cjs` is a random walk with fixed random seeds. From each catalog seed it applies random Agent operations and carrier events, valid, stale, out of order and unauthorized, adds new parcels as it goes, and after every step checks that: a refused step changed nothing; nothing failed in an unexpected way; closed parcels and decided requests never change; plan revisions and pickup epochs only grow; a pickup deadline never moves within one arrival; only events move a parcel or decide a request; a handoff consumes exactly one pass; no pass is active for a parcel that is not ready; and each person sees exactly their own parcels and those they are currently authorized for. The App's own seed rules and output contracts are also checked at every step. A short walk runs with `npm test`; the deeper search is in section 2.

A mutation analysis then measured how much the tests actually pin down. `scripts/mutation-analysis.cjs` changes the business code in one place at a time, an operator flipped or a statement removed, and runs the App-only tests against each change. The first run left 53 of 599 changes unnoticed. None of them exposed a defect, but about thirty were behaviour that no test fixed in place: the inclusive ends of date windows, the first instant after a hold ends, the opening and closing minute of a point, estimated delivery after a change, a repeated or misplaced failed-delivery report, events at the same instant, who receives a closure notice, the history of a request the system closes, what a collector sees while the recipient has a pending request, positive search matches and the open-only filter. `tests/boundaries.test.cjs` and eleven more incoherent-seed rules now cover them, and 589 of 599 changes are noticed. The ten that remain are checks that another rule already guarantees: for example, the handoff re-checks that a pass matches the current pickup epoch and point, which the seed rules already ensure for every active pass. They are kept as a second line of defence.

One measurement is not part of the test suite: a ledger at the schema's limit of 500 parcels, with about 1,500 requests and 4,000 notices, loaded and answered every tool; the rule check that runs after each commit took about 20 ms.

## 6. Evidence gates

| Gate | Verdict | Evidence and controls |
| --- | --- | --- |
| Package and contract | Passed | The verifier runs an isolated copy holding only this package. No dependency on another App. Business code imports only Node built-ins and package files. `tools.json` and the seed and event schemas are generated from one source and checked for drift. |
| Existing App dependencies | Not applicable | None declared or used |
| App-only business | Passed | 94 tests against the real hooks, including refusals, missing objects, invalid input, read-only behaviour, boundaries, corner cases and a random walk; every refused call or event is checked to leave data unchanged. A mutation analysis finds the tests notice 98.3% of single-place changes to the business code. |
| Real MCP | Passed | Verifier (46) and real-MCP check (105): discovery, calls, results matching committed state, forged person or account arguments rejected, reads that do not change the version |
| Authority | Passed | The Agent cannot call any `env.*` operation. Physical progress, decisions, handoffs and returns happen only through Infra events. Core object constraints limit a write to one parcel ("Write outside the permitted parcel is denied by Core"). |
| History and lifecycle | Passed | Infra loads history and every catalog seed; a failed load or event commits nothing; reset restores records, credentials and clock; runs are separate; another account needs an explicit trusted binding |
| Versions and concurrency | Passed | Retry deduplicated, changed payload rejected, stale version rejected, two concurrent handoffs give one success |
| Events and time | Passed | Ten event types with success and rejection paths; clock-only advance; exact-deadline boundaries; rejected events move neither clock nor data; replay is deterministic |
| Messaging | Not applicable | No channel is declared; cross-App messaging is outside the approved scope |
| Generic routing | Not applicable | The Messaging runtime is not changed |
| Resources | Not applicable | The App has no media or attachments; `capabilities.resources` is false |
| Optional diagnostics | Passed | An absent or failing log hook leaves results unchanged (App test). The host's diagnostics file records this App's steps and holds no pass code, address, name, tracking number or parcel description (real-MCP). Logging was not part of the approved scope. |
| GUI | Passed, author-run | Shared Web Host; real browser controls for every workflow's requests; the same state through MCP and after reload; stale edit and lost response; denied and forged requests sent directly; no downloadable state or source; untrusted text rendered as text; no script error or content-security violation |
| Human review | Pending | For reviewers |

## 7. Changes since the approved proposal

The proposal file is as approved. These are the places where v1 differs from its text or settles something it left open.

| Proposal | Delivered | Basis |
| --- | --- | --- |
| An App-owned local browser host and bridge, with packaging to agree at M0 (lines 44, 78, 81, 86) | The shared Web Host of runtime 1.6.0. The package supplies only the page and controller. | Review item 1, accepted in the PR on 2026-11-24 |
| Design baseline runtime 1.5.0 at `main` `718a4cb` (line 70) | Runtime 1.6.0 at `main` `a4bce02` | Review item 2 |
| Behaviour between a deadline passing and its event is not described (line 62) | Defined as in section 4 | Review item 2 |
| The illustrative `carrier.pickup_ready` payload carries `ready_at` and `pickup_deadline` (line 66) | The event carries the parcel, plan revision, point and pickup epoch. The ready time is the event time and the deadline is derived from the policy's pickup window. | The proposal marks these payloads as examples and leaves the mapping to M1. Deriving the deadline keeps it from being set twice. |
| Tool names and schemas to be finalized in M1 | Sixteen tools. `addresses.list` and `grants.list` are reads the proposal does not name; they are needed to choose an address (W1) and to inspect authorizations (W3). | Within W1 and W3 |
| Request rules left to M1 | A delivery date can be moved later, not earlier. An authorization longer than allowed is refused with the latest allowed time, not silently shortened. A request closed by the system carries a reason that starts with a code such as `return_started`. A kind of change is offered only when something can be chosen for it. Opening hours may close at `24:00`. | Design decisions; each is tested |
| One acting account per run | As proposed. Records carry no account field, so one ledger loads for a recipient, a collector or an unauthorized person by changing the acting account. | Simplifies the separate seeded runs the proposal specifies |
| Six planned views, 24 parcels, six identities, nine verified addresses, six points, six profiles, eight seeds | Delivered as planned. In addition there is a three-parcel default seed for the verifier and one unverified address used to test a refusal. | — |
| The Web App is started by the shared Host | It starts with a package-local registry (`web.registry.json`). The root `apps.registry.json` is not changed. | Whether to list this App in the root registry is left to maintainers |
| Effort of 4–5 and 1.5–2 person-days for the rows that include the browser bridge (lines 78, 81) | The bridge part of that work was not needed. No revised figure is given here; the author confirmed about 30 hours per week in the PR on 2026-11-24. | Review items 1 and 3 |

## 8. Not run, limits and remaining work

- **Agent trials: not run.** The proposal leaves the models, run count and spending cap to be agreed before any paid run. This needs a decision with the reviewers.
- **Independent reproduction: not run.** A reviewer or maintainer volunteer is still to be found, as the proposal plans for M4.
- **Human review: pending.** Workflow realism, usability and provenance.
- **Upstream browser CI does not cover this App.** The `business-web` job tests the seven reference Apps. The browser acceptance here is author-run and reproducible with the command in section 3.
- **Browser acceptance was not run on Node 18.** Playwright requires Node 20 or newer. Everything else ran on both Node 18 and 22.
- **Local reference profile only.** Remote authentication, HTTPS, multi-user sessions and production deployment are outside this profile and outside the approved scope. Simultaneous sessions of several people in one run are out of scope; separate seeded runs are used, as proposed.
- **Not in the root registry.** See section 7.
- **Screenshots and traces are not committed.** They are regenerated by the browser acceptance command.
- **The proposal file stays as approved.** The differences are recorded in section 7 of this report instead.
- **What the tests do not cover.** Browsers other than Chromium; an accessibility audit; Node versions other than 18 and 22; operating systems other than Linux; the random walk runs against the App's hooks, not through Core, whose own checks are covered by the verifier and the real-MCP check; a single parcel with more than 1,000 timeline entries, which is the schema's limit.
- **Planned for after v1.** Broader edge-case coverage from review feedback, the Agent trials and the independent reproduction above.

## 9. Acceptance checklist summary

| Requirement or mode | Required? Scope source | Verdict | Command or browser action | Observed | Gap and owner |
| --- | --- | --- | --- | --- | --- |
| Package and business tests | Yes, proposal validation acceptance | Passed | `npm test`, `npm run example` in the package | 94 of 94 on Node 18 and 22 | — |
| Public runtime and independent base | Yes, lifecycle merge protection | Passed locally | `npm run app:verify`, upstream `verify-submissions.cjs`, `tests/mcp/workflows.cjs` | 46, 46 and 105 checks; one package hash across all three verifier runs | CI on the submitted commit: see the PR |
| Cross-App integration | No, out of approved scope | Not applicable | — | No dependency, channel or receiver declared | — |
| GUI workflows and isolation | Yes, proposal and review item 1 | Passed, author-run | `tests/web/acceptance.cjs` | 76 checks across six kinds of run | Not covered by upstream browser CI; reviewer reproduction pending |
| Human workflow and provenance | Yes | Pending | — | [`PROVENANCE.md`](../PROVENANCE.md) lists every file group, the data sources and the references | Reviewers |
| Agent trials | Yes, proposal M4 | Not run | — | — | Author and reviewers: agree models, runs and cap |
| Independent reproduction | Yes, proposal M4 | Not run | — | — | Reviewer volunteer to be found |

**Recommendation.** Ready for implementation review of v1 against the approved proposal, with the differences in section 7 and the open items in section 8 visible. Acceptance and merge remain maintainer decisions.
