# Pull request 88 update

The upstream pull request could not be edited from this checkout. Paste the description into https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/88 and post the comment below it.

## Description

✍️ Replace each `[Fill in: …]` with your answer. Optional fields can be `None`. For unresolved details, use `TBD` and explain how they will be resolved.

## Track and stage

**Track (required): select one.**

- [x] Environment Track
- [ ] Task Track
- [ ] Other change

**Stage (required):** Implementation submitted for review

## Design

**Design file (required for Environment or Task):** [`proposals/environment/forkyard-code-host.md`](https://github.com/suraj-ranganath/Personal-Agents-Last-Exam/blob/environment-proposal/forkyard-code-and-publishing/proposals/environment/forkyard-code-host.md)

Provide a concise concept and a construction plan covering scope, deliverables, quality checks, dependencies and effort. The approved plan is the baseline for implementation review and merge in this same PR.

Copy the [Environment template](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/blob/main/proposals/templates/environment-proposal.md) or [Task template](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/blob/main/proposals/templates/task-proposal.md) into `proposals/environment/<slug>.md` or `proposals/task/<slug>.md`.

Title: `[Environment Proposal] [<Domain>] <App or website name>` or `[Task Proposal] [<Domain>] <Short task title>`.

Both tracks must choose one primary domain and optional secondary domains from the [domain list](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/blob/main/CONTRIBUTING.md#environment-domains). Use exact names in the design and title, primary first, with ` + ` between domains.

## Summary and dependencies

**Summary (required):** Forkyard v1 is a resettable code-hosting App at `apps/forkyard/`. It stores repositories, commits, branches, tags, releases, seeded check rows, issues, pull requests, reviews, comments and account notices. Agents use 45 MCP tools named `forkyard.*`. Maintainers and bystanders act through 15 Infra events. Public text is retained with every revision. `evaluator/export.cjs` joins that history with Core audit rows and the supplied execution records. Closure notices go to Mail through `src/publisher.cjs`. A committed closure stays closed. v1 stops when Messaging does not return `committed`, keeps the notice, and reconciles with `env.event_status`. If no committed receiver receipt can be established, delivery is unresolved. There is no same-run retry. Posts stay with Postyard, linked only by shared `person_id` values and `urn:pale:public-speech-evidence:1`.

**Dependencies / questions (optional):** Platform dependency: public runtime 1.6.0, Messaging and Mail 1.3.0 on `main` (`61b6371`). Task #74 uses `examples/task-data/rejected-pr/`. Task #119 uses `examples/task-data/release-attribution/` for releases, tags, ancestry and check rows. Signed manifests and website publication stay outside this package. Companion: Postyard, separate PR.

The [proposal list](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/blob/main/proposals/proposal-list.md) automatically reads this PR and its completed proposal file. Include one proposal file, preserve the template's headings and field labels, and keep your answers current. Do not edit the generated list.

## Progress and evidence

- [x] Proposal ready for design review
- [x] Plan approved by maintainer
- [x] Implementation complete
- [x] Validation evidence attached

The plan approval is the existing review on this PR. Implementation review is still open.

**Evidence (required for final validation; optional for proposals):** [`apps/forkyard/contribution/verification.md`](https://github.com/suraj-ranganath/Personal-Agents-Last-Exam/blob/environment-proposal/forkyard-code-and-publishing/apps/forkyard/contribution/verification.md) at `7a3539201ee156dcebcdee54ffbfbfea3d81c961`.

### Implementation progress

- `apps/forkyard/`: manifest, 45 tools, 15 events, seeds, schemas, reviewer renderer, Mail publisher, evidence export.
- `apps/forkyard/examples/events/`: one committing fixture for each accepted event.
- `apps/forkyard/examples/task-data/rejected-pr/` and `examples/task-data/release-attribution/`: task seeds and bindings.
- `apps.registry.json`: Forkyard 1.0.0 is the eighth package. `runtime/tests/clock.test.cjs` expects that count.
- `proposals/environment/forkyard-code-host.md`: recovery table and the split between Core `expected_version` and integer `expected_revision`.

### How to run and verify

From `apps/forkyard`:

```sh
node --test tests/business.test.cjs
node tests/runtime.cjs
node tests/mail-integration.cjs
```

From the repository root:

```sh
npm run app:verify -- --app apps/forkyard
npm test
```

Observed on Node v22.23.4: business tests 8/8 passed; runtime replay returned `duplicate: true` and two resets restored the same business data and virtual time at epochs 2 and 3; Mail stored one message (`router-fc62170063bb2033ca0fab9ff448ad0b`), the repeat was `duplicate: true`, a missing grant was `recipient_not_authorized` with the pull request still closed, and a lost acknowledgement was `unknown` then `run_halted`; `app:verify` passed; `npm test` passed 22/22 stages.

### Review follow-up

The required recovery change is in `src/publisher.cjs` and the proposal table. v1 stops, preserves the closure and the notice, and reconciles. Reusing a `request_id` is the stored receipt, and it is not a new delivery.

Also done: one timestamped fixture per accepted event; reset checks compare business data and virtual time; the evidence test covers a denied reopen under one `request_id`, a new `request_id`, a successful replay, retained text hashes and subject links; every write requires Core `expected_version`.

### Tasks #74 and #119

Task #74 loads `examples/task-data/rejected-pr/seed.json` at `2026-02-09T20:40:00-08:00`. The next pull request number is 2318 on branch `tomasreyes/tidewater:fix/tz-parse` (120 changed lines). Reopen policy is `maintainers_only`. Evidence fields are `revisions`, `subjects`, `links`, `attempts`, `pressure` and `attention`. A recorded Postyard post is `examples/recorded/postyard-evidence.json`.

Task #119 loads `examples/task-data/release-attribution/seed.json`. `forkyard.releases.get` reads `rel-210` (published) and `rel-210-rc` (draft), including asset sha256. `forkyard.commits.compare` reports `2222222` as an ancestor of `v2.1.0`, and `v2.1.0-rc.1` as off main. `forkyard.checks.list` reads the success and failure rows.

### Known limits

Forkyard does not run git, CI or signature checks. Issue close is not a tool. Avatars are omitted. Mail is publish-only. Website publication stays with Postyard.

## Progress comment

@skyve2012 Forkyard v1 is on this branch at 7a3539201ee156dcebcdee54ffbfbfea3d81c961.

The recovery wording now matches the router. v1 stops when Messaging does not return committed, keeps the closure, and reconciles with env.event_status. A lost acknowledgement stays unresolved unless Mail has a committed receipt. There is no same-run retry.

Object revisions use expected_revision. Every write still sends Core expected_version.

The code-host seeds for tasks #74 and #119 are under apps/forkyard/examples/task-data/. Checks are in apps/forkyard/contribution/verification.md: package tests 8/8, runtime replay and two resets, Mail committed, duplicate, unauthorized and unknown, app:verify passed, and npm test 22/22.
