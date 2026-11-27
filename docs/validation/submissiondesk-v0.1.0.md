# SubmissionDesk v1 implementation and verification

Owner: Hanson Tang (@hansontang). App version `0.1.0`; public runtime `1.6.0`, Core API `1.2.0`. Implements the MCP-only scope approved in [PR #148](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/148) at `ec0dfd8cd6f2550263e8566e7e51d5a6436dffe2`. The approved proposal file is unchanged. This document records implementation follow-through, not new scope approval or final acceptance.

## First-version boundary

The first version has 21 Agent business operations. Infra lifecycle, persistence, locking, permissions, versions, idempotency, event receipts and clocks come from the unchanged public Core. Business modules import no runtime/private App implementation or Task harness.

Included modification/cancellation behavior:

- A derived material is a new ID with a parent and omitted section IDs. All unomitted content is preserved.
- A bundle is immutable; edits create a new bundle. Changing actual content or author order changes its digest; selecting content-equivalent material under another ID preserves the content digest. Requests/replies retain their original bundle reference. Content-equivalent bundles may have different IDs and the same digest.
- A received submission can be atomically replaced by a new immutable receipt before cutoff. Its active pointer changes only after validation; all prior receipts and full snapshots remain.
- Withdrawal creates another receipt and removes the active public-submission pointer. Reopening that submission is excluded from v1.
- Unanswered requests can be cancelled; a late reply cannot revive them. Resolved replies cannot be edited or cancelled.
- An unused active abstract can be cancelled inside its own open window; an abstract supporting a received submission cannot be cancelled.

Deferred: mutable drafts/title editing, reopening withdrawn submissions, policy/access-change events, semantic approval inference, revocation of a completed approval, outbound Messaging, GUI/CUA and cross-App delivery. These are explicitly excluded capabilities, not simulated successes. The companion Task #151 remains a separate unapproved design with no model qualification claimed.

## Operation and observable-outcome map

All names below have the `submissiondesk.` prefix. Read operations return `status: ok`; successful business writes return `status: committed` and the public Core epoch/revision. `value` is typed against the App's record schemas. Failed calls retain business data and clock; denied attempts may still append public Core audit evidence.

| Workflow and operations | Preconditions / effect | Observable successful outcome | Representative failure and retained state |
| :--- | :--- | :--- | :--- |
| Discover: `workspace.get`, `records.list/get`, `venues.list`, `papers.list`, `materials.list/get`, `bundles.list/get`, `requests.list`, `abstracts.list`, `submissions.list` | Current App/account and permitted tool; read only | Typed records, current virtual time, participant references, active pointer, full historical receipts | Unknown ID is `not_found`; role/account override arguments are rejected; reads preserve business state |
| Public material: `artifact.derive` | Known parent; existing unique section omissions; at least one section remains | New material ID, parent ID, omission list and unchanged remaining text | Unknown/duplicate/all-section omission fails without a new material or altered parent |
| Content identity: `bundle.create` | Known paper; unique same-paper material IDs; known ordered unique authors | New bundle ID and SHA-256 of canonical paper/authors/actual material sections | Unknown/wrong-paper material or unknown author fails; older bundles and receipt snapshots remain unchanged |
| Scoped review: `approval.request`, `approval.cancel` | Known participant; purpose has no bundle; every other scope names an exact bundle; only pending requests can cancel | Pending request; independent `approval.reply` records source, exact digest, response and event ID; cancellation remains in history | Wrong responder/digest, unknown request or reply after cancellation fails; no approval transfers to another bundle |
| Abstract: `abstract.register`, `abstract.cancel` | Known paper/venue; strictly before abstract cutoff; at most one active abstract per paper/venue | Timestamped registration/cancellation record and correlated business-history entry | Exact cutoff is closed; duplicate active registration or cancellation while in use fails unchanged |
| Receive/replace: `submission.preview`, `submission.commit` | Matching active abstract; preview binds paper, venue, policy, digest and active receipt; open commit window | Committed receipt with exact snapshot; replacement links the prior receipt and updates only the active pointer | Another-venue/stale-active preview or closed cutoff fails; earlier received content stays active |
| Withdraw: `submission.withdraw` | Received submission; strictly before independent withdrawal cutoff | New withdrawal receipt with old snapshot and predecessor; active pointer becomes null | A second withdrawal or attempt to reopen fails; historical content stays inspectable |

The portal can technically receive a structurally valid bundle without personal clearance. It does not certify scientific claims, author agreement or disclosure authority. Those are the user/Task's decisions, based on the actual request/reply evidence.

## Identities, representation and provenance

One account per App instance. `account_id` and `owner_person_id` must match an explicit binding with `app_id: submissiondesk`. Five fictional participants are defined by stable person IDs; record sources, authors, recipients and responders must reference known people. The three account seeds are separately loadable instances, not permission to browse all accounts from one Agent session. Actual MCP tests load Mara, Jun and Ali into separate runs/baselines and verify isolation and restart persistence.

| Object | Identity and required links | Visibility / ownership |
| :--- | :--- | :--- |
| Context record / venue / paper | Unique ID; source person for context; ordered known authors; explicit venue policy/cutoffs | Account's Agent-visible business data |
| Material | Unique immutable ID, paper, source person, section text, parent/omissions when derived, creation time | Agent-visible text; no PDF/OCR, remote bytes or file attachments |
| Bundle | Unique immutable ID, paper/material references, ordered person IDs, canonical content digest | Agent-visible; no hidden preferred answer |
| Request / reply | Known recipient, explicit scope, exact bundle when applicable; source person/digest/event ID on reply | Request starts pending; user/provider outcomes belong to trusted Task/Infra actors |
| Received / withdrawal receipt | Submission/venue/bundle, immutable full material snapshot, predecessor, actual virtual time | Historical business evidence; active pointer stored separately |
| Business history | Sequence, operation, affected object ID, `request_id` or event ID, virtual time | Correlates effects to caller returns and Core audit; not a substitute for a commit acknowledgement |

Object IDs are unique across collections. The model rejects broken references, mismatched digest/snapshot, future-dated evidence, cycles and orphaned/branched receipt histories. One material's UTF-8 section JSON is limited to 64 KiB; business seed/state JSON is limited to 512 KiB. The supplied seed is approximately 6.4 KiB with 19 business objects. There are no file assets. The public host's decoded-asset cap is a separate limit, not a general cap on seed JSON.

The original fixture has no duplicate-body padding. Independently identified equal-content bundles, repeated participant requests and historical snapshots can be valid business objects; the dataset therefore allows equal bodies while requiring unique IDs and coherent provenance. This avoids interpreting a content-only heuristic as an invalidation of a legitimate write. Human realism/provenance review remains pending.

## Public event envelope

Only Infra can call `env.apply_event`. Every example below uses the published envelope and an explicit UTC offset. Task/Infra chooses occurrence time; the App does not contain a user simulator or scheduler.

```json
{"event_id":"context-1","at":"2027-02-01T09:15:00-06:00","operation":"record.add","payload":{"id":"note-new","source_person_id":"person-reed","body":"A synthetic review update."}}
```

The source person must exist; the object ID must be new. The new record receives the event's actual virtual time and a history entry. Unknown source or existing ID is rejected without changing data or time.

```json
{"event_id":"material-1","at":"2027-02-01T09:20:00-06:00","operation":"material.add","payload":{"id":"material-new","paper_id":"paper-alder","source_person_id":"person-reed","sections":[{"id":"results","text":"An original revised result."}]}}
```

Paper and source must exist; IDs cannot overwrite existing objects; section IDs must be unique, nonempty and within the UTF-8 bound. The new root material never rewrites a prior material, bundle or received snapshot.

For an exact executable `approval.reply` with the dynamically created request/digest, see `apps/submissiondesk/examples/run.cjs` and `tests/runtime.cjs`. Both construct this envelope from the actual `approval.request` and `bundle.create` responses:

```js
const event = {
  event_id: 'claims-reply-1',
  at: '2027-02-01T09:25:00-06:00',
  operation: 'approval.reply',
  payload: {
    request_id: request.id,
    responder_person_id: request.recipient_person_id,
    status: 'approved',
    body: 'Reviewed this exact synthetic bundle.',
    content_digest: bundle.content_digest
  }
};
```

The request must still be pending and identify that responder and digest. Purpose replies use `answered` and a null digest. Other scopes use `approved` or `changes_requested`. Repeated event IDs and incompatible reuse are handled by Core; domain validation failure rolls back the attempted data/time transition. Tests inspect the rejected result, unchanged snapshot data/time/version, and actual `env.event_status` receipt when committed.

## Caller-visible write and reset evidence

For example, after a matching abstract/bundle/preview, a successful `submission.commit` returns the following shape. Actual IDs and version are taken from the run report, not presumed from the request:

```js
{
  status: 'committed',
  app_id: 'submissiondesk',
  version: { epoch: 1, revision: 5 },
  value: {
    submission_id: 'submission-local-1',
    receipt: {
      id: 'receipt-local-1', kind: 'submitted',
      submission_id: 'submission-local-1', venue_id: 'venue-c',
      bundle_id: 'bundle-local-1', snapshot: actualContentSnapshot,
      previous_receipt_id: null, at: '2027-02-01T09:00:00-06:00'
    }
  }
}
```

Core commits the business result, epoch/revision and idempotency receipt under its App-instance lock. Preserve the exact original write arguments when retrying an acknowledged or unknown-outcome request; changed reuse yields `idempotency_conflict`. A successful newer write makes another writer's old observed version stale. Do not infer a commit from an App handler return or a diagnostic log alone.

Reset is the public Infra `env.reset`, not an App-specific tool. It restores **only that App instance** to the most recently loaded data/time baseline, advances the epoch and uses the host's existing receipt/audit-clearing semantics. Export needed snapshots, receipt/history views and supplied execution evidence before reset. The integration test does this before resetting, then reloads a second account/time and proves that a later reset restores that loaded baseline rather than the original package fixture. Snapshot is inspection/export, not a promise of arbitrary restore. Other runs retain independent data.

## Reproduce and review

From an unchanged public checkout with this package:

```sh
node --test apps/submissiondesk/tests/business.test.cjs
node apps/submissiondesk/examples/run.cjs
node runtime/build-contracts.cjs --check
node runtime/cli.cjs verify --app apps/submissiondesk --output .artifacts/submissiondesk-public.json
node apps/submissiondesk/tests/runtime.cjs
npm test
```

The domain tests and example run in an App-only copy without the runtime. The public verifier and additional workflow suite use real separate Agent/Infra stdio MCP processes, actual Core persistence and clock, role denials, failed-event rollback, scoped replies, atomic replacement, cancellation/withdrawal, idempotent replay, concurrency, three account seeds, cross-run isolation, loaded reset and restarted-process reads.

Final machine-readable evidence and measured results accompany this file under `docs/validation/submissiondesk/`. The selected base revision's untouched verifier is also run from a separate checkout against the candidate App. Local Node/OS, package hash and baseline are recorded separately from GitHub's Node 18/22 and base-runtime CI checks. A pending lifecycle/CI check is not called a pass. No Task model run, production remote authentication, maintainer acceptance, merge or authorship eligibility is claimed by this v1 submission.

## Recorded v1 results

- Standalone business tests: **27/27 passed**.
- Public App verifier: **55 checks passed**.
- App-specific real-MCP workflow suite: **67 checks passed**.
- Untouched base runtime verifier: **55 checks passed**, using a separate baseline copy whose 165 runtime files match the pinned public blobs byte-for-byte.
- Full public reference suite on Windows: **20/22 stages passed**. The App-diagnostics stage failed the POSIX `0600` file-mode assertion; the same failure was reproduced from the unchanged baseline. This is reported as a failure, not hidden or counted as an App pass. The required GitHub checks execute on Linux and must be inspected separately.
- The three App verification reports identify the identical portable package SHA-256: `94382f4145e31e2671a4d549de6b45e69a17f1d83c5021e9ea395b193ae879c2`.

The evidence index, exact checks, synthetic caller-visible results and baseline failure are in [submissiondesk/index.json](submissiondesk/index.json), [public-runtime.json](submissiondesk/public-runtime.json), [mcp-workflows.json](submissiondesk/mcp-workflows.json), [base-runtime.json](submissiondesk/base-runtime.json), and [reference-suite.json](submissiondesk/reference-suite.json). Human data/provenance review and maintainer acceptance remain open.

### Additional full-suite failure

The full reference run also timed out in `personal-apps` at the shared runner's 90-second stage budget (`ETIMEDOUT`). That stage was not passed. Its cause is not established by this App delivery, and the timeout is retained in the machine-readable report. The full public suite is therefore **20/22**, not a clean pass. The selected SubmissionDesk App verifier and its pristine-base reproduction each passed 55 checks; the App-specific workflow suite passed 67. Required Linux CI and independent review remain separate.
