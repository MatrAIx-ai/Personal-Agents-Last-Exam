# TransitWallet 0.1.0

Original synthetic reservation and accessibility-assistance App for PALE. Maintainer: Hanson Tang (@hansontang). Implements the MCP-only scope approved in [PR #149](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/149) at `9029d78740afad423db6a1bc379c254ce2fe6e0c`.

The package distinguishes a free hold, a paid ticket, equipment measurement, provider assistance, a selected journey, actual departure and actual arrival. It uses public runtime 1.6.0 / Core API 1.2.0. It contains no replacement Core, live provider, GUI, outbound messaging, payment service or model evaluation harness.

## Run and verify

Node.js 18+, built-in modules only, no package installation or credentials:

```sh
cd apps/transitwallet
node --test tests/business.test.cjs
node examples/run.cjs
```

From a PALE public checkout:

```sh
node runtime/build-contracts.cjs --check
node runtime/cli.cjs verify --app apps/transitwallet --output .artifacts/transitwallet-public.json
node apps/transitwallet/tests/runtime.cjs
```

The public verifier copies this exact package without a runtime sibling for the business tests/example. The workflow check uses actual public Core and independent stdio MCP clients. An outside checkout can set `PALE_RUNTIME_ROOT` to a public `runtime/` directory. `TRANSITWALLET_REPORT` can choose the workflow JSON report path. App-only tests do not establish transport, locking or identity enforcement; those are tested separately through Core.

## Business operations

All tools start with `transitwallet.`. Every write requires Core `expected_version` and `request_id`. Use the version returned by a fresh read; for an uncertain retry resend the exact original arguments, including the original expected version. Reusing an ID for different arguments conflicts. Core binds the role, run and account; these cannot be supplied by the Agent.

| Tools | Result / effect | Important failures |
| --- | --- | --- |
| `workspace.get`, `records.list`, `records.get` | Bound account, current equipment and context records; no mutation | `not_found` |
| `routes.list`, `bookings.list`, `requests.list`, `journeys.list`, `wallet.get` | Dated services and free capacity, stored/effective booking status, exact requests, physical outcomes, complete ledger | Invalid arguments |
| `booking.hold` | Create free hold for `service_id` and `equipment_id`; return generated ID and booking attempt | `window_closed`, `service_unavailable`, `capacity_exceeded`, `booking_exists` |
| `booking.preview` | Read-only confirm/cancel quote for `id` and `action`; no persisted quote or charge | `invalid_state`, `hold_expired`, `cancellation_closed` |
| `booking.confirm`, `booking.cancel` | Apply matching `quote_digest`; return booking and new immutable ledger rows | `quote_changed`, `insufficient_funds`, state/window errors |
| `verification.request`, `verification.cancel` | Request a measurement for known equipment, or cancel a pending request by ID | `request_exists`, `request_not_pending`, `wrong_subject` |
| `assistance.request`, `assistance.cancel` | Request for `booking_id`, `declared_width_mm`, `equipment_revision`; retain that snapshot; cancel before departure | `request_exists`, `invalid_state`, `departure_started` |
| `journey.plan`, `journey.cancel` | Designate a confirmed ticket; cancel a not-yet-departed designation without refunding its ticket | `already_selected`, `invalid_state`, `departure_started` |

Core wraps business values as `{status, app_id, version, value}`. For example, `booking.preview` returns `value.quote.digest`; the following financial write supplies that digest. These two calls are business confirmation, not proof of human consent. The App validates technical funds; user spending permission is a separate Task/user constraint.

## States, money and changes

Booking state is `held -> confirmed -> consumed` or `held/confirmed -> cancelled`. An unconfirmed hold becomes **effectively** expired when `virtual_now` reaches its hold/confirmation cutoff. The stored `held` record remains unchanged; `bookings.list` returns both statuses. Effective expiry releases reservable capacity and makes confirmation fail even if no event arrives. Closing timestamps are exclusive. Free expired holds can be explicitly cleaned up without a fee.

Holds do not charge. Confirmation appends a debit for the locked fare. Eligible paid cancellation appends a refund equal to fare minus the disclosed retained fee, including a zero refund for a non-refundable offer. No prior row is edited or deleted. A booking can have at most one debit and one qualifying refund. Balance derives from one original opening credit and those ordered rows. No Agent tool can add funds, invent a refund or rewrite fare policy.

Rescheduling is **non-atomic cancel-and-rebook**: obtain a free replacement hold, cancel/refund the old booking, confirm the new one and request its own assistance/designation. Each step has a receipt. A later failure does not undo an earlier cancellation. Cancelling a booking also cancels its active assistance and designation while retaining earlier replies. It does not discard equipment observations. Cancelling only a journey does not cancel/refund its ticket.

Measurement requests progress from pending to performed/refused, or may be cancelled while pending. Assistance progresses from pending to confirmed/refused; pending/confirmed assistance can be cancelled before departure. A provider's confirmation is for its declared equipment snapshot. It can be stale or physically inadequate even though it was legitimately confirmed. The App does not infer dimensions from the user's personal notes or silently substitute a newer snapshot.

Journeys are planned, cancelled, in transit, failed or completed. A provider departure event consumes the ticket and evaluates actual equipment, service availability, readiness and matching assistance. Physical failure is a committed failed outcome with reasons, not an infrastructure error or a refund. Only a separate arrival event can complete actual travel. The App does not reveal a future arrival at departure. Post-departure compensation is outside v1.

## Infra events and time

Only Infra can call `env.load_seed`, `env.apply_event`, `env.reset`, `env.snapshot`, `env.event_status`, `env.validate_bundle` and host-provided `env.advance_time`. A supplied Agent connection cannot discover or call them.

Events have `{event_id, at, operation, payload}` and explicit-offset times. Accepted families are:

| Operation | Matching / effect |
| --- | --- |
| `record.add` | New unique record ID plus known source; append context |
| `route.update` | Known dated service and owning provider; change status/physical width and append its history; schema rejects price/fee edits |
| `verification.reply` | Exact `{equipment_id, kind, request_attempt}`; pending request and requested person; append measurement/refusal |
| `assistance.reply` | Exact `{service_id, booking_attempt, request_attempt}`; pending request, owning provider and declared equipment revision |
| `journey.perform` | Exact `{service_id, booking_attempt, journey_attempt}`; provider departure at the dated service departure, then separate arrival |

See `schemas/events.schema.json` for complete typed payloads. Measurement replies cannot replace a newer observed revision or assign two widths to the same revision. A departure can record a newer authoritative physical observation, preserving older request snapshots.

Attempts are derived monotonically from retained historical objects, so cancellation/recreation never reuses a generation in the run. Missing or inactive targets, wrong subjects/sources and wrong generations fail without changing accepted business state or the clock. A duplicate selector is an invalid seed, not an invitation to choose an arbitrary request. Core handles exact event replay and conflicting event IDs.

`examples/actor-driver.cjs` is a runnable public-interface adapter. It first captures a run/account/epoch scope and resolves intent against real `env.snapshot` data to a specific generation. A prepared callback later applies **that same generation**; cancellation/recreation does not retarget it. Reset invalidates the prepared scope. No applicable request emits no completion event. Actual user/provider decisions, observations and event timing are supplied by the caller; this adapter is not a user simulator or scheduler.

All business checks use `ctx.virtual_now`. Reads and Agent writes do not advance it; `env.advance_time` does not execute handlers. The Infra caller must process due events in chronological order before advancing beyond them, with an explicit order for ties. Rejected events roll back data/time; ordinary denial audit may remain. Core audit, business history, ledger `source_id`, reply event IDs and journey departure/arrival event IDs permit correlation.

## Seeds, ownership and reset

There are three original fictional account seeds: `minimal.json` (Nia), `account-sam.json` and `account-jo.json`. They include 2026 funding history and 2027 dated services/context. Each instance exposes one bound account. Every referenced equipment, booking, service, request, journey and ledger object is checked; wrong ownership, duplicate IDs/selectors, inconsistent prices/postings and future actual facts reject. Business JSON is limited to 512 KiB, separate from the runtime's decoded-asset limit. There are no assets.

`env.load_seed` accepts different task history/binding/time after validation. Changing accounts requires an explicit trusted binding. Sessions preserve holds, requests/replies, bookings, ledger and outcomes. `env.reset` restores this instance's latest loaded business/time baseline and advances the epoch; it does not reset other Apps. Export evidence before reset/seed replacement clears lifecycle receipts.

## Provenance and limits

All people, notes, routes, dimensions, fares, cutoff rules and provider results are authored synthetic examples under MIT. Public App packaging/launcher/contracts are reused from the public reference templates; business functions do not import another App or runtime internals. TfL accessibility guidance informed the general workflow only; no TfL fare or service promise is reproduced.

The reservation wallet is independent of Hopline #171's fare card. There is no transfer or balance synchronization between Apps. V1 excludes live bookings/payments, group tickets, atomic exchanges, transferred assistance clearance, GUI, outgoing messaging and automatic post-travel compensation. It does not enforce every personal privacy/consent/continuity rule. Human realism/provenance review and independent maintainer acceptance remain separate; local tests do not establish model difficulty or an accepted contribution.
