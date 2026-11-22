# Pull request description

The upstream pull request is https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/87. This checkout cannot edit that description. The text below is the description to put on the pull request. It keeps the proposal template and adds the implementation record.

---

✍️ Replace each `[Fill in: …]` with your answer. Optional fields can be `None`. For unresolved details, use `TBD` and explain how they will be resolved.

## Track and stage

**Track (required): select one.**

- [x] Environment Track
- [ ] Task Track
- [ ] Other change

**Stage (required):** Implementation

## Design

**Design file (required for Environment or Task):** [`proposals/environment/keelcard-virtual-cards.md`](https://github.com/suraj-ranganath/Personal-Agents-Last-Exam/blob/environment-proposal/keelcard-virtual-cards/proposals/environment/keelcard-virtual-cards.md)

Provide a concise concept and a construction plan covering scope, deliverables, quality checks, dependencies and effort. The approved plan is the baseline for implementation review and merge in this same PR.

Copy the [Environment template](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/blob/main/proposals/templates/environment-proposal.md) or [Task template](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/blob/main/proposals/templates/task-proposal.md) into `proposals/environment/<slug>.md` or `proposals/task/<slug>.md`.

Title: `[Environment Proposal] [<Domain>] <App or website name>` or `[Task Proposal] [<Domain>] <Short task title>`.

Both tracks must choose one primary domain and optional secondary domains from the [domain list](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/blob/main/CONTRIBUTING.md#environment-domains). Use exact names in the design and title, primary first, with ` + ` between domains.

## Summary and dependencies

**Summary (required):** Keelcard is a resettable virtual-card account shared by an owner and their assistant as a delegate. Cards can be single-use, merchant-locked, category-locked or general, with per-transaction, daily, monthly and lifetime limits enforced in a documented decision order. A delegate can lower limits and pause cards directly; raising a limit or removing a block is a change request verified by an emailed code or by an owner decision, chosen per fixture. Wrong-code attempts, declines and expiries are committed business records, so they survive Core's rollback of rejected writes. Receipts, declines and codes go to the owner's Mail through a Keelcard-owned publisher. Duplicate publication is guaranteed for the live session that has not halted. A corrected configuration is a new run. Merchants read authorization decisions back with `authorizations.lookup`. Evaluation evidence is assembled from Keelcard history, Core audit and the supplied execution records. The first runnable package is in `apps/keelcard`.

**Dependencies / questions (optional):** Platform dependency: public runtime 1.6.0, Messaging and Mail 1.3.0 on `main` (`61b6371`), including the runtime and Mail contract merged through #12 and #84 and Core's clock-only `env.advance_time`. First consumer: task #75. Merchant Apps that could send authorizations through the proposed `channel.card.authorization` contract: #37, #69, #45, #20. Boundaries: #6 (bank and brokerage, no cards; funding stays a local balance), #68 (excludes virtual cards). Open point for Infra: whether a merchant's business client can be launched with an allow list limited to `authorizations.lookup`.

The [proposal list](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/blob/main/proposals/proposal-list.md) automatically reads this PR and its completed proposal file. Include one proposal file, preserve the template's headings and field labels, and keep your answers current. Do not edit the generated list.

## Implementation progress

The first runnable package is `apps/keelcard` (version 1.0.0), registered in `apps.registry.json`. Agent tools use the `keelcard.` prefix. `apps/keelcard/README.md` maps the proposal's short names onto those tools and tells task authors which fixture, clock, tools and snapshot fields to use.

What is in this package:

- Cards, pauses, close, reveal, direct lowers and blocks.
- `email_code` and `owner_approval`, including the configurable 24-hour owner window.
- Authorization, capture, reversal and `ledger.settle_due`, with declines, spend summary, statements and `authorizations.lookup`.
- Fixture (a) at `apps/keelcard/fixtures/minimal.json`: card `card-4417` at 7500 cents per transaction, 14 months of Saturday FreshCart captures, the $212.40 snack capture, and the historical 9000-cent decline.
- Publisher `apps/keelcard/src/publisher.cjs`. A halt stops further publication. Infra inspects Mail and reports confirmed or unresolved. The request and code stay.

The recovery wording in the proposal table and in the integration acceptance line matches that behavior. Merchant lookup stays a Keelcard read. Infra can still apply `authorization.request`. Core is unchanged. `email_code` remains the fixture default.

Run and verify from the repository root:

```sh
node --test apps/keelcard/tests/business.test.cjs
node apps/keelcard/examples/run.cjs
node --test apps/keelcard/tests/mail-integration.cjs
node runtime/cli.cjs verify --app apps/keelcard
npm test
```

Observed on Node v22.23.4: business tests 14 passed; the example printed a new 2500-cent hold (`auth-0001`) and balance 441170; Mail integration 3 passed (committed delivery, live-session duplicate, pre-dispatch `recipient_not_authorized`, and a halted `unknown` that stops after one send); `app:verify` passed for Keelcard 1.0.0 on runtime 1.6.0; `npm test` passed 22/22 stages. The captured record is `apps/keelcard/contribution/evidence.md`.

Downstream task #75 can use fixture (a), advance the clock to `2026-11-20T06:10:00-05:00`, and read card `card-4417`, the 12438-cent decline key `freshcart:fc-grace:fc-order-8812:1`, and the 7062 and 4327 cent approvals. The code is on the Infra snapshot and in the notice body. It is absent from the Agent tool result. `src/fingerprints.cjs` `scan` is the check for a number, security code, expiry, or last four together with expiry.

Still outside this package: disputes, refunds, funding top-ups, alert-preference writes, fixtures (b) and (c), the merchant receive contract, the evaluator join script, and an interactive web page.

## Progress and evidence

- [x] Proposal ready for design review
- [x] Plan approved by maintainer
- [ ] Implementation complete
- [x] Validation evidence attached

Update the checkboxes as work progresses. After plan approval, link implementation and validation evidence to the planned deliverables. Request another design review for substantial scope changes.

**Evidence (required for final validation; optional for proposals):** First-package evidence is `apps/keelcard/contribution/evidence.md`. `node runtime/cli.cjs verify --app apps/keelcard` passed. `npm test` passed 22/22. The completion items listed above are still open, so the implementation checkbox stays open.
