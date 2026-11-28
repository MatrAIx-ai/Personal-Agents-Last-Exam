# StayReady 0.1.0

StayReady prepares a fixed two-night, two-person hotel stay. It separates a traveler's current needs, requests sent to the hotel, and immutable hotel commitments. The three supported services are late arrival, step-free access and breakfast. The fictional Harbor Lantern Hotel is a bounded evaluation environment, not a live reservation service.

This implements [PR #44](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/44), under the [approved proposal](../../proposals/environment/stayready.md). The approval was recorded for `8186a72bd0a5d2f837476db163ab75e36ed61233` by Chenngzz. The proposal is preserved; implementation evidence and additions from the newer submission policy are recorded in [the evidence index](evidence/README.md).

## Run with the public platform

Node 18 or later is required. There are no package runtime dependencies. StayReady reuses the public Node App plugin contract (Core API 1.2.0), runtime 1.6.0 and Web Host; it has no custom server, scheduler or persistence layer.

From the repository root:

```sh
npm ci
npm run app:verify -- --app apps/stayready --output .artifacts/stayready/verify.json
node apps/stayready/tests/mcp-flow.cjs
node apps/stayready/tests/fixture-controls.cjs
node apps/stayready/tests/dependencies.cjs
node apps/stayready/scripts/check-dataset.cjs
node apps/stayready/tests/dataset-mcp.cjs
node runtime/web/server.cjs --app stayready --registry apps/stayready/web.registry.json --state-dir /tmp/stayready-web-state --run stayready-demo
```

Use the URL printed by the Host. The package-owned [web registry](web.registry.json) starts at `2026-12-01T18:00:00Z` and pins StayReady 0.1.0 with paths relative to the package. GUI startup needs only `apps/stayready/` and the pinned `runtime/`, with no repository-root registry or package.json. Contacts/Notes are needed only for the optional integration demonstration. The clock makes the baseline November 30 source observations readable. All local state is disposable; do not put real guest data in these examples.

A clean package-only layout is `runtime/` beside `apps/stayready/`; use the public runtime at upstream `25d5597` (1.6.0). Add `apps/contacts/` and `apps/notes/` only to reproduce the optional integration. From `apps/stayready`, `npm run web -- --state-dir /tmp/stayready-web-state --run stayready-demo` starts the same public Host. No root-level npm scripts are required.

App-only checks need neither Core nor sibling Apps:

```sh
cd apps/stayready
npm test
npm run example
```

For actual browser evidence, from the repository root:

```sh
npx playwright install chromium
node apps/stayready/tests/browser.test.cjs
```

MCP, dependency and dataset drivers accept `PALE_RUNTIME_ROOT=/absolute/path/to/independently-selected/runtime` and `STAYREADY_REPORT_DIR=/absolute/output/directory`. The independent runtime must be compatible with the documented contracts. The browser driver uses the same runtime override or the public Host from the checkout, and writes to an OS temporary directory unless `--output /absolute/directory` or `STAYREADY_BROWSER_REPORT_DIR` is supplied. Install Playwright 1.56.1 and Chromium as explicit browser-test tooling; these are not App runtime dependencies.

The full [delivery reproduction](evidence/README.md#reproduce-the-delivery) copies only the package, runtime and declared participants to a fresh directory before executing its verifiers, MCP flows and actual browser controls. Retained reports are under `evidence/runs/`; their manifest inventories every tested input and artifact without a circular self-hash.

## User workflow and authority

The property declares the IANA zone **Europe/London**. The GUI shows GMT/BST for hotel-local instants and uses local dates for breakfast mornings; UTC remains the wire/storage format. Local form input is converted in that property zone, independently of the browser timezone. Breakfast eligibility and the two-night invariant also use the property-local calendar, so daylight-saving changes do not turn two local nights into a fixed 48-hour requirement.

The GUI has three views: **Your stay**, **Needs & requests**, and **Replies & arrangements**. A traveler reviews current sources, saves a local need, previews the exact disclosure, and submits it. Submission creates a pending request. Acknowledgement and clarification do not create a hotel promise. Only an applicable confirmed hotel reply does.

Each stay has exactly two guests, including the owner. A seeded third person allows one companion to replace another without changing the headcount. Old requests and commitments remain visible. Clearing a local need also preserves hotel commitments; cancel them explicitly. A change or cancellation remains tied to its original predecessor. A rejected change/cancellation leaves the prior commitment intact. A successful change supersedes it; a successful cancellation cancels it.

Source readability and permission to disclose a service field are separate. StayReady accepts only supported facts from currently readable, explicitly granted sources. It never discloses `private_background`, contact details or a full note body to the hotel. A source update or grant change marks linked needs for review and invalidates a previously prepared preview. The Agent cannot manufacture source provenance or disclosure grants through business tools; trusted Infra supplies them in seed/events.

The Agent tools are:

| Tool | Effect |
| --- | --- |
| `stayready.inspect` | Read the filtered current view, all request history and commitment usability |
| `stayready.need.save` | Save or clear a local need using authorized source facts |
| `stayready.people.replace` | Substitute the companion while preserving historical records |
| `stayready.request.preview` | Read a deterministic preview and token; creates no ID or business record |
| `stayready.request.submit` | Atomically recheck the preview and submit arrange/change/cancel |
| `stayready.request.withdraw` | Withdraw a pending request without cancelling a hotel commitment |

Writes require Core `request_id` and observed `expected_version: {epoch, revision}`. The returned business ID is `hotel_request_id`, so it cannot be confused with the retry key. On an unknown outcome, retry the identical call and key; do not invent a new key until the original outcome is known. Changed content with a previously successful key is rejected. Stale edits must be refreshed and reviewed.

Core owns storage, optimistic versions, idempotent receipts, Agent/Infra separation, reset and clock advancement. The GUI is an Agent client only; management operations are denied at the backend even when guessed. There are no Agent controls for snapshots, reset, source injection or hotel replies.

## Exact event matching

Task authors write event payloads before Agent execution. They use seed-known business identities, structured conditions and half-open virtual-time windows `[from, until)`, never IDs generated by a previous Agent call. Infra passes those payloads unchanged.

`stayready.hotel_reply` compares these fields in `target.request_conditions`:

| Service | Compared fields |
| --- | --- |
| Late arrival | `stay_id`, `service`, `person_ids`, `arrival_at` |
| Step-free access | `stay_id`, `service`, `person_ids`, `functional_need`, `window.start`, `window.end` |
| Breakfast | `stay_id`, `service`, `person_ids`, `morning_dates`, `meal_request` |

Person IDs and breakfast dates are canonical sets with duplicates rejected; instants are compared as UTC instants. Unknown fields and inappropriate service/person/date values are rejected. `meal_request` is one explicit service field whose exact value must match; the matcher does not search free-form correspondence or infer semantic similarity.

The selector also compares `need_id`, `action` and `submitted_in`. Change/cancel selectors additionally identify their predecessor using immutable `commitment_terms` and `confirmed_in`; they cannot redirect a reply to a replacement promise. **Requests submitted in one session share the same virtual time unless Infra explicitly advances it.** Identical requests can therefore be ambiguous, even when one is withdrawn. Do not use runtime IDs to remove this ambiguity.

Matching searches the complete history before checking current status. Zero matches, multiple matches, and a uniquely matched withdrawn/superseded request produce a history-only result; they do not confirm a newer request. A final identical reply adds no new business effect, while a conflicting final reply is invalid. Core event receipts make an accepted event retry stable: an event that originally had no match cannot rebind after a request appears.

`stayready.service_unavailable` selects by `need_id`, immutable `commitment_terms` and `confirmed_in`, again across history. It changes only a uniquely selected current commitment. A notice can be recorded now with a future `effective_at`. `inspect` derives `effective_status` from supplied `ctx.virtual_now`; neither reads nor `env.advance_time` mutate the business records. A future notice must not disable the service early or jump to replacement terms.

`stayready.source_updated` increments a specific source version and optionally its disclosure grant version. It flags dependent needs for review. It cannot create arbitrary people, sources or hotel commitments.

See the [event schema](schemas/events.schema.json), [standalone examples](examples/) and [prewritten real-MCP replay](tests/mcp-flow.cjs). Malformed payloads, invalid references, inverted/future selector windows and conflicting final replies fail atomically.

## Reset and replay

The recovery model is **reset plus ordered event/action replay**, not snapshot restoration. `env.load_seed` establishes the baseline; `env.reset` restores that baseline, advances the epoch and clears receipts. The Task replays its fixed source/hotel events and Agent actions in order, with fresh Core versions. Hotel payloads remain unchanged between passes. [The MCP driver](tests/mcp-flow.cjs) verifies complete business-state equality across those passes, event retry stability and separate-run isolation.

## Optional real Contacts and Notes composition

StayReady works independently. The delivered optional demonstration uses the actual public `contacts.get` and `notes.get` tools at version 1.0.0. It reads a bound companion identity and a narrow breakfast fact, then trusted Task/Infra establishes the source provenance and grant before an Agent submits a StayReady request. This is explicit composition, not live synchronization or an inferred disclosure permission.

[The runnable dependency driver](tests/dependencies.cjs) records source account/object/version, actual request/results, unchanged dependency state hashes, downstream conditions and retry receipts. It also tests missing objects, denied reads, unavailable Apps and incompatible pinned versions. No sibling App backend/state file is accessed. Contacts/Notes are optional demo participants, not required plugin dependencies. Messaging, notification delivery, Mail and Calendar are not declared connections. A local request is never presented as a hotel confirmation or email delivery.

## Environment data and provenance

The [dataset manifest](datasets/manifest.json), [coverage report](datasets/coverage.json) and [data evidence](evidence/data-coverage.md) describe independently loadable monthly scenarios from 2025-01-01 through 2026-12-31. Each seed preserves the bounded one-property, two-night, two-person model. The [contribution declaration](contribution/dataset.json) links the complete [evaluation dataset declaration](datasets/declaration.json), including its synthetic source, generation method, manifest and expected counts. Its existing `expected_counts.records: 20` describes the minimal seed required by the runtime contract; the second declaration describes the full delivered library. The library includes varied advance notice, local times, stay dates and companion assignments, plus plugin-generated requests, acknowledgments and final or pending replies. Four substantive patterns retain arrival mismatches, route availability, partial breakfast commitments and companion replacement.

Separately, [six small F1–F6 fixtures](fixtures/scenarios/README.md) each retain two plugin-generated request/reply histories and six fixed event inputs. Their reference, no-action and incorrect executions check business consequences and include ordered replay. An unchanged, already-covered F3 case correctly requires no new hotel request. These fixtures are distinct from the 96 monthly seeds and are not silently added to the dataset's record/date totals.

Guest identities, requests, commitments and future states are synthetic. As clarified in Chenngzz’s November 28 review, this original synthetic dataset does not require real guest records or a real-data anchor. Public hotel pages provide separate GUI/service-behavior references, not guest histories. Counts distinguish observation/confirmation dates from future service dates. The scripts regenerate canonical hashes and verify all seeds; the real MCP loader confirms public loading and retrieval. See [reference sources](evidence/reference/) for URLs, capture dates and inaccessible-reference alternatives requiring reviewer judgment.

## Limits and acceptance

The scope does not include booking/search, room rates, payment, inventory, flight transfers, additional nights/guests, production OAuth/deployment or a model-agent benchmark. No generic business scheduler, new runtime extension or cross-App Messaging service is added. Hotel services and public-reference alternatives still require human realism and provenance review. Automated tests and screenshots support that review; they do not constitute maintainer approval.

The [evidence index](evidence/README.md) records exact revisions, commands, separate App-only/MCP/browser/dependency/data results and unresolved acceptance items. The final review request belongs to the existing PR; only maintainers approve and merge it.
