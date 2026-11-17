# Mendwell Pharmacy (Environment Track proposal)

## 1. App and domains

- **Authors / GitHub handles (required):** Xi Zhang (@X-iZhang)
- **Reference app or website / URL (required):** Mendwell Pharmacy, a synthetic US retail pharmacy; workflow reference: CVS Pharmacy (https://www.cvs.com/)
- **Primary domain (required):** Health & care
- **Secondary domains (optional):** Money & insurance

## 2. What you plan to build

**✍️ Your answer (required):** A resettable retail pharmacy (one fictional chain, three stores) where a household's prescriptions are requested, priced through the patient's drug plan, held for pharmacist review, collected in store, cancelled or returned to stock. The App records facts, statuses, pharmacist notes and consequences; it does not make clinical decisions, rank options or say what the right action is. No third-party code, brand assets or real patient data.

**Simulated policies and simplifications.** Time is Core's run clock; all stores share one time zone (America/New_York), used for opening hours and the 23:59 cut-off; money is USD in integer cents.

- A prescription is valid until 23:59 on its written date + 365 days. A fill is made when it first becomes `ready`, and every transition to `ready` checks validity and holds. If the prescription expires or is superseded before the fill is made, the fill is cancelled (reason `rx_expired` or `rx_superseded`) and any paid claim is reversed; a fill made before expiry can be collected afterwards.
- Review completes 2 hours after the request, or 2 hours after the next opening if the pharmacy is closed. A ready fill gets a warning after 7 days and returns to stock after 10 days; a hold pauses both, and they resume with the remaining time.
- Collection by anyone other than the patient or a guardian needs an in-app pickup grant. This is stricter than usual US practice, where pharmacists may use judgment, so that authorization is observable. A date of birth identifies a record but not the person at the counter, so collection is a scenario event checked by the counter.
- Stock is per-store availability, not quantities. Claims belong to the chain, so changing store keeps the claim. Any allowed quantity uses one whole fill. `not_covered` has no formulary-exception path.

**Workflows.**

1. **Household grants.** The patient, or a guardian of a minor, grants or revokes `view`, `refill` or `pickup` access with an optional expiry, after a user confirmation; only a `pickup` grant may be limited to one fill. Changes made by other household members outside the Agent arrive as `grant.changed` events.
2. **Prescriptions, fills and renewals.** One active fill per prescription. With no fills left or an expired prescription, the Agent can request or withdraw a renewal; the prescriber's reply arrives as an event, and approval supersedes the old prescription.
3. **Plan claims and recovery.** A claim is paid or rejected (`refill_too_soon` with an eligible date, `prior_auth_required`, `not_covered`, `quantity_limit`). Recovery: wait for the eligible date, ask the pharmacy to request an early-refill override or prior authorization from the prescriber and plan, change to an allowed quantity, pay cash, or cancel.
4. **Pharmacist holds.** A scenario places or releases a hold with a note (for example an interaction flag). A hold pauses review, resubmission, restock-to-ready and the pickup warning and return timers; prescription expiry and supersession still cancel unmade fills at their effective time. Collection attempts while held are refused (`on_hold`) and never queued. While held, `fills.choose_cash.confirm`, `fills.change_quantity`, `fills.change_store` and `fills.prepay.confirm` return `on_hold`; other calls behave as usual.
5. **Collection, payment, cancellation and return to stock.** Covered by the table and rules below.

| From | Trigger | To |
| :--- | :--- | :--- |
| — | `fills.request` (refill authority; Rx valid; fills remaining ≥ 1; no active fill; allowed quantity) | `requested` |
| `requested` | review completes → claim paid, stock / no stock / rejected | `ready` / `waiting_stock` / `claim_rejected` |
| `claim_rejected` | `fills.wait` (`refill_too_soon`), then the eligible date passes → claim resubmitted | `ready`, `waiting_stock` or `claim_rejected` |
| `claim_rejected` | `plan_requests.create` (`refill_too_soon` or `prior_auth_required`) | `pending_plan_decision` |
| `pending_plan_decision` | `plan.decided` approved → claim resubmitted | `ready`, `waiting_stock` or `claim_rejected` |
| `pending_plan_decision` | `plan.decided` denied, or `plan_requests.withdraw` | `claim_rejected` |
| `claim_rejected` | `fills.change_quantity` (`quantity_limit`) → claim resubmitted | `ready`, `waiting_stock` or `claim_rejected` |
| `claim_rejected` | `fills.choose_cash.confirm` | `ready` or `waiting_stock` |
| `waiting_stock` | `store.restocked` for this store and drug, or `fills.change_store` to a store with stock | `ready` |
| `ready` | `fill.collection_attempted` passing every check | `collected` |
| `ready` | 10 days unclaimed (hold time excluded) | `returned_to_stock` |
| any non-terminal | `fills.cancel.confirm`, or expiry or supersession before the fill is made | `cancelled` |

Rules:

- A scheduled resubmission is consumed when it starts and cleared whenever the fill leaves `claim_rejected`; if the claim is rejected again, no further automatic attempt is made. `fills.change_quantity` and `fills.change_store` are also allowed in `requested`; in `pending_plan_decision`, `fills.change_quantity` returns `request_pending`. A second pending renewal returns `duplicate_request`.
- The amount due is fixed when a fill becomes ready. Prepay is allowed only on a ready, unheld fill with no live authorization, by a card owner who can see that fill; it authorizes exactly the amount due on that card.
- `fills.set_collector` records the intended collector, who must be the patient, a guardian or hold a current pickup grant for the fill (otherwise `not_authorized`). The record is informational and is cleared when that grant ends; the counter checks authority, not the record.
- Collection succeeds only if the fill is ready and unheld, the store is open, the collector is the patient, a guardian or holds a current pickup grant, and payment succeeds (the live authorization is captured, or the collector pays with their own card; zero due needs no payment). It then captures payment once, uses one fill and ends the fill in one step. A failed check appends a refusal (`not_ready`, `on_hold`, `store_closed`, `collector_not_authorized`, `payment_failed`) and the eligible `notice.refused` entries; status and finances do not change.
- Cancellation and return to stock reverse a paid claim and void any live authorization; cancellation also withdraws a pending plan request. Fills remaining is unchanged.
- Terminal fills stay readable; mutating calls return `invalid_state`.

**Value for personal-agent tasks.** Acting for a family on medicines depends on whose prescription it is, what each person allowed, what the plan returned and what a pharmacist flagged. The App exposes reusable behavior, not one task's answer. Examples (separate Task proposals): collect an elderly parent's medicines on her preferred day under her grant, paying with the caregiver's own card; notice a pharmacist interaction note on her new antibiotic and raise it instead of only arranging collection.

**Boundary with #14 (proposed).** If both are built, the Northlake Patient Portal (#14) issues prescriptions and renewal decisions, and Mendwell owns fills, holds, claims, payment and collection; any connection is optional and would be agreed with that author. #14's first version excludes household proxies, so household grants live here.

## 3. Potential app connections

- **Internal personal apps (required):** Optional and send-only: Mail receives Mendwell notices through Mail 1.3.0's existing receive declaration (channel `channel.email`, wire `urn:pale:email-message:2`, payload `urn:pale:email-payload:1`, type `org.pale.mail.notification.v1`, receiver operation `mail.receive_notification`), pinned to PR #12 commit `34b6917` ([Mail 1.3.0 text-email wire schema](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/blob/34b6917/examples/apps/mail/schemas/router-message.schema.json)). Mendwell declares the matching `messaging.publishes` entry and builds the message; it builds no inbox. Calendar and Contacts: none; people, prescribers, plans and cards are records in Mendwell's seed.
- **Other apps and websites (required):** Optional: #14 as the source of prescriptions and renewal replies. Not required: a health-plan claims App; plan decisions can come from one if it is accepted later. Without either, these are scenario events, and Mendwell is complete and testable alone.

### Integration details

- **Operations and access (required):** 25 Agent-facing MCP operations. Read (8): `household.list`, `grants.list`, `cards.list` (own cards, masked), `stores.list`, `rx.list`, `rx.get`, `fills.list`, `fills.get`. Preview, read-only (4): `grants.change.preview`, `fills.choose_cash.preview`, `fills.prepay.preview`, `fills.cancel.preview`. Write (13): `grants.change.confirm`, `fills.request`, `fills.change_quantity`, `fills.change_store`, `fills.wait`, `fills.choose_cash.confirm`, `fills.set_collector`, `fills.prepay.confirm`, `fills.cancel.confirm`, `plan_requests.create`, `plan_requests.withdraw`, `renewals.create`, `renewals.withdraw`. The Agent acts as the bound account holder set by Infra, never through an argument.

  | Authority | Allows |
  | :--- | :--- |
  | Patient, or guardian of a minor | Everything for that patient; grant changes with a user confirmation |
  | `view` grant (patient-wide) | Prescriptions, fills, notes, claims and payments of that patient |
  | `refill` grant (patient-wide, includes `view`) | Requesting, changing, waiting, cash, plan requests, renewals, cancellation, naming a collector |
  | `pickup` grant (patient-wide or one fill) | Logistics view of the covered fills only (store, status, amount due, dates); being named collector and collecting |
  | Card owner who can see the fill | Prepaying it with their own card (a guardian may prepay a minor's fill) |

  Every delegated read, write and notice must match the grant's patient, scope, optional fill and expiry at that moment.

  Previews store nothing. A preview runs the same authority and state checks as its confirm and returns that error instead of a token; otherwise the token is a digest of the actor, the action (grant, revoke, prepay, cash or cancel), its full arguments (grantee, scopes, fill, expiry, card, amount), the run ID and the target object's own version (an App-maintained counter that changes only when that fill or grant changes, so unrelated writes and the approval event itself do not invalidate it). The confirm call restates those arguments, carries Core's current `expected_version` like any write, and recomputes the digest from current state. Approvals are stored in App data, so a reset discards them. `grants.change.confirm` and `fills.prepay.confirm` also need a `user.confirmed` event naming that token from the person who must approve (the grantor, or the card owner); it is single-use, expires after 30 simulated minutes and is consumed only by a successful commit. Confirm calls check authority, then the approval, then preview freshness, then state, and return the first failure. `fills.choose_cash.confirm` and `fills.cancel.confirm` are Agent confirmations of a current preview. Confirmation status is visible in `grants.list` and `fills.get`. Infra-only operations: `env.load_seed`, `env.apply_event`, reset and snapshot. App errors: `not_authorized`, `confirmation_required`, `confirmation_invalid`, `stale_preview`, `duplicate_request`, `no_fills_remaining`, `rx_expired`, `rx_superseded`, `quantity_not_allowed`, `store_unavailable`, `request_pending`, `request_not_pending`, `on_hold`, `payment_failed`, `invalid_state`, `not_found`; Core adds `idempotency_conflict` and `stale_version`.
- **State and lifecycle (required):** State is per run and account, loaded by `env.load_seed` and validated (unique IDs, grants consistent with patients and guardians, one active fill per prescription). Within an epoch, Core returns the stored receipt (marked duplicate) for an exact repeat of a committed request or event, and `idempotency_conflict` for the same ID with changed input; a new write or event with an old epoch or revision gets `stale_version`, and a fresh retry of a competing fill request then sees `duplicate_request`. A stale preview is rejected with no side effects. Collection refusals are committed events that append a refusal record and eligible notices; a failed Agent call changes nothing and sends no notice; ignored events append an audit record only. Reset is Core's new epoch with the seed restored and receipts, approvals and scheduled work cleared; an event sent with an earlier epoch's version gets `stale_version`.
- **Events and notifications (required):** Events use Core's envelope via `env.apply_event`: `rx.received`, `renewal.replied`, `plan.decided`, `grant.changed`, `fill.hold_placed`, `fill.hold_released`, `store.restocked`, `fill.collection_attempted` (collector, and card when paying at the counter), `user.confirmed`, `clock.advanced` (empty payload; moves time only). The clock moves only through events; for each event Mendwell applies timers due before its time, then the event, then timers due at that time. A `plan.decided` or `store.restocked` event for a held fill is stored and applied at release only if its target is still pending or waiting. Late events have no effect: `plan.decided` applies only to a pending request linked to the current claim attempt, `renewal.replied` only to a pending renewal, and `store.restocked` moves only waiting fills. Example: `{"event_id": "ev-7", "at": "2026-12-04T10:00:00-05:00", "operation": "plan.decided", "payload": {"plan_request_id": "pr-12", "decision": "approved"}}`. Notices: `notice.fill_ready`, `notice.return_warning`, `notice.returned`, `notice.refused`, `notice.held`, `notice.released`, `notice.claim_rejected`, `notice.plan_decision`, `notice.renewal_reply`, `notice.payment_voided`. Recipients are computed at send time from current grants: the patient, guardians and `view` holders get all notices; `pickup`-only holders get only the four logistics notices (ready, return warning, returned, refused) with store, fill ID and amount due; `notice.payment_voided` also goes to the card owner. Each notice is one log entry per recipient. An Infra-run sender adapter reads the log and calls `router.publish` for recipients with a bound Mail account and grant. A rejected delivery leaves Mail unchanged and does not roll back Mendwell; an unknown acknowledgement stops the run for reconciliation.
- **Shared data and dependencies (required):** Stable IDs for people, prescribers, plans, cards, stores and fills; prescriber IDs can map to #14. Notices are plain text, without attachments. Each clinical fact in fixtures cites its product-label section in `contribution/dataset.json`. Runtime needs: the public Core/Messaging runtime in PR #12 (runtime 1.4.0); Mail is optional; no external service.

## 4. Construction plan and effort

**✍️ Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| :--- | :--- | :--- | :--- |
| Web / app construction | `apps/mendwell-pharmacy/` per the App guide in PR #12: 25 operations, 8-state fill machine, permission table, previews and confirmations, event and timer handling, notice log. Reuses the reference package layout, schema contracts and test harness; no GUI | Every transition and rule above works; no terminal state without its authority, confirmation or payment; failures leave status and finances unchanged | 3–3.75 |
| Data and image collection | N/A: no crawling or copied content; record public workflow references | Provenance in `contribution/dataset.json` | 0.25 |
| Synthetic data and assets | One four-person household (account holder, spouse, child, elderly parent living separately), 12 prescriptions with generic drug names, 3 stores, 2 plan rule sets with price tables, 4 cards (valid, declined, expired, another owner's), grants of each kind, one fixture per test | Seed passes validation; each clinical fact cites a label section; no real people, brands or patient data | 0.75–1 |
| App integrations | Optional Mail notices: notice log plus an Infra-run sender adapter on Mail 1.3.0's receive contract; recipient accounts bound per run | Each delivered notice appears as a received message with a committed receipt in the bound Mail account; a rejected delivery creates no receiver record and leaves Mendwell's committed state; the App runs fully without Mail | 0.75–1 |
| Validation and reset | Local business tests below, then the public verifier (`app:verify --app apps/mendwell-pharmacy`) for real MCP: Agent versus Infra authority, seed loading, event and timer order, deduplication, stale writes, failure atomicity, reset; one Mendwell → Mail flow with the receiver record | After implementation: App and runtime versions, commands, reproducible reports and a workflow-to-test mapping; remaining manual review listed | 2–2.5 |

**Acceptance plan.** Each line: initial state → action or event → expected result; failure control.

| Workflow | Main path | Control (what stays unchanged) | Tests |
| :--- | :--- | :--- | :--- |
| W1 Grants | Pickup grant from an elderly parent to her caregiver; ready, unheld fill → caregiver's collection at an open store → `collected`, captured once, fills −1 | `grant.changed` revokes first → refusal `collector_not_authorized`; collector cleared; status and finances unchanged | T15–T18, T20 |
| W2 Renewals | Rx with 0 fills → `fills.request` → `no_fills_remaining`; renewal approved → new Rx, old superseded | Reply after `renewals.withdraw` → recorded, no new Rx | T01–T04 |
| W3 Claims | `prior_auth_required` → plan request denied → cash confirm, store in stock → `ready`, `notice.fill_ready` | Decision for a withdrawn request → no change | T05–T11 |
| W4 Holds | Fill in review → `fill.hold_placed` → no `ready`, timers paused; release → stored events applied if still relevant | Collection while held → refusal `on_hold`, not replayed after release | T10, T14 |
| W5 Collection, cancellation | Prepaid ready fill → `fills.cancel.confirm` → `cancelled`, claim reversed, authorization voided | A fresh prepay with a consumed approval → `confirmation_invalid`, no new authorization; identical cancel retry → original receipt; a new cancel preview on the terminal fill → `invalid_state`, and a confirm with a pre-cancellation token → `stale_preview` | T01, T12, T13, T15, T16, T19, T20 |

Local business tests (workflow in brackets):

- T01 [W2, W5] `rx.received` → request → reviewed after 2 hours → ready → collected; fills −1 once.
- T02 [W2] Request while a fill is active → `duplicate_request`; concurrent stale write → `stale_version`, retry → `duplicate_request`.
- T03 [W2] No fills → `no_fills_remaining`; expired → `rx_expired`; renewal approved; old Rx → `rx_superseded`; new fill collected.
- T04 [W2] Renewal denied; second pending renewal → `duplicate_request`; reply after withdrawal ignored; withdrawing again → `request_not_pending`.
- T05 [W3] `refill_too_soon` → wait → resubmitted at the eligible date → ready; rejected again → no further automatic attempt; choosing cash first clears the resubmission.
- T06 [W3] Early-refill override approved → ready.
- T07 [W3] Prior authorization denied → cash → collected at the cash price.
- T08 [W3] `not_covered` → `plan_requests.create` → `invalid_state`; cash or cancel only.
- T09 [W3] `quantity_limit` → allowed quantity → paid; disallowed → `quantity_not_allowed`; change while a plan request is pending → `request_pending`.
- T10 [W3, W4] Request withdrawn then decided → ignored; decision during a hold, withdrawal, release → no effect.
- T11 [W3] Paid without stock → restock → ready; store change with stock → ready, claim kept; without → `store_unavailable`; expiry while waiting → `cancelled`, claim reversed.
- T12 [W5] Cancel from each non-terminal state: claim reversed, authorization voided, plan request withdrawn, resubmission cleared.
- T13 [W5] `clock.advanced`: warning on day 7, return on day 10, claim reversed, fills unchanged; a collection submitted as the first event at the deadline applies first.
- T14 [W4] Hold defers review; collection while held → `on_hold`, not replayed; prepay while held → `on_hold`; a decision stored during the hold applies at release only if still pending; timers resume with remaining time.
- T15 [W1, W5] Caregiver collects under a pickup grant and pays with her own card.
- T16 [W1, W5] Prepay with the parent's card → `not_authorized`; declined card → `payment_failed`; second prepay with a live authorization → `invalid_state`; a card owner who can see only fill A prepays fill B with their own card → `not_authorized`.
- T17 [W1] Pickup grant limited to fill A: logistics view of A only; fill B and the prescription list → `not_authorized`; logistics notices for A only.
- T18 [W1] Revocation by `grant.changed` before collection → refusal `collector_not_authorized`; unrelated adult granting → `not_authorized`; guardian acting for a minor succeeds.
- T19 [W5] Counter payment declined → refusal `payment_failed`, finances unchanged; outside hours → `store_closed`; non-ready fill → `not_ready`; zero due collects without payment.
- T20 [W1, W5] Grant and prepay each succeed with a matching approval; confirm without approval → `confirmation_required`; expired, reused or mismatched → `confirmation_invalid`; changed target → `stale_preview`.
- T21 [all] Repeated request ID → stored receipt; same ID with a changed payload → `idempotency_conflict`; unknown fill → `not_found`.
- T22 [all] Repeated event ID → stored receipt, no second effect; a write with a pre-reset version → `stale_version`; terminal fills readable, mutating calls → `invalid_state`; reset restores the seed.

Each test also asserts the notice-log entries its transitions produce.

- **Milestones, owners and dependencies (required):** M1 design review; M2 package, seed and local tests; M3 public-verifier checks and the Mendwell → Mail flow; M4 reports and maintainer reproduction. Owner: @X-iZhang. Calendar time: 2–3 weeks of part-time work after approval. Dependency: the public runtime and App guide in PR #12 (M3 adapts if they change before merge). Mail, #14 and a claims App are optional.
- **Resources and total effort (required):** 6.75–8.5 person-days, assuming reuse of the reference package layout and harness, no GUI and no media. No paid data, model or API cost, or external service; fixtures under 10 MB; Node.js 18 or later.
- **Scope boundary and open questions (required):** Excluded: delivery, partial fills, transfers, medication synchronization, lot recalls, auto-refill, controlled substances, vaccinations, front-store shopping, real payments, clinical decisions, compounding, specialty and mail-order pharmacy, notice attachments. Platform questions: whether approvals stay as `user.confirmed` events or move to a native channel; final method names after PR #12 merges. The #14 boundary awaits that author's view.
- **License and external dependencies (required):** MIT for code and synthetic fixtures, redistributed in this repository; no hosted component. Product pages are references only. No external service at run time.
