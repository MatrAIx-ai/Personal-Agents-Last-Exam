# Environment Track proposal

Proposed PR title: `[Environment Proposal] [Media & entertainment] Reelvane movie and live-event tickets (AMC, Fandango and Ticketmaster-inspired)`

## 1. App and domains

- **Authors / GitHub handles (required):** Jason ([@Jasonya](https://github.com/Jasonya)).
- **Reference app or website / URL (required):** Reelvane, an independently branded synthetic ticketing environment with three storefronts that share one seat inventory: Reelvane Cinemas, a cinema chain's own site inspired by [AMC Theatres](https://www.amctheatres.com/); Showpicker, a cross-chain movie-ticket aggregator inspired by [Fandango](https://www.fandango.com/); and Encorely, a live-event ticket marketplace inspired by [Ticketmaster](https://www.ticketmaster.com/). Their public pages are workflow references only. All names, films, events, venues, seat maps, prices, artwork and policies are original and documented.
- **Primary domain (required):** Media & entertainment
- **Secondary domains (optional):** None

## 2. What you plan to build

**✍️ Your answer (required):** A resettable ticketing environment in which an agent buys, changes and refunds movie and live-event tickets for the people going. Three storefronts sell from one shared seat inventory: a cinema chain's own site (member pricing, weekly allowance, concessions); an aggregator that sells the same showtimes with its own fees, rewards and refund rules; and a live-event marketplace (presale registration, ticket limits, service fees, transfers, event changes). The environment records which channel sold each seat, which ticket type, allowance, voucher or presale code each seat used, who currently holds each ticket and where every refund went, so outcomes can be checked from the final state.

Initial workflows:

1. **Discovery and seat maps across storefronts.**
   - Reelvane Cinemas and Showpicker list films and showtimes; Showpicker also lists two other fictional chains. Filters cover format (standard, large-format, 3D, premium sound), language version (original, dubbed, subtitled), open captions, audio description, and age rating with content advisories.
   - Encorely lists concerts, sports and theater, each with venue, date, doors time, age limits, presale windows and per-account ticket limits.
   - Original seat maps exist for cinema auditoriums (recliners, wheelchair spaces with companion seats, motion seats with age and height limits) and for event venues (sections, rows, obstructed or limited views, accessible platforms).
   - GUI maps and tool observations read the same inventory. A seat held or sold through one storefront is unavailable on the others.
2. **Holds, ticket types and all-in previews.**
   - Select explicit seats and acquire an expiring hold, then assign a ticket type per seat (adult, child, senior, student with an ID note, member).
   - Each channel applies its own price table and fees: member pricing and allowance on the chain site; convenience fees and aggregator rewards on Showpicker; service, facility and order fees on Encorely.
   - Vouchers, gift cards and presale codes apply under printed stacking rules, and cinema concessions can be added for a pickup window.
   - The preview shows every line in cents. Confirmation rechecks the hold, inventory, prices, limits and policy version.
   - Failures leave no charge or ticket: seat taken during the hold, expired hold, ticket limit exceeded, invalid code, or declined payment with a verification step. A repeated request ID returns the original receipt.
3. **Orders, tickets, transfers and admission.**
   - Each storefront shows its orders and per-seat tickets with distinct statuses: confirmed, ticket-ready, exchanged, transferred, refunded, partially refunded and used. Mobile tickets are released a fixed time before the start.
   - Encorely tickets can be transferred to a named recipient. Acceptance is a separate scenario operation that reissues the credential. Cinema tickets cannot be transferred.
   - A platform-operated synthetic admission event checks the ticket, holder, current start time and age rule. It does not simulate real barcodes.
4. **Exchanges, refunds and organizer changes.**
   - A movie ticket can be exchanged to another showtime, or all or some seats refunded, according to the selling channel's policy. Chain and aggregator rules differ in cutoffs, fees and refund destination.
   - Live-event refunds follow each event's published policy.
   - Theater- and organizer-initiated events post notices with options and deadlines: a cancelled showing, an auditorium change with seat remapping, or a postponed, rescheduled or cancelled event.
   - Requested, approved and paid refunds remain distinct, and duplicate requests cannot refund twice.
5. **Memberships, rewards and presale registration.**
   - The chain's subscription grants a weekly allowance of standard showings, with premium-format surcharges, a cap on reservations held at once and a printed no-show rule.
   - Showpicker rewards points accrue and redeem at published rates.
   - Encorely presale registration opens and closes on the virtual clock. A scenario-driven selection event sends codes by Mail, and a code works only within its presale window and ticket limit.

Illustrative downstream task. A parent plans an afternoon movie with two children and their grandfather, who needs open captions and a wheelchair space with a companion seat. The family has a chain membership for one adult and a Showpicker voucher that cannot be combined with member pricing. The same week, the user wants two concert tickets during a presale and must give one of them to a friend.

The agent must:
- compare channels and fees;
- pick feasible showings and seats;
- use the allowance, voucher and presale code only where allowed;
- transfer the right ticket;
- react to a theater change.

The environment checks final seats, channels, ticket types, holders, allowance and voucher use, charges, refunds and Mail/Calendar effects. The executable personal stories and model-difficulty evidence belong to separate Task proposals.

The three public sites inform interaction boundaries only. Reelvane's rule set is frozen and printed in each storefront, and no compatibility with any real company's policies is claimed.

Related [Seatline #45](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/45) is also Ticketmaster-inspired. It covers live-event purchase, transfers, credentials and event changes. Reelvane adds:
- movie ticketing;
- three storefronts over one shared inventory, with cross-channel differences in price, fee and policy and seat races between channels;
- memberships, rewards and presale registration.

We will coordinate with #45 at M0 on a shared seat-map and event data shape, and on reusing its live-event model if it lands first.

## 3. Potential app connections

- **Internal personal apps (required):** Mail for order, ticket-ready, presale-code, transfer, exchange, refund and change notices; Calendar for showings and events (start, expected end, venue address) through a calendar intent; Contacts for companions and transfer recipients. Local tests use synthetic inbox, calendar and contact fixtures.
- **Other apps and websites (required):** The three storefronts belong to this environment and share its inventory; nothing else is required. A local payment and gift-card ledger supplies deterministic charges, declines and refunds. [Finance #6](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/6) is an optional later transaction link. Live ticketing, showtime feeds and payment systems are excluded.

### Integration details

- **Operations and access (required):** Each storefront has a browser GUI plus same-state MCP/API tools, namespaced per storefront, for search, seat inspection, holds, previews and confirmation, orders and tickets, transfers, exchange and refund previews and requests, memberships, rewards and presale registration. Every page action maps to one tool call. Platform or scenario operations sit behind an operator token and are never linked from pages: setup, reset, snapshot and restore, fixture loading, clock advance, other-buyer seat sales, transfer acceptance, presale selection, theater and organizer changes, ticket release, admission checks and refund posting. Final method names and actor binding follow the adopted platform contract ([#12](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/12)).
- **State and lifecycle (required):** Three layers stay separate. The versioned catalog holds films, events, theaters, venues, auditoriums, seat maps, showtimes, and price tables and policies per channel. Accounts are per storefront (profile, membership, rewards, payment methods, gift cards, presale registrations). Isolated run state holds one shared seat inventory, holds, previews, orders, tickets and credentials, transfers, exchanges, refunds, notices and the applied-event cursor. Writes carry `expected_version` and `request_id`. Previews carry a fingerprint and expire on the virtual clock. Stale or conflicting writes fail without partial effects. A seat race between channels resolves deterministically, with a clear conflict for the loser. Snapshots keep the original receipts. Reset restores every mutable record, ledger entry and delivery, checked by a hash over the data.
- **Events and notifications (required):** Incoming events can: sell or release seats through any channel; change a price table; open or close presale registration and select registrants; release mobile tickets; accept a transfer; cancel or move a showing, with seat remapping; postpone, reschedule or cancel an event; reset weekly allowances; record admission; post refunds. Example: `event.rescheduled` for a real event ID marks the affected orders, offers a refund until a deadline and sends one Mail notice per order with the order ID and page path. Notices use the Mail CloudEvents format from #12, and Calendar updates use the agreed intent. Scenarios decide timing; the app does not choose the user's response.
- **Shared data and dependencies (required):** Stable IDs for films, events, theaters, venues, auditoriums, seats, showtimes, channels, holds, orders, tickets, credentials, transfers, vouchers, presale codes, members, refunds and notices. Amounts are exact cents with currency. Instants are RFC 3339 with IANA time zones. Ratings and advisories are stored as data. Original SVG seat maps derive from the same topology as the tool observations. Art is original or verified public domain (see section 4). No personal credentials or real payment data are used.

## 4. Construction plan and effort

**✍️ Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| :--- | :--- | :--- | :--- |
| Web / app construction | A shared inventory, pricing and policy core, plus three storefronts with 10–14 page types each that share UI components. Cinema: showtimes, seat map, ticket types, concessions, checkout, orders, exchange and refund, membership. Aggregator: cross-chain search, showtime, checkout, rewards, orders, refund. Events: event list and detail, venue map, presale registration, checkout, ticket wallet, transfer, refund. The App core uses the #12 package format, and each storefront is a self-hostable CUA website (semantic HTML and ARIA, no runtime internet, Docker image, configurable base path). We reuse the author's site template and Playwright self-play harness, contributed under MIT with the package. | All five workflows run end to end in a real browser on every storefront involved, including errors and cancellations. GUI and tool calls produce identical state, and cross-channel seat races behave as specified. GUI trajectories are recorded for each flow. | 10–14 |
| Data and image collection | An optional classic-film layer: metadata for 10–20 US public-domain films (for example, films published in 1930 or earlier) from Wikidata (CC0), and poster scans from Wikimedia Commons with a public-domain record per file. AMC, Fandango, Ticketmaster and other commercial sites are not scraped. | A provenance manifest with source URL, license and retrieval date for every record and image, plus broken-media and license checks. A switch turns the layer off, leaving a fully synthetic catalog. | 1–2 |
| Synthetic data and assets | Cinema: 3 fictional chains (Reelvane plus two partners listed on Showpicker), 4 theaters and 12–14 auditoriums of 80–250 seats, 25–30 fictional films and 14 days of showtimes (about 700). Live events: 3 venues with original maps (a theater of about 400 seats, an arena section set of about 1,500 seats, a general-admission club) and 15–20 events. Shared: price tables and fee schedules per channel; memberships, rewards and 8–10 voucher and presale variants; 5 reset fixtures (default, opening-weekend rush, member family, presale day, change day); 15–20 event inputs. | Valid seat topology and attributes, no overlapping showings per auditorium, consistent totals in cents across channels, feasible reference paths for every workflow, and checks for duplication and realism. | 5–7 |
| App integrations | Mail notices (reusing the #12 Mail receive contract and CloudEvents payload), Calendar intents for showings and events, Contacts reads for companions and transfer recipients, and a local payment and gift-card ledger. Finance #6 is an optional later link. | Purchase, presale, transfer, exchange and change flows produce the expected Mail records and Calendar intents with real resulting IDs, and receiver state matches order state. | 4–5 |
| Validation and reset | Local business tests, plus public-runtime MCP, workflow and error, history-loading and reset checks. Cases: cross-channel seat races, expired holds and previews, per-channel fees and stacking rules, ticket limits, presale windows, allowance limits, payment decline with verification, exchange and refund cutoffs per channel, partial refunds, transfers before and after acceptance, organizer and theater changes, age-rule admission, duplicate requests, read-only invariance and exact reset. Independent agents run GUI self-play with recorded trajectories, and we do a fresh-environment reproduction. | After implementation: exact App and runtime versions, commands and reproducible reports covering permissions, state consistency, reset and declared integrations; a trajectory index and failure analysis; notes on any remaining manual or deployment checks. | 8–10 |

- **Milestones, owners and dependencies (required):** @Jasonya owns six milestones, estimated at 28–38 person-days (about 6–8 working weeks, excluding infrastructure and review waits). M0: scope, interface and license agreement with maintainers, covering the adopted #12 contract, the Mail and Calendar receive routes and coordination with #45. M1: shared core, catalog and fixtures. M2: cinema chain and aggregator storefronts. M3: live-event storefront. M4: Mail, Calendar and Contacts integration. M5: local and independent validation evidence. The work depends on the platform contract in #12; other open proposals are optional links, not assumed dependencies.
- **Resources and total effort (required):** 28–38 person-days, run on local CPU with Docker and Playwright. Fixtures and assets stay below 50 MB, and no paid collection or generation service is used. Exact dependency versions and source hashes are recorded. Model-trial counts and costs are TBD with maintainers before paid validation, since local mechanics alone do not establish agent difficulty.
- **Scope boundary and open questions (required):** In scope: showtime and event search, seat selection, ticket types, memberships, rewards, vouchers, presale registration, concessions pre-order, purchase, transfer, exchange and refund, and theater- or organizer-initiated changes across the three storefronts. Excluded: real purchases and payments, live showtime, event or availability feeds, queue or CAPTCHA bypass, automated bulk buying, resale and secondary markets, dynamic pricing beyond published tables, private screenings, and copyrighted posters, trailers or event media. Open questions, to be resolved with maintainers at M0: whether to include the classic-film layer, how to divide live-event work with #45, the exact Calendar routing, and actor binding for recipients and admission.
- **License and external dependencies (required):** Original code is MIT. Original fixtures, seat maps and generated art are CC0-1.0, and Wikidata metadata is CC0. Public-domain images are included only with a per-file record and are otherwise excluded. No AMC, Fandango or Ticketmaster code, brand assets, text or data are copied. All components ship with the package and run offline, with no hosted-only or live third-party dependency at run time.

After design approval, add implementation and reproducible validation evidence against these deliverables in the same PR. Return substantial scope changes for review.
