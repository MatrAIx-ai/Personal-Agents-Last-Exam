✍️ Replace each `[Fill in: …]` with your answer. Optional fields can be `None`. For unresolved details, use `TBD` and explain how they will be resolved.

## Track and stage

**Track (required): select one.**

- [x] Environment Track
- [ ] Task Track
- [ ] Other change

**Stage (required):** Implementation. The runnable package is on this branch, pending plan re-approval.

## Design

**Design file (required for Environment or Task):** [`proposals/environment/forkyard-code-host.md`](https://github.com/suraj-ranganath/Personal-Agents-Last-Exam/blob/environment-proposal/forkyard-code-and-publishing/proposals/environment/forkyard-code-host.md)

Provide a concise concept and a construction plan covering scope, deliverables, quality checks, dependencies and effort. The approved plan is the baseline for implementation review and merge in this same PR.

Copy the [Environment template](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/blob/main/proposals/templates/environment-proposal.md) or [Task template](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/blob/main/proposals/templates/task-proposal.md) into `proposals/environment/<slug>.md` or `proposals/task/<slug>.md`.

Title: `[Environment Proposal] [<Domain>] <App or website name>` or `[Task Proposal] [<Domain>] <Short task title>`.

Both tracks must choose one primary domain and optional secondary domains from the [domain list](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/blob/main/CONTRIBUTING.md#environment-domains). Use exact names in the design and title, primary first, with ` + ` between domains.

## Summary and dependencies

**Summary (required):** Forkyard is a resettable code-hosting App: forks, pushes, pull requests with reviews, reopen rules, interaction limits, locked threads and blocks, public profiles with activity, and releases, tags, commit ancestry and seeded read-only check runs. Maintainers and bystanders act only through Infra events, so a task controls when a pull request is closed and what a stranger says. Public writes are retained with every revision, and an App-owned evidence helper joins them with Core audit and the supplied execution records to produce subject references, links, attention rows and logical attempt counts. Closure notices reach Mail through a Forkyard-owned publisher; a committed closure stays closed whatever happens to delivery. Following review, blogs and short posts moved to a separate App, Postyard (companion PR), linked only by shared `person_id` values and a shared evidence schema. The first runnable package (repositories, pull requests, the rejection path, the closure email and the evidence helper) is planned within 14 days of plan approval.

**Dependencies / questions (optional):** Platform dependency: public runtime 1.6.0, Messaging and Mail 1.3.0 on `main`, including the runtime and Mail contract merged through #12 and #84. First consumer: task #74. Releases, tags and ancestry were added for task #119, whose signed manifests stay task-owned. Companion: Postyard (publishing App, separate PR). Overlaps checked: #26 (community posts), #66 (business reviews), #22 (job profiles), #16 (public comments on rules); none provides a code host. Optional Mail notifications use Mail 1.3.0 `urn:pale:email-message:2` with payload `urn:pale:email-payload:1`.

The [proposal list](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/blob/main/proposals/proposal-list.md) automatically reads this PR and its completed proposal file. Include one proposal file, preserve the template's headings and field labels, and keep your answers current. Do not edit the generated list.

## Implementation

Forkyard v1 lives under `apps/forkyard/`. It exposes 45 `forkyard.*` tools, 15 Infra events, the rejected-pull-request seed, the release seed, the locked-project and owner-library fixtures, and a public-speech evidence export.

Evidence rows take their epoch from the row, the batch, `call.version.epoch` or the Core `call.result.version.epoch`, and every supplied identity has to agree. A Postyard companion also joins when its `person_id` matches the Forkyard account's `person_id` and the profile URL handle matches that account, which covers a faithful export whose `actor_account_id` stays `ac-0001`. The existing match, where `actor_account_id` is already a Forkyard account with that handle, still joins. A mismatched `person_id` does not.

Delivery confirmation reports the inspected Mail event and checks that receipt's event id, run, App and epoch against the attempt. After a lost acknowledgement the publisher halts the run and makes no further publish; a reset after a halt keeps the earlier confirmation in history. Within the same run and receiver epoch, a duplicate request returns the original receipt. `runtime/core` is unchanged.

### What changed for this review

The reviewer renderer is documented as read-only. `gui/src/view.js` renders escaped, read-only views for human reviewers. It has no controls and is not an interactive GUI. The approved plan lists only this optional read-only renderer, so no GUI is claimed. Agents use the MCP tools. The three planned views are `renderPullThread`, `renderProfile` and `renderEvidenceSummary`. `render` remains.

The optional Mail path now has a real run: [`apps/forkyard/contribution/mail-run.json`](mail-run.json), produced by `npm run evidence:mail`. The receiver is Mail account `mail-maya` at `maya.main@example.com`, epoch 1, receipt version `{epoch: 1, revision: 2}`, receipt run `fy-mail-record`. The stored message is thread `forkyard-fy-tomasreyes-notice-1`, subject `[tidewater/tidewater] PR #2318 closed by @ihalvorsen`, `received_at` `2026-11-18T09:05:00-08:00`. The replay is a duplicate of event `router-dc772a9d2c43cb3ff2c1d22f72d43149`, reconcile `confirmed`, `duplicate_within_run: true`. Message counts are 2, then 3, then 3. `npm run test:mail` stays the fault-harness coverage.

Coverage is [`apps/forkyard/contribution/coverage.md`](coverage.md), reproduced by `node examples/coverage-report.cjs` and `--load`.

### Addition recorded for #260

The owner library gains `tomasreyes/fieldbook` with activity from 2025-01 through 2026-11. December 2026 ships as four staged events in `examples/events/owner-library-2026-12/events.json`, applied after `env.advance_time`. `tomasreyes/notebook` is unchanged: 81 commits, six tags, three releases and bot pull request 10. Together the two repositories have 291 in-window dates (290 primary), from 2025-01-02 to 2026-11-16, with 28 records before 2025 excluded. All seeds deduplicate to 321 dates (319 primary) and 75 excluded records. With the December events the window is 325 dates and 24 of 24 months. This goes beyond the approved fixture contents. Skyve can accept it here or ask for it to move to a follow-up.

Results on this head: business tests 10/10, public MCP integration 10/10, runtime and Mail checks passed, `npm run evidence:mail` wrote the receiver record above, `node examples/coverage-report.cjs --load` committed the four December events, root `npm test` 22/22, and `app:verify` passed. The verifier report is `docs/forkyard-v1-verification.json`.

Remaining work: human provenance review of the dataset, and production remote authentication and deployment checks if they apply.

## Progress and evidence

- [x] Proposal ready for design review
- [ ] Plan approved by maintainer (re-approval requested; the proposal file on this branch is the approved text)
- [x] Implementation complete (first runnable version)
- [x] Validation evidence attached

Update the checkboxes as work progresses. After plan approval, link implementation and validation evidence to the planned deliverables. Request another design review for substantial scope changes.

**Evidence (required for final validation; optional for proposals):** [Verification note](verification.md), [coverage report](coverage.md), [Mail run](mail-run.json), and `docs/forkyard-v1-verification.json` on this branch.
