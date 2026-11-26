## Track and stage

**Track (required): select one.**

- [x] Environment Track
- [ ] Task Track
- [ ] Other change

**Stage (required):** Validation. @skyve2012 approved the current proposal text. This revision answers the 26 November 2026 review.

## Design

**Design file (required for Environment or Task):** [`proposals/environment/forkyard-code-host.md`](https://github.com/suraj-ranganath/Personal-Agents-Last-Exam/blob/environment-proposal/forkyard-code-and-publishing/proposals/environment/forkyard-code-host.md)

The approved plan is the baseline for implementation review and merge in this same PR.

## Summary and dependencies

**Summary (required):** Forkyard is a resettable code-hosting App: forks, pushes, pull requests with reviews, reopen rules, interaction limits, locked threads and blocks, public profiles with activity, and releases, tags, commit ancestry and seeded read-only check runs. Maintainers and bystanders act only through Infra events, so a task controls when a pull request is closed and what a stranger says. Public writes are retained with every revision, and an App-owned evidence helper joins them with Core audit and the supplied execution records to produce subject references, links, attention rows and logical attempt counts. Closure notices reach Mail through a Forkyard-owned publisher; a committed closure stays closed whatever happens to delivery. Following review, blogs and short posts moved to a separate App, Postyard (companion PR), linked only by shared `person_id` values and a shared evidence schema. The first runnable package (repositories, pull requests, the rejection path, the closure email and the evidence helper) is planned within 14 days of plan approval.

**Dependencies / questions (optional):** Platform dependency: public runtime 1.6.0, Messaging and Mail 1.3.0 on `main`, including the runtime and Mail contract merged through #12 and #84. First consumer: task #74. Releases, tags and ancestry were added for task #119, whose signed manifests stay task-owned. Companion: Postyard (publishing App, separate PR). Overlaps checked: #26 (community posts), #66 (business reviews), #22 (job profiles), #16 (public comments on rules); none provides a code host. Optional Mail notifications use Mail 1.3.0 `urn:pale:email-message:2` with payload `urn:pale:email-payload:1`.

## Implementation

Forkyard v1 lives under `apps/forkyard/`. It exposes 45 `forkyard.*` tools, 15 Infra events, the rejected-pull-request seed, the release seed, the locked-project and owner-library fixtures, and a public-speech evidence export.

Evidence rows take their epoch from the row, the batch, `call.version.epoch` or the Core `call.result.version.epoch`, and every supplied identity has to agree. A Postyard link joins only a Postyard companion. When a schema is present it must be `urn:pale:public-speech-evidence:1`. The revision object must match the link, and the linked handle must match the Forkyard account accepted as author. If `actor_account_id` is a Forkyard account, its handle must match the link, and any `person_id` on the revision or the document must equal that account's `person_id`. If `actor_account_id` is a foreign id such as `ac-0001`, the join uses the Forkyard account whose `person_id` matches the revision and whose handle matches the link. Document `person_id`, revision `person_id`, and the matched account `person_id` must agree wherever they are present. A mismatched `person_id` fails for `ac-0001` and for `fy-tomasreyes`.

Delivery confirmation reports the inspected Mail event and checks that receipt's event id, run, App and epoch against the attempt. After a lost acknowledgement the publisher halts the run and makes no further publish; a reset after a halt keeps the earlier confirmation in history. Within the same run and receiver epoch, a duplicate request returns the original receipt. `runtime/core` is unchanged.

### What changed for this review

The reviewer renderer is documented as read-only. `gui/src/view.js` renders escaped, read-only views for human reviewers. It has no controls and is not an interactive GUI. The approved plan lists only this optional read-only renderer, so no GUI is claimed. Agents use the MCP tools. The three planned views are `renderPullThread`, `renderProfile` and `renderEvidenceSummary`. `render` remains. Evidence-summary counts are taken only from arrays.

The optional Mail path has a real run: [mail-run.json](https://github.com/suraj-ranganath/Personal-Agents-Last-Exam/blob/environment-proposal/forkyard-code-and-publishing/apps/forkyard/contribution/mail-run.json), produced by `npm run evidence:mail`. The seed loads at `2026-11-18T09:00:00-08:00`. Closure event `fy-021` is applied at `2026-11-18T09:05:00-08:00`, and Mail's clock is moved to that same instant before publish. The receiver is Mail account `mail-maya` at `maya.main@example.com`, epoch 1, receipt version `{epoch: 1, revision: 2}`, receipt run `fy-mail-record`. The stored message is thread `forkyard-fy-tomasreyes-notice-1`, subject `[tidewater/tidewater] PR #2318 closed by @ihalvorsen`, `received_at` `2026-11-18T09:05:00-08:00`. The replay is a duplicate of event `router-dc772a9d2c43cb3ff2c1d22f72d43149`, reconcile `confirmed`, `duplicate_within_run: true`. Message counts are 2, then 3, then 3. `npm run test:mail` stays the fault-harness coverage.

Coverage is [coverage.md](https://github.com/suraj-ranganath/Personal-Agents-Last-Exam/blob/environment-proposal/forkyard-code-and-publishing/apps/forkyard/contribution/coverage.md), reproduced by `node examples/coverage-report.cjs` and `--load`. Fieldbook pull requests now carry distinct trail notes, and the reviews refer to text that is in the diff. Loading the owner library and applying December reaches 295 dates. All five seeds plus December reach 325 dates and 24 of 24 months.

### Addition recorded for #260

The owner library gains `tomasreyes/fieldbook` with activity from 2025-01 through 2026-11-16. December 2026 ships as four staged events in `examples/events/owner-library-2026-12/events.json`, applied after `env.advance_time`. `tomasreyes/notebook` is unchanged: 81 commits, six tags, three releases and bot pull request 10. Together the two repositories have 291 in-window dates (290 primary), from 2025-01-02 to 2026-11-16, with 28 records before 2025 excluded. All seeds deduplicate to 321 dates (319 primary) and 75 excluded records. With the December events the window is 325 dates and 24 of 24 months. This goes beyond the approved fixture contents. Skyve can accept it here or ask for it to move to a follow-up.

Results on this head: business tests 11/11, public MCP integration 10/10, runtime and Mail checks passed, `npm run evidence:mail` wrote the receiver record above, `node examples/coverage-report.cjs --load` committed the four December events, root `npm test` 22/22, and `app:verify` passed. The verifier report is [docs/forkyard-v1-verification.json](https://github.com/suraj-ranganath/Personal-Agents-Last-Exam/blob/environment-proposal/forkyard-code-and-publishing/docs/forkyard-v1-verification.json). The verification note is [verification.md](https://github.com/suraj-ranganath/Personal-Agents-Last-Exam/blob/environment-proposal/forkyard-code-and-publishing/apps/forkyard/contribution/verification.md).

Remaining work: human provenance review of the dataset, and production remote authentication and deployment checks if they apply.

## Progress and evidence

- [x] Proposal ready for design review
- [x] Plan approved by maintainer
- [x] Implementation complete (first runnable version)
- [x] Validation evidence attached

**Evidence:** [verification.md](https://github.com/suraj-ranganath/Personal-Agents-Last-Exam/blob/environment-proposal/forkyard-code-and-publishing/apps/forkyard/contribution/verification.md), [coverage.md](https://github.com/suraj-ranganath/Personal-Agents-Last-Exam/blob/environment-proposal/forkyard-code-and-publishing/apps/forkyard/contribution/coverage.md), [mail-run.json](https://github.com/suraj-ranganath/Personal-Agents-Last-Exam/blob/environment-proposal/forkyard-code-and-publishing/apps/forkyard/contribution/mail-run.json), and [docs/forkyard-v1-verification.json](https://github.com/suraj-ranganath/Personal-Agents-Last-Exam/blob/environment-proposal/forkyard-code-and-publishing/docs/forkyard-v1-verification.json).
