---
name: app-delivery-review
description: Verify a completed PALE App implementation against its approved scope, with reproducible business and MCP tests, GUI reference comparisons and workflow sequences, real dependency demonstrations, and historical-data evidence. Use for delivery acceptance or implementation evidence gaps, not initial proposal approval.
---

# App delivery review

Review the exact candidate and approved scope. Read the current repository's `docs/review/app-implementation.md`, `docs/review/app-implementation-checklist.md`, `docs/submission-evidence.md`, `docs/app-integrations.md`, `docs/app-contribution.md` and `docs/review/proposal-lifecycle.md`. If the skill is installed without the repository, obtain those sources at the reviewed revision. Do not treat an old PR number as a fixed specification.

## Establish scope and safe reproduction

Pin the proposal approval, candidate App and runtime/validator revisions. Read the PR discussion and the actual manifest, contracts, source, scripts, imports, dependencies, fixtures and tests before executing submitted code. Use disposable state and no production credentials. Attribute a missing Host or platform capability separately from an App defect. Record agreed additions if the evidence policy is newer than the approved scope.

Follow the checklist's four sections; record passed / failed / not run / not applicable, with reasons and artifact links. Do not certify a stage from a green aggregate job that skipped it.

1. **Scope and public package:** run from a clean public checkout with only the package, pinned shared runtime and declared dependencies. Verify actual paths, schemas, tools/hooks and versions. No private repository paths or another App's private state.
2. **Business behavior:** run App-only tests/example without Core or sibling Apps. Exercise real domain success/failure behavior, immutable records/files and read-only guarantees. Minimal App fixtures are not full Task histories.
3. **Runtime and interaction:** run real MCP discovery/calls and compare committed state; check Agent/Infra separation, history load/reset, version conflicts, retries, events and time. Run candidate validation and an independently selected compatible base validator separately. Then perform the GUI and dependency checks below.
4. **Human workflow acceptance:** inspect realism, usability, provenance and every approved core workflow. Test counts alone do not establish completeness. Record unresolved manual decisions and missing evidence.

## GUI evidence and actual operation

Establish required modes from the approved request/proposal/decisions, not just current declarations. An approved MCP-only scope needs no GUI; a promised GUI cannot be downgraded by omission.

For each core GUI workflow, inspect original-product screenshots with source/date, corresponding implemented screenshots pinned to the candidate, and an ordered start/action/intermediate/result sequence including relevant edit/cancel/error cases. Require an explained and reviewed alternative for inaccessible references; never invent a capture. Compare functional coverage and intentional differences, not brand copying or pixel equality.

Start the submitted App with the documented public Host and use actual browser controls. Reproduce key sequences; correlate the visible result with the same run/account's MCP state and receipts. Reload for persistence, refresh after an independent write/event, inspect stale/denied input and backend denial of management operations. Keep browser, App-only business and MCP verdicts separate. Screenshots supplement these tests and do not prove a model Agent or user simulator was integrated.

## Dependency demonstration

Inventory every connection claimed as implemented: required, delivered optional, separate Agent calls and Messaging. Deferred future links remain out of scope. Open pinned public interfaces and run a demonstration against the actual dependency; a test double is only unit-test evidence.

Trace initial states → GUI/MCP action → actual request/result → dependent App record/version/file/receipt. For read dependencies, verify which source was read and how the downstream action used it. Check actual recipient/account, immutable attachment version/bytes/hash and accessible result. Distinguish local send, receiver commit and recipient/business confirmation. Include relevant missing/denied dependency, incompatible version/contract, retries/duplicates and unknown outcomes; inspect both Apps and do not assume rollback. Mail is an example, not a required destination.

## Environment data coverage

Verify the delivered Environment dataset covers 2025-01-01 through 2026-12-31 and loads through public interfaces. Reproduce monthly/source coverage and inspect real/synthetic provenance, hashes, records and gaps. Where older website data cannot be retrieved, check real source data from around November 2026 and realistic synthetic completion of missing periods. Small smoke fixtures do not replace the full delivery dataset. The Task recommendation of 300 distinct dates is not a per-App minimum. If reviewing a Task-selected subset, apply its first-session cutoff and judge relevance; do not reject it solely for fewer than 300 dates. Follow `docs/submission-evidence.md`.

## Report

Use the checklist's report table and link the evidence index. State exact versions, commands/actions, results and artifacts for business tests, real MCP, independent validation, GUI comparison/sequences, every delivered dependency and applicable history counts. Identify gaps and their owners. Keep Core audit, App business history, supplied execution traces and optional diagnostics distinct; do not infer a missing Core feature from a missing artifact.

Recommend acceptance only when all essential approved workflows have evidence. Publication, lifecycle commands and merge require the user's authorization; review files alone do not perform those actions.
