# Environment Track proposal

**PR title:** `[Environment Proposal] [Social & communities] Community Lending Library`

## 1. App and domains

- **Authors / GitHub handles (required):** @2018cx
- **Reference app or website / URL (required):** myTurn, https://myturn.com/, as a public interaction reference for catalog availability, reservations and check-in/out. This is an independently branded, synthetic lending cooperative, not a reproduction of myTurn code or assets.
- **Primary domain (required):** Social & communities
- **Secondary domains (optional):** None.

## 2. What you plan to build

**✍️ Your answer (required):** A complete borrowing cycle for a community library of ordinary, safe objects. Five views cover the catalog, item/availability detail, holds and queue, current loans, and activity/receipts. The agent can:

1. Compare an item's available copies and loan rules, then confirm or abandon a hold for immediate collection. If none is available, join the item-level waitlist; cancel a hold or leave the queue later.
2. Request checkout of the reserved copy, reconcile the simulated desk receipt, and distinguish a request from a confirmed loan.
3. Inspect due dates and preview a renewal. Confirm an eligible extension or preserve the original due date when another member is waiting.
4. Request return, reconcile its desk receipt, and verify that custody has actually changed before reporting the loan closed.
5. Revisit a pending hold or renewal after a queue change, cancellation or expiry, choosing an alternative item only when the user's intent permits it.

This is a single-location, no-fee cooperative. Items include measuring tapes, magnifying glasses, puzzles and board games; no weapons, hazardous equipment or regulated goods. Copies have stable IDs and available, held, on-loan or maintenance status. One member may hold or borrow at most two copies. A hold lasts one simulated day; loans last seven days; one three-day extension is allowed only before the due date and when nobody else is waiting. Item queues are FIFO by insertion sequence. On release, the earliest eligible member receives a one-day hold; expiry advances the queue. Overdue loans stay open and block new checkout/renewal, without fines. Maintenance copies are never offered.

The agent cannot declare physical handover complete. Checkout/return requests remain pending until a platform-controlled simulated desk outcome matches the specified request attempt for the operation, synthetic member and copy. A rejected or duplicate receipt cannot create or close a loan. All handovers are fictional; there is no real-world logistics integration.

Useful personal-agent tasks must preserve the user's preferred item and collection constraints, respect other members' priority, and distinguish an unavailable extension from a successful one. The state being evaluated is custody and borrowing entitlement, not merely a reservation. This differs from #26's group events/audiences, #31's household possessions, #5's service appointments and #4's bibliographic records.

## 3. Potential app connections

- **Internal personal apps (required):** None. Due dates and notices stay inside the app; no Mail, Calendar, Messages or Contacts integration.
- **Other apps and websites (required):** None. The reference website is not called at runtime.

### Integration details

- **Operations and access (required):** Browser GUI for search/read, hold/cancel, queue join/leave, checkout/return request, renewal preview/confirmation and receipt inspection. Any equivalent agent action surface would share this state. Members can mutate only their own records and see queue length/own position, not other borrowers' identities. Only the platform may seed members, apply desk outcomes, advance scenario time, snapshot/reset and inject events. Exact official hooks, API names and transport are TBD pending infrastructure release and design agreement.
- **State and lifecycle (required):** Separate catalog/rules, synthetic member permissions, and per-run copy states, holds, queues, loans, pending requests, clock and receipt log. Reset restores the complete selected fixture and event cursor. Writes use current versions and operation IDs: stale confirmations fail without partial mutation, retries return the original result. A request reserves its transition but does not change custody; cancellation before desk acceptance invalidates that request. Checkout eligibility and hold expiry are rechecked when the receipt arrives. Return acceptance closes the loan once and releases the copy atomically. Clock advancement and queue promotion are deterministic, with same-time ordering recorded in fixtures.
- **Events and notifications (required):** Two local simulator event families: a queue join (item I2, synthetic member M3, sequence 12), and a desk outcome with a stable `event_id` and offset-bearing `at` timestamp. The Core envelope’s `operation` names the declared desk-outcome event. Its `payload` gives the business operation (checkout or return), synthetic member (e.g. M1), copy (e.g. C4), a one-based attempt ordinal (e.g. 1), and accepted/rejected outcome. The task author supplies these fixture-stable fields, not a generated request ID or author-time version. The runner reads Core’s current `{epoch, revision}` immediately before calling Infra `env.apply_event`, supplying it as `expected_version` outside `event`. Each newly committed request increments its operation/member/copy attempt counter; seed history supplies prior attempts and fixtures document their baseline. Exact transport retries do not increment it. Cancelled or rejected attempts retain their ordinals, so a late outcome for attempt 1 cannot affect attempt 2. The App resolves only the exact pending attempt and records its generated request ID in history. No match, a terminal or ambiguous match, or a no-longer-eligible checkout is rejected without changing custody. A matching desk rejection ends the pending request without creating or closing a loan. Exact replay of an applied event ID returns the existing receipt without repeating its effect. The runner treats an unmatched outcome as a missed delivery and never reroutes it; it may retry a Core version conflict before that delivery is resolved. A new queue member can invalidate an unconfirmed renewal preview. In-app notices identify only the acting member’s affected hold/loan, status and reason. Task scenarios choose timing; no email, push or external dispatch. Hold expiry follows the scenario clock, not wall-clock time.
- **Shared data and dependencies (required):** Stable synthetic member, item, copy, hold, loan, request and event IDs; local structured fixtures with integer simulated timestamps and UTF-8 labels. No real member identities, addresses, attachments or contact details. A local datastore and reusable forms/lists are sufficient. Package choices and official adapter mapping remain TBD; no shared runtime service is assumed.

## 4. Construction plan and effort

**✍️ Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| :--- | :--- | :--- | :--- |
| Web / app construction | Five views and five borrowing workflows, shared forms, custody/queue state rules | Complete hold-to-return cycle, renewal/cancellation and visible pending/rejected outcomes | 3 |
| Data and image collection | Reference documentation only; no crawl or imported images | Source/reuse note; no bundled third-party catalog or branding | 0.25 |
| Synthetic data and assets | Eight item types, twelve copies, four fictional members and six seeded scenarios | Unique IDs, consistent custody/queue state, safe objects and no real personal data | 0.75 |
| App integrations | Local platform setup/reset/clock/event boundary only; no other apps | Same-state GUI/action checks and isolated platform privileges; official hooks TBD | 0.75 |
| Validation and reset | Happy cycle; queue/expiry; renewal race; duplicate/rejected desk receipt; overdue/maintenance; permission denial | Local invariant tests and expected-state fixtures for platform validation; replay and repeated-reset equality | 1.75 |

- **Milestones, owners and dependencies (required):** Design review first, then rules/fixtures, workflow construction, adapter mapping and validation. Xiao Cui (@2018cx) owns implementation and ongoing maintenance. Implementation starts when the maintainer’s formal scope approval takes effect, with the first runnable version due within 14 calendar days of approval. Related #26, #31, #5 and #4 are scope comparisons, not dependencies.
- **Resources and total effort (required):** Implementation plan estimate: 6.5 person-days across the workstreams above. Expected local resources are two CPU cores, 2 GB RAM and under 100 MB of fixtures, with no paid collection or runtime services.
- **Scope boundary and open questions (required):** Complete single-location borrowing, not a general inventory platform. Excludes payments, deposits, fines, signatures/waivers, messages, delivery, cross-location transfers, scanners and real desk operations. Review should settle receipt ordering and the platform clock contract without expanding the business scope. Next step is design review only.
- **License and external dependencies (required):** MIT for this App’s original code and synthetic fixtures; any third-party dependencies retain their own licenses and notices. Assets are redistributed locally; nothing is hosted separately. No external runtime service. Dependency versions and required notices will be documented during implementation.
