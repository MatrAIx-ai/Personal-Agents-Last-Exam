# Environment Track proposal

**PR title format:** `[Environment Proposal] [Games & play + Money & insurance + Social & communities] Beam (PC game platform)`

## 1. App and domains

- **Authors / GitHub handles (required):** Chris Chen (@chrischenhub)
- **Reference app or website / URL (required):** Steam — https://store.steampowered.com (reference for Beam)
- **Primary domain (required):** Games & play
- **Secondary domains (optional):** Money & insurance, Social & communities

### Domain names

Use the exact names from the [homepage](../../README.md#environment-domains). Choose one primary domain and optional secondary domains; list the primary first in the PR title and join others with ` + `.

<table>
<tr><td>💳 <strong>Money &amp; insurance</strong></td><td>🛍️ <strong>Shopping &amp; groceries</strong></td><td>✈️ <strong>Travel &amp; commuting</strong></td></tr>
<tr><td>🩺 <strong>Health &amp; care</strong></td><td>🍽️ <strong>Food &amp; dining</strong></td><td>💬 <strong>Social &amp; communities</strong></td></tr>
<tr><td>🏠 <strong>Home &amp; utilities</strong></td><td>🏛️ <strong>Public service &amp; law</strong></td><td>🎬 <strong>Media &amp; entertainment</strong></td></tr>
<tr><td>📚 <strong>Learning &amp; research</strong></td><td>💼 <strong>Work &amp; business</strong></td><td>📰 <strong>News &amp; information</strong></td></tr>
<tr><td>🌤️ <strong>Weather &amp; outdoors</strong></td><td>🎮 <strong>Games &amp; play</strong></td><td>🏃 <strong>Fitness &amp; wellbeing</strong></td></tr>
</table>

## 2. What you plan to build

**✍️ Your answer (required):** Beam is a PC game platform, modeled on Steam, where a user discovers, buys, plays and manages their games. The first version covers the core loop of the platform: finding, wishlisting and buying games, giving games to other people, keeping a library with playtime, paying through a wallet or saved cards, and refunding purchases under the platform's rules. It is designed to grow into a fuller platform (see scope boundary). Initial workflows:

1. **Store and purchase.** Browse and search a catalog, view game pages (price, current discount and its end time, genre, description, platform requirements), add to cart, and check out with the wallet or a saved card. The account page stores the user's PC specifications, which can be compared with each game's platform requirements. Failure states: insufficient wallet balance, declined card, game already owned, price changed before confirmation.
2. **Wishlist.** Add, remove and reorder wishlist items; see which wishlisted games are currently discounted and when each discount ends. Discounts start and end on the simulated clock.
3. **Gifting.** Buy a game as a gift for another Beam user (identified by username or email), with an optional message. Gifts move through `sent → redeemed / declined`; a declined gift is refunded to the purchaser. Failure states: recipient already owns the game, unknown recipient.
4. **Library and playtime.** Owned games with acquisition source (purchased or received as a gift), date and recorded playtime.
5. **Wallet and payment methods.** Wallet balance and transaction history, add funds, add/remove/set default cards (masked). A simulated payment processor can approve or decline charges and indicates whether a card accepts refunds.
6. **Refunds.** Request a refund from order history: choose the game, a reason, and the destination (wallet or original payment method). Requests move through `submitted → approved / denied`, with approved funds returned within a simulated week. Failure states: outside the refund window, playtime over the limit, already refunded, original payment method that cannot receive refunds, redeemed gift whose refund is requested by the purchaser rather than the recipient.

**Refund rules for games.** Beam follows Steam's published refund policy for games (https://store.steampowered.com/steam_refunds, last updated April 23, 2024).

| Rule | Behavior in Beam |
| :--- | :--- |
| Eligibility | Refundable for any reason if requested within 14 days of purchase and played for under 2 hours. |
| Destination | Original payment method or wallet; if the original method cannot accept refunds, the full amount goes to the wallet. |
| Gifts | Unredeemed gifts follow the 14-day / 2-hour rule. Redeemed gifts can be refunded under the same conditions only if the recipient initiates it; funds return to the original purchaser. |
| Outside the rules | Users can still submit a request; it is denied by default unless the scenario configures otherwise. |

Steam's rules for DLC, pre-purchases, bundles, wallet-fund refunds and other purchase types are deferred along with those product types.

**Why this is useful for personal-agent tasks.** Everyday platform actions involve money, time-bounded rules and the user's own history, so the right action depends on personal context: which of two recent purchases "the game I bought last week" means, whether a game is for the user or a gift for someone else, whether a standing payment or refund preference still applies, whether a purchase fits what the user already owns and can run, or whether a request should be explained and declined instead of submitted. The environment exposes the state needed to make those cases discoverable and checkable.

**Simulated clock and world events.** Refund windows, discount end times and other time-dependent rules rely on the current time, and PALE tasks span multiple sessions of simulated world time. The backend reads time from a controllable simulated clock that the evaluation harness can set or advance. The harness can also apply scheduled world events the agent does not cause: added playtime, a gift recipient redeeming, declining or requesting a refund for a gift, and card status changes (declined, or no longer accepting refunds). Reset restores the clock and all other state.

## 3. Potential app connections

- **Internal personal apps (required):** Mail: order receipts, refund submitted/approved/denied notices, wallet top-up receipts, gift sent/redeemed/declined notices, and discount alerts for wishlisted games. These give agents a second place to discover evidence about past purchases. Calendar and Contacts are deferred.
- **Other apps and websites (required):** Banking or card statement environments from the Money & insurance domain could show Beam charges and refunds as transactions; [Personal Finance Workspace (#6)](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/6) is a candidate. TBD until its interfaces are settled.

### Integration details

- **Operations and access (required):** Entry points: the web GUI and an HTTP API behind it; the agent-facing adapter (MCP or API) follows the infrastructure release (open question a). Agent-facing actions: search and view games; add to and remove from the cart; add, remove and reorder wishlist items; view the library, orders, gifts, refunds and wallet; add cards and set the default card; and prepare, confirm or cancel checkouts, gifts, wallet top-ups, refund requests and card removals. Platform operations: load a seed profile, reset to its snapshot, set or advance the simulated clock, and inject world events.
- **State and lifecycle (required):** App state (catalog, prices, discount schedule, refund rules) is fixed per environment version. Account state (library, wishlist, gifts, orders, wallet, cards, refunds, PC specifications) belongs to each seed profile and recipient account. Run state (simulated clock, pending drafts, applied world events, sent Mail) belongs to one evaluation run. Each run starts from a seed-profile snapshot; reset restores database, clock and Mail state to that snapshot. Checkout, gifts, wallet top-ups, refund requests and card removal use a prepare → confirm flow: prepare validates and returns a draft with a summary; confirm re-validates and commits, returning the resulting record or a typed error (e.g. `price_changed`, `card_declined`, `permission_denied`); cancel discards the draft. Confirming the same draft twice returns the same result, so retries never charge or refund twice. One agent acts at a time; writes are applied in order.
- **Events and notifications (required):** Accepted events: setting or advancing the clock, added playtime, a gift recipient redeeming, declining or requesting a refund for a gift, and card status changes (declined, or no longer accepting refunds). Task scenarios define when events occur. Notifications: Mail messages for order receipts, wallet top-ups, gift status changes, refund status changes and wishlist discounts. Example: input `{"type": "gift_declined", "gift_id": "g_102"}` → gift `g_102` becomes `declined`, a refund record for the purchaser is created, and Mail receives a gift-declined notice citing `g_102` and the refund.
- **Shared data and dependencies (required):** People and accounts: the user's Beam account (one per seed profile) and recipient accounts identified by username or email. Object references: game, order, gift, refund, card and draft IDs; Mail notices cite order, gift and refund IDs; cards appear as brand and last four digits. Media and attachments: none. Shared components: PALE Mail; the harness drives the simulated clock and world events.

## 4. Construction plan and effort

All work by one contributor. Estimates are ranges in person-days.

**✍️ Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| :--- | :--- | :--- | :--- |
| Web / app construction | ~11 pages (store home and search, game page, cart/checkout, wishlist, gift checkout, gift status, library, order history, refund request and status, wallet and payment methods, account with the user's saved PC specifications). Backend with a relational database, simulated clock, simulated payment processor and refund rules. | Each of the 6 declared workflows runs end to end, including confirmation, cancellation and the listed failure states; a scripted walkthrough per workflow verifies expected state changes. | 10–15 |
| Data and image collection | N/A. The catalog is fully synthetic (see next row). | N/A | 0 |
| Synthetic data and assets | ~100 original games (titles, genres, descriptions, prices, requirements), 3–5 seed user profiles plus several recipient accounts (library, wishlist, sent and received gifts, order history, playtime, wallet, saved cards, PC specifications) usable as task starting points. Text generated with Claude Sonnet by default. | Generation scripts with fixed seeds; each run records the model version, prompts and seeds. Checks for duplicate titles, consistent prices, order histories and gift records consistent with libraries and wallet balances, discount windows consistent with the seed clock. | 3–5 |
| App integrations | Emit Mail messages for receipts, refund, gift and wishlist-discount events. Final wiring depends on PALE's shared personal-app interfaces. | Every purchase, top-up, refund and gift event produces matching Mail state (e.g. a refund notice exists iff a refund record exists). | 2–3 |
| Validation and reset | Adapter exposing documented actions, observations, permissions and errors that match the UI. Local tests for each workflow's success, failure and permission cases (e.g. an agent without payment authority cannot confirm a checkout), prepare/confirm/cancel and repeated confirms, and the state and Mail changes each world event produces. Platform integration fixtures: per seed profile, a reference run and a "do nothing" run with expected final states. Outcome checks for task authors: order, wishlist, gift, library, wallet and refund state, plus side-effect checks (no unintended purchases, gifts, refunds or card changes). | Reproducible local test results. Platform validation evidence covering permissions, Beam–Mail state consistency and reset: reset restores database, simulated clock and Mail state to a seeded snapshot, verified by state hashing across repeated runs; the reference and "do nothing" runs reach their expected final states. | 4–6 |

- **Milestones, owners and dependencies (required):** All owned by @chrischenhub. Order: (1) data model, simulated clock and synthetic catalog; (2) store, purchase, wishlist, library and wallet; (3) gifting and refunds; (4) adapter, Mail integration, reset and tests; (5) validation evidence. Expected calendar duration 6–8 weeks part-time. Depends on the PALE infrastructure release for the adapter interface and shared personal apps; steps 1–3 can proceed before it. Related: [#6 Personal Finance Workspace](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/6) (potential banking connection; not blocking).
- **Resources and total effort (required):** 19–29 person-days total. Model/API cost for synthetic game text (Claude Sonnet by default) estimated at under US$10. Runs in a single container with a local database; no special compute.
- **Scope boundary and open questions (required):** Planned later extensions, in rough priority order: family accounts with spending limits, DLC and bundles (each with Steam's corresponding refund rules), and Calendar/Contacts integration. Excluded: cover art and other game media, friends and community features, reviews, user-generated content, marketplace, actual game installation or gameplay. Open: (a) adapter format and whether agents act through the GUI, the adapter, or both, settled by the infrastructure release; (b) whether to connect to Personal Finance Workspace (#6) or another banking environment, settled once those designs are approved.
- **License and external dependencies (required):** Code and synthetic data are released under the repository's MIT license and redistributed in the repository; nothing is hosted. No external service is needed at run time: Claude Sonnet is used only to generate catalog text, and the generated data is committed.

## Appendix: example tasks this environment would support

1. **Which game?** The user asks to "refund the game I bought last week." Two games were bought that week; one has already been played for three hours. The agent must identify the intended, still-eligible game and confirm instead of guessing when the evidence is not decisive.
2. **A standing preference meets a rule.** Several sessions earlier the user said refunds should always go back to their card. This purchase was made with a card that cannot receive refunds. The agent should tell the user the money can only go to the wallet rather than silently submitting it.
3. **A purchase that fits the person.** The user asks the agent to buy a co-op game a friend recommended, paying from the wallet only. The agent must check that the user does not already own it, that the wallet covers it, and that the user's PC meets its requirements, and ask before topping up the wallet.
4. **Whose refund is it?** The user bought a game as a gift for their brother, who redeemed it and played for 30 minutes. The user now asks the agent to refund it. The agent should recognize that only the recipient can start this refund and explain that, rather than looking for a workaround.
