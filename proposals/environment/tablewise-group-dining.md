# Environment Track proposal

Proposed PR title: `[Environment Proposal] [Food & dining] Restaurant reservations and dining coordination (OpenTable-inspired)`

## 1. App and domains

- **Authors / GitHub handles (required):** Genglin Liu ([@genglinliu](https://github.com/genglinliu)).
- **Reference app or website / URL (required):** [OpenTable](https://www.opentable.com/), especially [reservations](https://help.opentable.com/s/article/How-do-I-make-a-reservation-1505260085031?language=en_US), [private dining](https://help.opentable.com/s/article/privatedining?language=en_US) and [deposit/cancellation policies](https://help.opentable.com/s/article/What-are-cancellation-no-show-and-deposit-policies?language=en_US). The package keeps the ID `tablewise`; venues, prices, policies and assets are synthetic.
- **Primary domain (required):** Food & dining
- **Secondary domains (optional):** None

## 2. What you plan to build

**✍️ Your answer (required):** One restaurant app for ordinary reservations, special-occasion dinners and group/private dining. The flows share availability, holds, booking previews, deposits, changes, cancellation/refunds and notifications. The Agent chooses venues, coordinates guests and manages any backups. The app records actual commitments and their consequences.

This scope incorporates the fine-dining workflows from [#41](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/41). Implementation and acceptance will be tracked as one environment in this PR; #41 retains the original discussion.

Six workflows:

1. **Find venues and availability.** Search date, time, party size, location, cuisine and price; inspect menus, facilities, accessibility and booking terms. Missing attributes are unknown. Show released slots and published advance-release rules.
2. **Hold and confirm.** Where supported, hold capacity until a visible expiry. Preview the exact slot, headcount, menu, all-in estimate, deposit/prepayment and cancellation terms, then confirm under current authority. Return a durable reservation and payment receipt.
3. **Change, cancel and reconcile costs.** Preview a modification or cancellation against current terms. A failed modification preserves the original booking. Record deposit, fee, pending refund and actual refund separately.
4. **Follow releases and waitlists.** Register/edit/cancel subscriptions and waitlist entries. Distinguish an availability notice from a held offer with a claim deadline; accept/decline held offers. The Agent checks availability and decides its next action.
5. **Arrange groups/private dining.** Maintain an outing's invited/accepted/pending/declined participants and scoped dietary notes. Request a room/menu quote or book an instantly available space. A venue response supplies actual availability and dietary acknowledgements. Record expected attendance separately from the guaranteed headcount and minimum spend.
6. **Communicate and track shared costs.** Preview recipients/content, publish permitted updates and download receipts/statements. Allocate expected shares and record sourced contributions/refunds and outstanding amounts. Inviting a person creates no payment.

The App holds one active dining plan per run, with multiple candidate bookings when policy permits, plus read-only past outings and booking history. It provides dining-specific coordination; community membership, posts and general group chat remain with their own Apps.

### Booking rules and backup strategies

OpenTable's diner FAQ describes a 2.5-hour gap between reservations on one account. Two clearly named synthetic policy profiles will make overlap behavior explicit:

- `strict_gap`: reject a new confirmed reservation whose start is less than 150 minutes from another active one on the account.
- `bounded_overlap`: allow at most two active reservations under both the published platform policy and the user's current grant. This is a synthetic extension for testing backup management.

Both profiles apply venue capacity, spending/deposit limits and cancellation terms. Short holds and unprotected availability notices have their own limits and status. The Agent's notes can identify primary/backup choices; the App supplies reservation facts. Each backup has its own cutoff, and a Task can supply an earlier overall cleanup deadline.

For a birthday dinner, the Agent may retain an allowed fallback, check the preferred venue when booking opens, verify a successful replacement and cancel unused bookings in time. Under strict rules it must work within the conflict policy. Group scenes add quoted menus, guaranteed numbers and venue-confirmed arrangements.

## 3. Potential app connections

- **Internal personal apps (required):** Mail 1.3.0 is required for the connected demonstration. Calendar 1.3.0, Contacts 1.0.0 and Messages 1.0.0 are optional. The App runs independently with its own records. Public runtime 1.6.0/Core API 1.2.0 and contracts below are pinned to main `a4bce023953061483c41de5a287ba5e43f4a5648`.
- **Other apps and websites (required):** Package-local venue services and payment records; future optional links to reviews (#66) and person-to-person payments (#68). The initial cost ledger records simulated deposits and sourced contributions.

| Workflow | Caller, direction and public interface | Result / verification |
| :--- | :--- | :--- |
| Confirmations, invitations, offers and changes | Tablewise publishes; Infra routes to [Mail](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/blob/a4bce023953061483c41de5a287ba5e43f4a5648/examples/apps/mail/contribution/contribution.json) `channel.email` / `mail.receive_notification` | Actual mailbox message plus Messaging receipt; IDs in visible text |
| Send receipt/statement files | Publisher through Mail `channel.email.attachments` / `mail.receive_attachments` | Read original attachment bytes/hash with `mail.attachment.get` |
| Read venue emails | Agent: [Mail tools](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/blob/a4bce023953061483c41de5a287ba5e43f4a5648/examples/apps/mail/tools.json) `mail.search/get` | Task/Infra seeds direct venue messages; retain source/message references |
| Check dates and maintain calendar entries | Optional Agent: [Calendar](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/blob/a4bce023953061483c41de5a287ba5e43f4a5648/examples/apps/calendar/tools.json) `calendar.list/get/freebusy/create/update/cancel/import_ics` | Read actual event; exported ICS uses run/epoch/reservation ID in UID |
| Resolve people | Optional Agent: [Contacts](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/blob/a4bce023953061483c41de5a287ba5e43f4a5648/apps/contacts/tools.json) `contacts.list/get` | Retain Contacts ID and run-bound person reference |
| Coordinate through chat | Optional Agent: [Messages](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/blob/a4bce023953061483c41de5a287ba5e43f4a5648/apps/messages/tools.json) `messages.list/get/send` under its own grants | Actual conversation/message references; Tablewise publishes to Mail only |

Mail recipients are the account holder or participant mailboxes explicitly enabled and granted in the run. Participants without Mail still have source-backed responses and local delivery records. Calendar updates are Agent tool calls. Mail is a run-assembly recipient, not a required package dependency.

### Integration details

- **Operations and access (required):** Agent MCP and the business GUI share handlers. The proposed tool directory will become versioned schemas at M1.

| Operations | Effect |
| :--- | :--- |
| `dining.venues.search/get`, `dining.availability.get` | Read details, released capacity and public rules |
| `dining.plans.create/update/get` | Write/read the outing, invited people and sourced notes |
| `dining.inquiries.create/get`, `dining.quotes.get` | Write a venue/menu/dietary request; read actual replies/quotes |
| `dining.holds.create/release` | Hold/release available capacity within limits |
| `dining.reservations.preview/confirm/get` | Store an exact versioned preview; commit/read a booking and deposit |
| `dining.reservations.change_preview/change_confirm/cancel_preview/cancel_confirm` | Store previews; commit one modification or cancellation |
| `dining.waitlists.create/update/cancel`, `dining.offers.accept/decline` | Maintain waitlists and respond to held offers |
| `dining.subscriptions.create/update/cancel` | Maintain App-owned notice preferences |
| `dining.notices.preview/publish` | Store recipient/content preview; commit a permitted notice |
| `dining.costs.allocate/get`, `dining.receipts.get`, `dining.calendar.export_ics` | Write share plans; read costs, original receipts or ICS bytes |

Stored previews are writes; their validity and referenced revisions are visible. Confirmation recomputes capacity, time-sensitive fees and terms; changed totals or cutoffs require a fresh preview. Core controls tool/object/field permissions. App-owned authorization records add dates, venues, party-size, charge/deposit/fee-exposure and active-booking/hold caps, expiry and permitted sharing audiences. Infra seeds/updates/revokes these records from trusted user decisions with provenance; Agent tools use them. Confirm/offer acceptance checks authority and platform rules and commits the reservation and initial deposit together. Charge caps apply per action; deposit and fee-exposure caps aggregate outstanding commitments for the plan. Revocation blocks subsequent covered actions while existing bookings remain visible.

Infra alone uses `env.load_seed/apply_event/reset/snapshot/event_status/advance_time`. Other diners and venues act through its source-referenced events. Participant consent, kitchen acknowledgement and actual contribution/payment records come from those actors.

- **State and lifecycle (required):** Separate run/binding, venue/menu/policy, and account/plan business records. Participants reference the binding's `person_id`, plus Contacts IDs when enabled; only outing-specific responses and audience-scoped notes live here. Seeds accept past outings/preferences, invitations/replies, quotes, holds, reservations, waitlists/offers, authorizations, subscriptions, deposits, pending refunds and contributions.

Writes carry `request_id` and Core `expected_version` (`epoch`, `revision`). An unchanged retry returns the original receipt; changed-content reuse conflicts and stale new writes fail. Reads preserve business state. Confirmed bookings freeze accepted quote/policy versions. Quote updates invalidate pending previews; existing confirmations keep their terms until an explicit authorized change or venue cancellation.

`reset_scope: app_instance`: reset returns this App to its loaded baseline and clock and clears Core audit/receipts. Export evidence first. Mail/Calendar and Agent memory/timers are managed separately by the runner. Persisted state supports restart; saved-history import establishes a new baseline. Coordinated historical rollback is deferred.

- **Events and notifications (required):** Use `ctx.virtual_now` and the [time contract](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/blob/a4bce023953061483c41de5a287ba5e43f4a5648/docs/runtime-time.md). The runner owns event/delivery cursors, due-event ordering and clock barriers. Initial scenes use Infra-driven time and scheduled sessions. Agent-owned wakeup registration/cancellation remains a platform/runner dependency, owned by those maintainers.

Each accepted event uses `{event_id, at, operation, payload}`. These independent examples refer to records/assets in their source scene.

| `event_id` | `at` | `operation` | `payload` |
| :--- | :--- | :--- | :--- |
| `grant-1` | `2026-12-01T09:00:00-08:00` | `dining.authority_recorded` | `{"grant_id":"g1","venues":["venue-a","venue-b"],"date_from":"2026-12-19","date_to":"2026-12-20","max_party_size":8,"max_active_bookings":2,"max_active_holds":1,"max_charge_cents":20000,"max_deposit_cents":30000,"max_fee_exposure_cents":20000,"expires_at":"2026-12-20T18:00:00-08:00","source_ref":"user-turn-1"}` |
| `revoke-1` | `2026-12-01T10:00:00-08:00` | `dining.authority_revoked` | `{"grant_id":"g1","source_ref":"user-turn-2"}` |
| `reply-1` | `2026-12-01T10:00:00-08:00` | `dining.participant_replied` | `{"plan_id":"plan-1","person_id":"guest-1","status":"declined","source_ref":"guest-reply-1"}` |
| `quote-1` | `2026-12-01T10:00:00-08:00` | `dining.venue_quoted` | `{"inquiry_id":"inquiry-1","venue_id":"venue-a","quote_id":"q1","quote_revision":1,"terms_asset_id":"q1-terms","valid_until":"2026-12-02T10:00:00-08:00"}` |
| `dietary-1` | `2026-12-01T10:00:00-08:00` | `dining.dietary_replied` | `{"request_id":"diet-1","venue_id":"venue-a","quote_revision":1,"status":"supported","text":"The requested menu adjustment is available.","source_ref":"kitchen-reply-1"}` |
| `stock-1` | `2026-12-01T10:00:00-08:00` | `dining.inventory_changed` | `{"slot_id":"slot-1","external_booked_seats":2,"source_ref":"other-booking-1"}` |
| `offer-1` | `2026-12-01T10:00:00-08:00` | `dining.offer_received` | `{"entry_id":"wait-1","offer_id":"offer-1","kind":"held_offer","slot_id":"slot-1","seats":2,"claim_by":"2026-12-01T10:10:00-08:00"}` |
| `venue-cancel-1` | `2026-12-01T10:00:00-08:00` | `dining.venue_cancelled` | `{"reservation_id":"r-1","reason":"Venue closure","refund_due_cents":10000,"source_ref":"venue-notice-1"}` |
| `terms-2` | `2026-12-01T10:00:00-08:00` | `dining.terms_published` | `{"venue_id":"venue-a","revision":2,"terms_asset_id":"venue-a-terms-v2","source_ref":"venue-policy-2"}` |
| `refund-1` | `2026-12-02T10:00:00-08:00` | `dining.refund_recorded` | `{"refund_id":"refund-1","reservation_id":"r-1","amount_cents":10000,"status":"paid","source_ref":"refund-proof-1"}` |
| `contribution-1` | `2026-12-01T10:00:00-08:00` | `dining.contribution_recorded` | `{"contribution_id":"c1","plan_id":"plan-1","person_id":"guest-1","amount_cents":2500,"source_ref":"guest-payment-1"}` |
| `attendance-1` | `2026-12-20T20:00:00-08:00` | `dining.attendance_recorded` | `{"reservation_id":"r-1","status":"no_show","source_ref":"venue-attendance-1"}` |

Validate references, source role and revision. Repeated event IDs return the original outcome; changed-content reuse and stale/unauthorized events fail. Payment/refund/contribution IDs also prevent duplicate effects across different events.

**Time and effects.** Release opening is calculated from the published venue rule and timezone (rolling or monthly), including DST; stock updates are explicit events. Before release, tools show the rule and `not_yet_released`. Holds/offers work while `now < expires_at/claim_by`; expired allocations stop consuming capacity in derived availability. Reads compute this without mutation. Time advancement triggers no notice or App handler.

An availability notice protects no seats; a held offer does until its deadline. Accepting a held offer consumes its protected allocation and creates one booking/receipt. Competing bookings consume unheld capacity; active holds protect their seats. Failed confirms preserve any still-valid hold. Price/quote changes require a fresh preview. Participant declines change expected attendance; guaranteed headcount and deposit change only after a confirmed amendment. After headcount lock, the accepted minimum remains in effect under the venue's terms. Dietary requests are unresolved until a venue reply identifies its scope; changed menu/headcount can require a new acknowledgement.

At `free_cancel_until`, the free window ends. Cancellation/no-show uses the accepted fee schedule, credits any retained deposit once, and records new charges/refund due. Refunds remain pending until their own source event; paid totals cannot exceed amounts due. Same-time ordering belongs to Task/Infra.

**Mail directions.** Tablewise is send-only on Mail [text wire v2](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/blob/a4bce023953061483c41de5a287ba5e43f4a5648/examples/apps/mail/schemas/router-message.schema.json) and [attachment wire v1](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/blob/a4bce023953061483c41de5a287ba5e43f4a5648/examples/apps/mail/schemas/router-attachments.schema.json). Subscriptions belong to Tablewise. Local audience checks and routing grants both apply. Stable IDs and the actual recipients are retained; notice failure preserves committed booking state. Unknown acknowledgement is reconciled before retrying the same notice.

Text example, addressed to the account holder enabled in the run:

```json
{"specversion":"1.0","id":"tw-r-1-confirmed","source":"urn:pale:tablewise:host-account","type":"org.pale.mail.notification.v1","time":"2026-12-01T10:00:00-08:00","datacontenttype":"application/json","dataschema":"urn:pale:email-payload:1","data":{"channel":"channel.email","recipient":{"kind":"person_ref","id":"host-1"},"source_object":{"app_id":"tablewise","account_id":"host-account","object_type":"reservation","object_id":"r-1"},"content":{"title":"Reservation r-1 confirmed","body":{"format":"text/plain","text":"r-1: Venue A, December 20 at 19:00 -08:00, 2 guests. Deposit USD 100.00. Free cancellation ends December 19 at 19:00 -08:00."},"asset_ids":[]},"extensions":[]}}
```

Attachment example:

```json
{"specversion":"1.0","id":"tw-r-1-receipt","source":"urn:pale:tablewise:host-account","type":"org.pale.mail.attachments.v1","time":"2026-12-01T10:00:00-08:00","datacontenttype":"application/json","dataschema":"urn:pale:email-attachments-payload:1","data":{"channel":"channel.email.attachments","recipient":{"kind":"person_ref","id":"host-1"},"source_object":{"app_id":"tablewise","account_id":"host-account","object_type":"reservation","object_id":"r-1"},"content":{"title":"Receipt for reservation r-1","body":{"format":"text/plain","text":"Original receipt for r-1."},"attachments":[{"filename":"reservation-r-1.txt","mime_type":"text/plain","base64":"UmVzZXJ2YXRpb24gci0xIGNvbmZpcm1lZCBmb3IgMiBndWVzdHMuIERlcG9zaXQ6IFVTRCAxMDAuMDAuCg==","sha256":"a7b4983d7658198fe1ea8ec72d38e9f4a1fefc48a42f5e748b85a85bf1953a85"}]},"extensions":[]}}
```

- **Shared data and dependencies (required):** Run-bound people/accounts, venue/space/slot, menu/quote/policy versions, plan, hold, reservation, offer, grant, notice and financial IDs. Financial amounts use integer USD cents. Originals use UTF-8, electronic PDF/ICS and a few images with hash/version/source references. The package includes Node handlers, source services, schemas, original scene data and its GUI. It runs from its own directory with Node.js 18+ and the pinned public runtime/dependencies. Optional Apps are assembled per run.

The [public Web Host](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/blob/a4bce023953061483c41de5a287ba5e43f4a5648/runtime/web/README.md) exposes Agent business tools; Infra stays separate. Future inventory events, reply schedules and grading labels stay with Task/Infra. The Agent gets public observations; simulated participants get their own context and delivered observations. Development scenes are developer-visible.

## 4. Construction plan and effort

**✍️ Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| :--- | :--- | :--- | :--- |
| Web / app construction | Shared booking/financial engine and venue search, detail, plan/guests, preview, bookings/waitlists and receipt/history views. | All six workflows through GUI and MCP, including inquiry versus confirmed booking. | 6–8 |
| Data and image collection | Review public OpenTable workflows and reused source licenses; create original menus, policies and UI. | Source/license/hash manifest and local assets. | 1 |
| Synthetic data and assets | Script three scenes with six venues each, 2–16 diners, past history and 12–18 source events: special-occasion release; group/private dining; plan revision and backup cleanup. | Hand-reviewed rules, sums, identities and timelines; missing reply is pending, missing attribute unknown. | 3–4 |
| App integrations | Core lifecycle, authority/events, Mail text/files and optional Calendar/Contacts/Messages tool paths. | Actual recipient records, attachment bytes and linked Calendar state; independent package run. | 4–6 |
| Validation and reset | Workflow/error checks, races/cost/audience tests, real browser, history/reset and independent reproduction. | Commands, versions, traces, receipts, hashes and passed/failed/unrun reports. | 6–9 |

### Validation and evidence

| Area | Required outcomes |
| :--- | :--- |
| Search/release | Public opening rules and timezone/DST boundaries; future stock hidden; unavailable fields explicit. |
| Holds/bookings/offers | Version races, expiry, current authority and policy; one effect on retry; notice versus held offer; failed change preserves original booking. |
| Group dining | Inquiry/confirmation distinction, quote changes, dietary reply scope, expected versus guaranteed headcount and lock/minimum-spend effects. |
| Costs | Deposit/prepayment, minimum spend, fee/refund timing, denied payment and contributions reconcile in cents; no duplicate charges/refunds. |
| Audiences/Apps | A kitchen-only note reaches only its permitted audience; verify Mail records/receipts, denied delivery, unchanged-ID retry, unknown outcome reconciliation and original attachments. |
| GUI/lifecycle | Real-browser actions with MCP readback/reload; seed old bookings/offers/refunds; reset to baseline; other Apps unchanged; repeat from a clean public checkout. |

Example synthetic arithmetic: two $200 menus plus 20% service and 10% tax on food total $520; a $100 deposit leaves $420 expected. An eight-person $60 menu with $600 minimum spend totals $780 under the same rates. Each venue declares fee/tax bases and rounding. Cancellation uses its own published all-in fee.

App history supplies booking intervals, quote/decision revisions, actual recipients, deposits, fees and refund times. Core audit supplies committed/denied outcomes; Agent execution records supply call arguments/results. Join by run, request, reservation, notice and version. An active interval starts at confirmed commit and ends at cancellation or attendance closure. Report simultaneous active reservations separately from conflicting dining times; a conflict also requires the policy's dining-time overlap/start-gap rule. Count confirmations by reservation/commit receipt, so an idempotent replay counts once. Compare cancellation times to stored cutoffs; preserve rejected-attempt evidence even when state is unchanged. Export before reset.

Run App-only tests and `npm run app:verify` on the exact package, public-runtime integration, `public-runtime (18)`, `public-runtime (22)`, `base-runtime-compatibility` and real-browser checks. Supply an independent maintainer/contributor reproduction. Model-trial requirements/budget remain TBD for a maintainer decision at M0.

- **Milestones, owners and dependencies (required):** @genglinliu owns M0–M3. M0 reviews this combined scope and source/schema inventory. Within 14 calendar days of first plan approval, M1 submits one runnable venue set with search, hold/confirm, deposit, change/cancel, group inquiry, Core seed/reset, a browser path and Mail text/file readback. M2 completes release/waitlist, group/headcount/audience and overlap profiles, all scenes and optional connections. M3 supplies independent validation. Full delivery is estimated at 4–6 working weeks; M1 lists remaining work.

  Boundaries and users: [#26](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/26) owns community membership/RSVPs/posts; Messages owns general chat. This App owns venue commitments and dining costs. [#116](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/116) plans to use #40; [#140](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/140) has a local private-dining portal that may reuse it after interface alignment. [#111](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/111) owns food delivery/declared menu allergens; [#37](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/37) groceries; [#68](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/68) person-to-person payments; [#66](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/66) independent reviews. Related booking mechanics: [#15](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/15), [#25](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/25), [#45](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/45) and [#5](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/5).

- **Resources and total effort (required):** 20–28 person-days: 6–8 + 1 + 3–4 + 4–6 + 6–9. Local CPU/browser and original deterministic data. Target at most 48 assets/768 KiB decoded bytes per loaded App bundle, including receipt versions/exports. Record generation provenance and peak budgets.
- **Scope boundary and open questions (required):** One active dining plan, historical records, ordinary tables, set-menu experiences and private/group inquiries. Two declared synthetic overlap profiles. Deferred: live bookings/payments, restaurant operations/POS, generic social feeds, food delivery and cross-platform reservation aggregation. Agent-owned scheduling and Environment trial requirements need platform/maintainer agreement. The Agent owns venue selection, backup strategy and cleanup decisions.
- **License and external dependencies (required):** New code MIT; original synthetic records/documents/assets CC0-1.0. Record compatible reuse licenses, hashes and notices. Default execution uses the package and pinned public runtime; product references inform workflows and policies.

Implementation and validation evidence will be added to this PR against the approved combined scope.
