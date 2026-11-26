## Track and stage

**Track (required): select one.**

- [x] Environment Track
- [ ] Task Track
- [ ] Other change

**Stage (required):** Implementation.

## Design

**Design file (required for Environment or Task):** `proposals/environment/keelcard-virtual-cards.md`

Title: `[Environment Proposal] [Money & insurance + Shopping & groceries] Keelcard virtual cards and spend controls (Privacy.com-inspired)`.

## Summary and dependencies

**Summary (required):** Keelcard is a resettable virtual-card account shared by an owner and their assistant as a delegate. Cards can be single-use, merchant-locked, category-locked or general, with per-transaction, daily, monthly and lifetime limits enforced in a documented decision order. A delegate can lower limits and pause cards directly; raising a limit or removing a block is a change request verified by an emailed code or by an owner decision, chosen per fixture. Wrong-code attempts, declines and expiries are committed business records, so they survive Core's rollback of rejected writes. Receipts, declines and codes go to the owner's Mail through a Keelcard-owned publisher with a defined retry path that never creates a second code. Merchants read authorization decisions back with `authorizations.lookup`. Evaluation evidence is assembled from Keelcard history, Core audit and the supplied execution records.

**Dependencies / questions (optional):** Platform dependency: public runtime 1.6.0, Messaging and Mail 1.3.0, including the runtime and Mail contract merged through #12 and #84 and Core's clock-only `env.advance_time`. First consumer: task #75. Merchant Apps that could send authorizations through the proposed `channel.card.authorization` contract: #37, #69, #45, #20. Boundaries: #6 (bank and brokerage, no cards; funding stays a local balance), #68 (excludes virtual cards). Open point for Infra: whether a merchant's business client can be launched with an allow list limited to `authorizations.lookup`.

## Implementation

Keelcard v1 lives under `apps/keelcard/`. It implements cards, spend controls, the ledger, notices, Mail delivery, the merchant authorization contract, fixtures (a), (b) and (c), and the evaluator join used by task #75.

Any router result other than a fresh committed receipt for this binding halts the run. The halt is stored in Core with `publication.halt` before Mail is inspected, and also in `keelcard-publication.json` when the run directory is known. A stale halt write is retried a bounded number of times and read back from Core; if it still cannot be stored, the call returns stopped without calling the router. Mail confirmation and the Keelcard evidence write are reported separately, and `persisted` is true only after a Core receipt or a Core read in that call. Decision-time spend is recorded when an authorization is decided, so a valid decline holds in either event order for the daily, monthly and lifetime windows. `runtime/core` is unchanged.

Results on this head: business tests 30/30 (the verify copy passes 29 and skips the runtime case), checkout 33/33 (4 Mail, 7 merchant contract, 21 MCP, 1 December window), `app:verify` passed with 48 checks, clock tests 7/7, and root `npm test` 22/22.

### What changed for this review

The evidence now separates three checkout surfaces. Mail 1.3.0 runs through the real Messaging router. `examples/test-merchant/` is a stub publisher registered as `app_id: freshcart`; it sends through that same router into Keelcard's receive contract. FreshCart (#37) itself is not used, and this is not a live merchant integration. `env.apply_event` with `authorization.request`, used by the task session and by `examples/scenario.json`, simulates a merchant event from Infra and is not counted as a merchant integration.

`gui/src/view.js` renders escaped, read-only views for human reviewers. It has no controls and is not an interactive GUI. The approved plan lists only this optional read-only renderer, so no GUI is claimed. Agents use the MCP tools. The views are the card list, the card detail with limits, and the transactions.

Fixture (b) merchants now use a fixed list of invented names. Coverage for the 2025-01-01 to 2026-12-31 window is in `contribution/coverage.md`, recounted by `examples/coverage-report.cjs`.

### Addition recorded for #260

Fixture (b) now covers 2025-01 to 2026-11 at about the same file size (641,137 bytes), and December 2026 ships as staged events in `examples/events/freelancer-2026-12.json`. Those events are applied after `env.advance_time`. They are never pre-session history. This goes beyond the approved "9 months of history", and skyve can accept it here or ask for it to move to a follow-up.

The package is about 1.43 MB against the plan's "under 1 MB", mostly fixture (b), which was already 0.62 MB at submission.

## Progress and evidence

- [x] Proposal ready for design review
- [ ] Plan approved by maintainer (re-approval requested after the proposal text was restored)
- [x] Implementation complete (first runnable version)
- [x] Validation evidence attached

**Evidence:** `apps/keelcard/contribution/evidence.md` and `apps/keelcard/contribution/coverage.md`.
