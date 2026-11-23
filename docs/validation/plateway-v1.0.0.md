# Plateway validation report

Checked November 23, 2026. Scope: `apps/plateway` version **1.0.0** from the approved proposal [`proposals/environment/plateway-delivery.md`](../../proposals/environment/plateway-delivery.md) (PR #111), on public runtime **1.6.0**, Core API **1.2.0**, with Mail **1.3.0** (`examples/apps/mail`) as the optional receiver. Base: `main` at `a4bce023953061483c41de5a287ba5e43f4a5648`. Package SHA-256 (public verifier digest): `0ab2550c46b8f95d358cb45c24b3f2154cc44f5db1c3e2460256fcfb77ff4c3d`; any later change to the package changes it. Machine-readable results are in [plateway-v1.0.0.json](plateway-v1.0.0.json).

**Automated outcome: passed.** Human workflow acceptance, data realism and provenance review remain pending; no approval is claimed.

## Reproduction and evidence

| Evidence | Result | What was exercised |
| --- | --- | --- |
| App-only business | 109 tests passed | Real App hooks against the package's own schemas: every operation and event, totals and rounding, scheduling bounds, release and acceptance timers, cancellation amounts, reports, ratings, notices, seed validation and seed integrity, $0 lines, length limits, the representative fixture, and the Mail message builder, grant check and reconciliation. Failure paths leave data unchanged |
| Fixture content | `dev/check-fixture.cjs` passed | Seed schema and `validateSeed`; holder, addresses, cards, six restaurants (closed weekday, past-midnight and split hours), 36 dishes, allergens, ten past orders (rejected, reported, unavailable line, small-order fee), four ratings, one scheduled and one in-progress order; every total recomputed; zone offsets; every date on or after 2026-01-01; the scenario pauses an open restaurant; size; brand and card-network deny-list |
| Public verifier | 50 checks passed | Discovery, published contracts, Agent versus Infra authority, a real read, history loading and rejection, event commit/retry/conflict, stale reset, separate run, reset to baseline, restarted process; standalone business and event-example stages |
| Isolated package | Passed | The verifier, `tests/mcp.integration.cjs` and `tests/mail.integration.cjs` from a directory holding only `apps/plateway`, `runtime/`, `examples/apps/mail` and `package.json`; the Mail script itself runs in a staged temporary layout with a generated registry |
| Plateway real MCP | 53 checks passed | The proposal's [MCP] parts of T04, T07, T09 and T11, the T06 tie between an event and the acceptance limit, and T15–T16 (each check is named in `plateway-v1.0.0.json`) |
| Plateway → Mail | 38 checks passed | Real Messaging Router and Mail 1.3.0: inbox records, receipts, retries, a reset on each side, refusals before and after dispatch, an unknown acknowledgement with reconciliation, no grant, no Mail bound |
| Node 18.20.8, 22.14.0 and 25.8.1 | All of the above passed on each, plus the repository's full suite (22/22 stages) | Official Node binaries, archive SHA-256 checked against Node's published checksum file; the verifier's package digest was identical on all three |
| Independent base validator | Not run locally | Left to the PR's `base-runtime-compatibility` check |
| Contributor review | Done before submission | Names, prices, allergen declarations against the descriptions, times, labels and notice wording |
| Maintainers' human review | Pending | Realism, failure behaviour and provenance, as the review guide requires |

All data is synthetic. Tests use temporary directories and local stdio MCP, without services, credentials or model APIs. `tests/mail.integration.cjs` takes `--runtime` and `--with` (a later flag overrides an earlier one) and defaults `--runtime` to `PALE_RUNTIME_ROOT`.

```sh
cd apps/plateway
npm test
npm run example
node dev/check-fixture.cjs
npm run mcp
npm run mail
cd ../..
npm run app:verify -- --app apps/plateway --output .artifacts/plateway.json
npm test
```

## Workflow to evidence

| Workflow | Tests | Main assertions |
| --- | --- | --- |
| W1 Browse and check out | T01–T04 | Search by address shows open, closed and paused restaurants with estimates; required and maximum option groups; cart from one restaurant; preview equals placement; one charge; cart emptied; `notice.order_placed` with the itemized receipt; a price change between preview and placement → `stale_preview` with no charge and the cart kept; declining card → `payment_failed` and no order; expired card, outside the area, closed, paused, unavailable dish or option, scheduling bounds; [MCP] a repeated placement request returns the stored receipt and charges once |
| W2 Lifecycle | T05–T09 | Accepted → delayed → picked up → delivered with one notice each and none for pickup; rejection and the 20-minute limit (19 minutes accepted, exactly 20 cancelled); release to an open restaurant, cancellation when paused or closed, unavailable lines removed and refunded; one late event past release and limit → one cancellation and one refund; late events commit but do not change a cancelled or delivered order (timers due by their time still apply); [MCP] an acceptance at exactly the limit → `not_accepted`; [MCP] `env.advance_time` past release and past the limit, reads and previews project, the stored order changes only at the next write, one refund and one notice dated release + 20 minutes; unknown-target and back-dated events → `invalid_event` with data, notices, version and clock preserved and one denial audit row each |
| W3 Cancel | T10, T11 | Full refund before preparation, delivery fee and tip while preparing, refusal after pickup; a token taken before a status change → `stale_preview`; [MCP] an identical retry of a committed cancellation returns the stored receipt |
| W4 After delivery | T12, T13 | Missing or wrong lines refunded once with a notice, batches checked before any refund, the 48-hour and 30-day windows including their last instant, rating once with code-point text limits |
| All | T14–T16 | Notices once per occurrence, timer notices dated at their due time and written at commit, receipt fallback over 20,000 characters, seeded notices kept as history; repeated request IDs, `idempotency_conflict`, `not_found`, Agent management calls → `permission_denied`, failed calls preserve data and version; duplicate and conflicting events, a pre-reset version → `stale_version`, reset restores seed, cart and clock, a token from another seed ID → `stale_preview`, a seed loaded after a release time is caught up once |
| Mail (T14) | `tests/mail.integration.cjs` | Mail's clock synchronized to Plateway's; a delivered order's three notices → three inbox records with committed receipts, received at that time, CloudEvents time kept; identical retry in the same Router session → the first receipts marked `duplicate`, no new record; a Plateway reset leaves Mail records unchanged and a notice after it is a new message; no grant → nothing published, and a publish the Router does not authorize is refused before dispatch without halting; an incompatible publisher contract → rejected before dispatch; a receiver rejection → Router halted, no record, Plateway unchanged; a Mail reset after Router setup → `receiver_lifecycle_changed`, no record; a lost acknowledgement → `unknown`, Router halted, Plateway unchanged, reconciliation in the same Mail epoch finds the committed event and exactly one record, and after a Mail reset the outcome is `indeterminate`; no Mail account bound → nothing published, the entries stay in the log. The package wire schema equals the runtime contract and Mail's receive schema byte for byte, and the proposal's example message is reproduced exactly |

## Reviewer notes on PR #111

- **C1** (who calls the sender): `infra/sender.cjs` follows Mail's publisher model; Infra supplies the Plateway Infra client, the Router client and its grants, and calls `send` after commits that append notices.
- **C2** (seeded timers already due): such seeds are accepted. Reads and previews project the effect; the first write or event commits it as of its due time. This is stated on `orders` in `schemas/seed.schema.json` and tested in the App-only suite and in T16 over MCP.
- **C3** (seven Infra operations): no App change; the verifier passes on runtime 1.6.0.
- **C4** (declined card): a decline stores no App record; Core's denial audit row is the record.
- **C5** (Messages link): outside v1.
- The fixture is dated on or after 2026-01-01 (checked by `dev/check-fixture.cjs`); the App itself accepts earlier Task history, as the platform's Task template allows external-platform records from 2025-01-01. `main` was rechecked on November 23, 2026; it had no commits after the base above, and its `runtime/` and `examples/apps/mail/` are byte-identical to the proposal's pinned `61b6371`.

## Differences from the proposal and interpretations

- **Fixture provenance.** The proposal says "Hand-written JSON fixtures, no generator or model output". The records were authored with AI assistance, then checked by `dev/check-fixture.cjs` and reviewed by the contributor; no generator script produced them.
- **Per-test seeds.** The proposal lists "one fixture per test". The App-only tests build their seeds in JavaScript (`tests/seeds.cjs`, `tests/flows.cjs`) from one base seed, and the integration scripts use the representative fixture.
- **Seed rules.** Beyond the proposal's list, `validateSeed` rejects fields missing or present for an order's status and mode, placement, release and delivery times out of order, refunds that do not match their lines, options that are not on their dish (seeded cart lines are also checked against the option-group limits; historical order lines are not), labels over 40 characters, unknown time zones and notice IDs longer than 80 characters (so `e<epoch>-<id>` fits Mail's 100-character thread ID). It also rejects refunds other than exactly what the App would have refunded (a cancellation refund only on a cancelled order and equal to its cancellation record; each line refund equal to that line's subtotal and tax, capped at what remained of the charge), a missing estimated delivery time and numeric ID suffixes above 999,999,999. A seeded cancellation must match its refund record and the refund rule for its reason (for the account holder, the cancellation's `stage` field, which the App records on every cancellation, or else the stage recorded before it in the timeline; when neither is known, either holder rule is accepted; a recorded `stage` must be one its reason allows, timeline statuses outside the order statuses are ignored, a cancellation cannot follow a recorded pickup or delivery, and an active order cannot carry a later status in its timeline), with the kept amount equal to the charge less all refunds; a reported line needs a delivered order, a release reason needs a scheduled order and a rating follows the delivery. The App sets no date floor and does not restrict its clock, so a registry without an initial time still loads; an order cannot be changed, and an event for it is refused, at a time before that order's own recorded history (`invalid_state` for writes and previews, `invalid_event` for events).
- **Limits not named in the proposal.** A cart holds at most 50 lines; option price deltas are never negative; a tip is at most $1,000, a dish price at most $10,000 and a delivery fee at most $1,000; preparation and travel times are 1 to 180 minutes; a dish has at most 10 option groups of 20 options, a group allows at most 10 selections and an option adds at most $1,000; a day has at most 4 opening spans; a rating average is between 1 and 5; numeric ID suffixes go up to 999,999,999, after which reads still work but writes that need a new ID are refused with `invalid_state`. A removed or reported $0 line gets no refund record; its `notice.item_refunded` is titled “Item removed” or “Item reported” and says no refund was due. The placed notice falls back to the short form when the receipt exceeds 20,000 characters counted either as code points or as UTF-16 units, because the wire and Mail validators count UTF-16 units.
- **Sender inputs.** Besides the Plateway and Router clients, the sender takes the grants from Infra's Router configuration and publishes only when they allow one of the account holder's bound Mail accounts on `channel.email`. Reconciliation after `unknown` is a sender helper (`receiverSetup`, `reconcile`) that compares Mail's run, account and epoch with those recorded at Router setup and reports `committed` only when both the receipt and the inbox record are found (otherwise `indeterminate`); `send` returns the `event_id` it needs.
- **Seven-day horizon.** Measured in local wall time, so a scheduled time seven local days ahead is accepted across a daylight-saving change.
- **ID counters.** An optional seed field `issued` records the highest numeric suffix issued per ID prefix, so IDs are never reused after a removal; the App maintains it.
- **Scheduled times in tokens.** A scheduled delivery time is converted to the seed's time zone before it enters the checkout token, so the same instant written with different offsets (for example `18:00Z` and `13:00-05:00`) previews and places as one.
- **History and new notices.** The sender treats the notice IDs in the loaded seed (`initial_data` in `env.snapshot`) as history; no extra field is stored on notices.
- **Mail failure cases** are induced without changing the runtime or Mail, as described in the package README.

## Remaining items

- The maintainers' human review of realism and provenance.
- Trial runs with an Agent on representative Tasks.
- The independent base validator, through the PR's checks.
