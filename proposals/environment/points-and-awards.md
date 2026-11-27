# Environment Track proposal

Proposed PR title: `[Environment Proposal] [Money & insurance + Travel & commuting] Points and awards: transferable points, airline awards and hotel awards`

## 1. App and domains

- **Authors / GitHub handles (required):** Ruihong Yin ([@RuihongY](https://github.com/RuihongY))
- **Reference app or website / URL (required):** Three small, independently branded synthetic programs. Their workflows follow public program terms and help pages:
  - **Waypoint Rewards**, transferable bank points: [Chase Ultimate Rewards](https://www.chase.com/personal/credit-cards/ultimate-rewards) and [Amex Membership Rewards](https://www.americanexpress.com/us/rewards/membership-rewards/) for transfers, household pooling and transfer bonuses.
  - **Skyline Miles**, an airline program that books partner flights: [Air Canada Aeroplan](https://www.aircanada.com/aeroplan) for partner awards, partner booking fees and schedule-change handling.
  - **Harbor Hotels**, a hotel program: [World of Hyatt](https://world.hyatt.com/) for award categories, free-night certificates, category changes and points expiry.

  No reference product's code, branding or data is used.
- **Primary domain (required):** Money & insurance
- **Secondary domains (optional):** Travel & commuting

## 2. What you plan to build

**✍️ Your answer (required):** Three packages, each loadable on its own, that model spending points on travel, and the rules that make it go wrong.

1. **Waypoint Rewards: transferable points.**
   - A points ledger per member.
   - Household pooling, which only the sender can start.
   - Transfers to partner programs: a fixed ratio, 1,000-point increments, irreversible, instant or delayed by partner, with time-boxed transfer bonuses (for example +30% in a window).
2. **Skyline Miles: airline awards.**
   - Award search over a small partner schedule, with saver inventory per date and cabin that sells out on the clock.
   - Partner booking fee plus taxes, charged to a chosen payment label. Holds are optional per program and off by default.
   - Ticketing for named passengers.
   - Schedule changes that make a connection illegal, with a free alternative available until a deadline.
3. **Harbor Hotels: hotel awards.**
   - Award nights priced by category.
   - Free-night certificates with a category cap and an expiry check-in date.
   - Points+Cash.
   - Points expiry after inactivity, where a transfer in or a redemption counts as activity.
   - Category changes with an effective date; bookings made before it keep their price.

**Why it matters.** Points travel is where a capable assistant knows every rule and still loses the trip on timing. It waits until all the points arrive while seats sell out, pays taxes with the wrong card, or lets points expire while it is not running. Task [#55](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/55) depends on all three packages. Other credit-card and award-travel tasks could reuse them.

## 3. Potential app connections

- **Internal personal apps (required):**
  - **Mail** (optional): programs publish confirmations, expiry warnings, category-change and schedule-change notices to Mail through Mail's existing receive contract ([`urn:pale:email-payload:1`](../../examples/apps/mail/schemas/email-payload.schema.json)).
  - **Contacts** (optional): members and passengers are bound person references.
  - Calendar is not used.
- **Other apps and websites (required):**
  - **Between the three packages** (required for transfers): Waypoint publishes a transfer on `channel.loyalty-credit`. Skyline and Harbor receive it through their own receive contract, `urn:pale:loyalty-credit:1`, and credit the member. The receipt confirms the credit. A delayed transfer stays `pending` at the sender until Infra applies `transfer.settle` at its time.
  - **Brindle Card ([#182](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/182)), optional:** award taxes are recorded against a payment label. If #182 publishes a receive contract for card transactions, Skyline and Harbor will post the charge there; otherwise the label stays local. To be agreed with #182's author.
  - **PaleAir ([#69](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/69)), not connected in v1:** Skyline keeps its own small partner schedule, because PaleAir excludes award travel.
  - **Reminders ([#191](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/191)):** used by the same task, with no direct connection.

### Integration details

- **Operations and access (required):**
  - **Waypoint agent tools:** `waypoint.balance()`, `waypoint.partners()`, `waypoint.transfer(partner, points)`, `waypoint.transfers.list()`, `waypoint.bonuses()`. The member-side tool `waypoint.combine(to_member, points)` can be called only by the sending member's account, which the user harness controls.
  - **Skyline agent tools:** `skyline.search(origin, dest, date, cabin, pax)`, `skyline.book(option_id, passengers, payment_label)`, `skyline.trips()`, `skyline.manage(booking, action)`, `skyline.balance()`.
  - **Harbor agent tools:** `harbor.search(city, check_in, check_out)`, `harbor.book(hotel, dates, payment)` (points, certificate, points+cash or cash), `harbor.reservations()`, `harbor.cancel`, `harbor.account()` (balance, last activity, certificates).
  - **Infra:**
    - `env.load_seed`, `env.snapshot`, reset, `env.advance_time`;
    - `env.apply_event` with `inventory.sold`, `schedule.changed`, `alternative.expired`, `bonus.start`, `bonus.end`, `transfer.settle`, `category.change`, `points.expire`.
  - **GUI:** one small page per program.
- **State and lifecycle (required):**
  - Each package keeps per-instance, account and run state; seeds load balances, inventory, schedules, categories and certificates, and reset restores them.
  - Transfers are idempotent per request ID. A sender commits `pending` or `completed`; the receiver commits the credit; a rejected credit returns `rejected` and the sender refunds within the same transfer record.
  - Bookings check balances, inventory and the current version; a stale search result is rejected with `stale_version`.
  - Expiry and category changes are applied by Infra events at their scheduled times; there is no self-scheduling.
- **Events and notifications (required):**
  - **Accepts:**
    - the Infra events above;
    - `loyalty-credit` messages at Skyline and Harbor, for example `{"member_ref":"p-daniel","points":150000,"source":"waypoint","transfer_id":"t-17","bonus_pct":0}`.
  - **Sends:**
    - `loyalty-credit` messages, from Waypoint;
    - Mail notices: a schedule change with its free-alternative deadline, an expiry warning, a category change.
- **Shared data and dependencies (required):**
  - Members and passengers are bound person references, and payment labels are opaque strings.
  - Text only.
  - Each package runs on its own with only the shared runtime (Core API 1.2.0, runtime 1.6.0). The transfer flow pins the sibling packages in the cross-App example, not as hard dependencies of each package.

## 4. Construction plan and effort

**✍️ Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| :--- | :--- | :--- | :--- |
| Web / app construction | Three packages under `apps/` (`waypoint`, `skyline`, `harbor`) following the personal-Apps layout: `tools.json`, plugins with ledgers and state machines, receive and publish declarations, Infra event handlers and small GUIs. | Business tests for every rule and error, for example:<br>- the transfer increment and irreversibility;<br>- bonus windows at their boundaries;<br>- pooling only by the sender;<br>- delayed settlement;<br>- inventory sold between search and book;<br>- insufficient points;<br>- fees charged to the chosen label;<br>- a schedule change with the free alternative before and after its deadline;<br>- a certificate above its category cap or after its expiry;<br>- category-change price lock;<br>- inactivity expiry, with activity resetting it. | 7–8 |
| Data and image collection | N/A. No external data or images; rules are paraphrased from the public pages in section 1. | Source notes for each paraphrased rule. | 0.5 |
| Synthetic data and assets | Example seed: 2 household members; a 2-week partner schedule on 3 routes with saver inventory; 6 hotels across 4 categories; one certificate; one transfer-bonus window. | Seeds validate; schedules, prices and dates are consistent; reset restores them exactly. | 1 |
| App integrations | `loyalty-credit` contract and the Waypoint → Skyline and Waypoint → Harbor flow; Mail notices through the existing contract. Cross-App example in `examples/workflows/points-trip/`:<br>1. pool points;<br>2. transfer to Skyline;<br>3. ticket an award;<br>4. sell out the remaining seats;<br>5. apply a schedule change and take the free alternative;<br>6. transfer to Harbor and book with a certificate. | Real MCP connections with receiver-side evidence (credits, receipts, Mail records), a rejected credit with a sender refund, and a duplicate transfer that returns the original receipt. | 2–2.5 |
| Validation and reset | `node runtime/cli.cjs verify --app apps/<id>` for each package, the business tests, the workflow example, and history-loading, reset and `env.advance_time` checks. | After implementation: exact App and runtime versions, commands and reports covering permissions (the agent cannot call `combine` for another member or fire Infra events), state consistency, reset and the declared integrations. | 1.5 |

- **Milestones, owners and dependencies (required):** Ruihong Yin (@RuihongY) owns all workstreams. The order is:
  1. Waypoint and the `loyalty-credit` contract.
  2. Skyline.
  3. Harbor.
  4. The cross-App example and Mail notices.
  5. The validation report.

  v1 within 14 days of plan approval, per CONTRIBUTING. Dependencies: runtime 1.6.0, Core API 1.2.0 and Mail 1.3.0 (available). Optional coordination: #182 for card transactions. Dependent task: #55.
- **Resources and total effort (required):** 12–13.5 person-days. No GPU, paid data or hosted services. Small JSON state; local stdio MCP only.
- **Scope boundary and open questions (required):**
  - **Excluded:** cash-fare booking (see #69), elite status and upgrades, buying or selling points, award holds (off by default), real program rules beyond the paraphrased fixtures, and multi-currency card fees.
  - **Open questions:**
    1. Is one proposal with three packages acceptable, following the shared personal-Apps suite?
    2. Should Skyline later book over the PaleAir (#69) schedule instead of its own, if #69 adds award inventory?
    3. Should award taxes post to Brindle Card (#182) as real card transactions in v1, or stay as payment labels until #182 publishes a receive contract?
    4. Task #55 currently uses real program names. Should it switch to these synthetic brands, with the same rules, once this environment is accepted?

    These will be settled in design review.
- **License and external dependencies (required):** Original code under the repository's MIT license. Rules are paraphrased from public program terms; no names, logos, text or screenshots are reproduced in the App. No external service at run time.

After approval, add implementation and validation links against these deliverables in the same PR. Reviewers use the approved plan as the acceptance baseline; substantial scope changes require another design review. See the [contribution guide](../../CONTRIBUTING.md#review-and-implementation).
