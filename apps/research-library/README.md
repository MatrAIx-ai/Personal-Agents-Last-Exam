# Research Library: standalone six-workflow candidate

The standalone implementation and workflow evidence for PALE [Environment PR #4](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/4), based on approval of `74892fc606cff01f398424134ade3f0165a72351`. The original proposal is unchanged. The package declares App ID `library` (its tool namespace), version 0.1.0, and no external App or service dependencies.

Implementation lead: **Xiao Cui (@2018cx)**. This does not assign ongoing maintenance.

## Reproduce the standalone implementation

Requires Node 18+ and the public PALE runtime 1.6.0 / Core API 1.2.0 in a separate checkout pinned at commit `61b637164e4abddf81536bb48935cdb688a69ff1`. The approved proposal branch predates that runtime and intentionally does not vendor it.

From the root of the proposal branch, set `PALE_RUNTIME_ROOT` to the upstream checkout's absolute `runtime/` directory. Then run:

```sh
node --test apps/research-library/tests/business.test.cjs
node "$PALE_RUNTIME_ROOT/cli.cjs" verify --app apps/research-library --output /tmp/research-library-verify.json
node apps/research-library/tests/core-demo.cjs
```

The first command tests App handlers. The second uses the real public PALE verifier; confirm that the JSON report says `passed: true`. The third runs a deterministic synthetic scenario via the upstream `Client` against separate Agent and Infra stdio connections over the same temporary App instance. There is no network service, install step, external model call, or live customer data. For manual inspection, the App's `service.cjs` is a launcher for the upstream runtime; consult that runtime's supported flags and choose a synthetic state directory.

### Scope and expected evidence

- Agent business tools: `library.search`, `library.get`, `library.catalog_search`, `library.import`, `library.save_record`, and `library.save_note`. Reads return observed Core versions. Writes take `expected_version` plus a retry-stable `request_id`; edits also require the record revision. To retry a lost reply, send the exact same arguments. A fresh action must use a fresh ID; stale writes require read-back and renewed user intent where relevant rather than blind retries.
- Account actor is derived from the Infra identity binding, never from an Agent tool parameter. An editor grant for one library does not authorize other libraries. Reads of shared records show only the bound actor's own private notes. Imports create one record per library/catalog item. Agent tools cannot seed, grant, snapshot, reset or advance virtual time.
- The seed binds one actor as a viewer of a group library. The Agent reads authorized records, is denied an import, and cannot read a different private library or another author's note. Infra applies the offset-bearing `library.permission_change` event between calls, after which a pre-event version is stale. With the refreshed version, the Agent imports and edits a synthetic record, writes its own private note, and verifies via Agent read-back. The scenario also confirms exact replay, conflicting replay, duplicate import denial and session expiry.
- Infra uses an evaluator-only snapshot for evidence. Reset on the latest version restores seeded data/resources/virtual clock while creating a new epoch and not retaining prior request/event receipts. No whole-run restore or other App state is implied.
- This first milestone is a backend runnable slice, not full approved scope or merge readiness. No Web Host GUI/browser acceptance, collections, citations/export, trash/restore, catalog correction event, optional personal-App integrations, model evaluation, or independent replication is claimed. Those belong to later milestones in the approved plan.

## Provenance and licensing boundary

Newly authored App business logic, Tool schemas, seed data, demo and tests are released under [MIT](LICENSE). The two seeded bibliographic records, their catalog entries, role grants and note were authored as fictional examples; none were scraped or copied. The package compatibility envelopes `app.json`, `contribution/{contribution,dataset}.json`, `schemas/state.schema.json` and the bundle/resource/asset-catalog/asset-descriptor/dataset/quality schema files are derived from the pinned upstream App template or copied from its Contacts package for compatibility; see `UPSTREAM-MIT-NOTICE` for their original MatrAIx.ai MIT notice. No upstream licensing is changed. The synthetic data source is marked MIT and permitted; human review of dataset quality remains pending. No production hosting, maintenance appointment, or final acceptance is claimed.

## Standalone backend workflow expansion

This checkout extends the first milestone with all six MCP workflow paths. Reuse the
same commands above against the pinned runtime; `core-demo.cjs` now covers collection
create/rename/membership, viewer citation preview versus editor persistence, exact
BibTeX bytes and immutable local export read-back, correction rejection/replay, and
preservation of record ID, notes and membership across trash and restore. It still
exercises actor/role isolation, version and request receipts, virtual expiry, and
reset. Browser evidence is recorded separately below. No optional Mail, Calendar or Contacts validation is implied by the backend tests.

Each call is scoped by `library_id`; do not add actor/account fields. Every write
uses a fresh `request_id` plus read-back `expected_version`. Record edits, trash
and restore additionally use `expected_record_revision`. For an identical
transport retry reuse the exact initial arguments; issue a new request only for new
intent. Preview or discard a draft locally; no persisted cancellation call exists.

| Operation | Additional inputs | Result fields (besides the Core envelope) |
| --- | --- | --- |
| `list_collections` | none | `collections`; each has `id,library_id,name,member_ids` |
| `create_collection`, `rename_collection` | `name`; rename also `collection_id` | `collection` |
| `set_membership` | `collection_id,record_id,member` (boolean) | `collection` |
| `preview_citations` | `record_ids`, 1–25 unique active IDs, in desired order | `bibtex,record_ids`; not saved |
| `export_citations` | same selected IDs and write metadata | `export`: `id,library_id,record_ids,bibtex` |
| `read_export` | `export_id` | `export` |
| `list_trash` | none | `records` |
| `trash_record`, `restore_record` | record `id` and expected record revision | `record` |

Trash hides a record's membership from the active view without deleting the
stored membership or notes. After restoration it rejoins existing collections
under its original ID. Exports are local immutable text artifacts with no delivery
operation; allowlisted citation fields are title, author and year. Maximum eight
exports per App instance, 16 KiB UTF-8 per export, and 25 unique records per call.
`library.get` returns `text_preview` with `available` or `missing` status. The
synthetic seed permits up to 20 such text previews at 8 KiB each, and capacity
limits count UTF-8 bytes, not JavaScript string length. The business data limits
are App-instance-local.

Infra-only `library.catalog_correct` takes a named record, its expected record
revision and a nonempty patch of `title`, `authors` or `year`. It updates the
existing record revision only; its local tags, reading progress, notes and
membership remain unchanged, as do any previously persisted exports. This is
independent from the reusable catalog template used by future imports.

## Local Web Host and browser checks

The App GUI layers App-owned GUI over the published PALE Web Host / fixed Agent MCP connection. It does not add business logic, request credentials, change the approved proposal, expose Infra, or use real Library records. For real HTTP+MCP evidence, set `PALE_RUNTIME_ROOT` to the runtime in the approved public checkout (commit `61b637164e4abddf81536bb48935cdb688a69ff1`) and run `node tests/web-host.cjs` from this directory. Use the same runtime's `cli.cjs verify --app "$PWD"` for the platform verifier. HTTP evidence is not a rendered browser pass.

To reproduce the GUI against a local loopback Host, put this package at `apps/research-library` in a disposable copy of the pinned public checkout and run at that checkout root:

```sh
printf '%s\n' '{"schema_version":1,"initial_time":"2027-01-08T08:00:00Z","apps":[{"app_id":"library","version":"0.1.0","path":"apps/research-library"}]}' > library-ui.registry.json
node runtime/web/server.cjs --app library --registry library-ui.registry.json --run library-ui --profile scenario --state-dir /tmp/pale-library-ui
```

Open the printed loopback link. The initial principal is synthetic `b`, a viewer. Search `group-1` by title, tag or reading status; open “Field Notes”; its note authored by `a` must not render. Query `private-a` and verify denial. Open Catalog, select “Synthetic Survey,” Cancel, and check that the Library still has one visible record. Confirm as viewer and verify denial with no persisted effect. Separately, an authorized synthetic Infra client may apply `examples/scenario.json` with the observed Core version to grant editor access in that same run. Refresh before reopening the form. Confirm import, read back the record, edit its metadata and save your own private note; refresh and verify persistence. Hold an edit dialog across a separate Core write or clock advance and verify the stale/expiry message and unchanged business data. For a fresh synthetic run, reset with separate Infra and compare persisted business records and time, excluding changed Core epoch/audit.

The public Host exposes these sections against the standalone second-milestone backend. Exercise each branch separately before claiming GUI acceptance:

| Workstream | Browser path and acceptance evidence |
| --- | --- |
| Collections | Create, rename, add/remove a member and cancel confirmation. Read back exact collection/member IDs; removing membership must preserve the source record. Viewer denial and stale edits leave state unchanged. |
| Citations | Select explicit records, preview without writing, cancel export, then confirm and read the exact local artifact by returned ID. Assert byte equality, selected-only allowlisted fields, no private note, and no artifact for invalid/over-limit/denied attempts. |
| Trash and restore | Cancel and then confirm trash of an identified record; active search omits it and trash lists it. Restore the same ID and verify original metadata, private notes and collection membership are retained as specified. |
| Optional context | Only use prepared synthetic scenarios; downstream App reads are not mocked as Library writes. Validate any actual Mail/Calendar/Contacts source separately and check isolation on Library reset. |

Viewer/editor grants remain authoritative in the App; tool discovery alone does not distinguish those grants. Available write forms explicitly warn that saving requires an editor grant and display Core's denial without changing state. Browser controls capture versions at form open; Cancel sends no business write, and retry of an identical form in the same dialog keeps a stable request ID.

## Delivery evidence index

- **Business workflows and GUI:** [ordered Chromium evidence and independent Core readbacks](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/4#issuecomment-7204126885) for reviewed App code `43d7789694090b50af365b3f08d6ea52d0faf60c`. This data-only addition does not change the UI or the default fixtures.
- **Full-window history v1.0.0:** [provenance, loading and rerun instructions](data/history-v1/README.md), [scope approval and reviewed App code revision](data/history-v1/scope.json), [monthly/source counts and SHA-256s](data/history-v1/generated/coverage.json), [activity ledger](data/history-v1/generated/activity.jsonl) and [opt-in load payload](data/history-v1/generated/load-seed.json). Covers all 24 months of 2025–26: 486 activities on 408 dates, entirely synthetic. Use the separate public Infra/Agent MCP check to validate, load, query and reset the delivered bytes. The normal smoke run is unchanged.

## Standalone validation evidence

Validated with public PALE runtime 1.6.0 / Core API 1.2.0 at pinned commit `61b637164e4abddf81536bb48935cdb688a69ff1`. The initial immutable backend milestone already delivered to the PR was `63241ad122603b31aea363942f1dfd378d82a4f5`; this candidate expands it without changing the approved proposal. The App instructions above reproduce the tests from a clean app-only copy and the pinned runtime.

| Layer | Status and observable result |
| --- | --- |
| App business / public verifier | Passed: 9 business tests, all 50 public verifier checks and its two runnable stages. Use the verification command above and inspect its generated report and package hash. |
| Core / Web Host | Passed: independent Agent and Infra connections, permitted and denied edits, identical and conflicting retries, expiry, local file-backed state, role and correction event, seed/reset, actual HTTP→MCP and management endpoint denial. |
| Real Chromium, loopback Web Host | Passed the manual scripted sequence below on original synthetic fixtures, without changing browser sandbox settings. This was not a GitHub Actions run or a model-driven evaluation. |
| Optional cross-App context / deployment | Not run: Mail, Calendar and Contacts are optional separate Task contexts, not App dependencies. No production deployment, live provider access or real personal data is in scope. |
| Independent acceptance | Maintainer review, required exact-commit GitHub checks and independent reproduction are not claimed by these local results. |

**Browser sequence and expected state.** Open a fresh synthetic viewer run. Filter group records by methods, open Field Notes, read its synthetic text preview and confirm another principal's private note remains hidden. Refresh in `private-a`: denied. Return to `group-1`, cancel catalog import, then confirm it as viewer: denied. Infra snapshot retains the two original records, a single collection and no exports. Apply the offset-bearing grant to the same run using independent Infra, import Synthetic Survey as editor, change its title and save a test note. Reload and open the record; both write results persist.

Leave an edit form for Field Notes open and independently apply a correct-version catalog-correction event, e.g. title “Field Notes Corrected.” The old browser confirmation is rejected; refresh shows the correction rather than the draft. Create and rename a collection to Fieldwork; add the imported record, then cancel removal. Preview just the imported record's citation and cancel saving; Infra shows no artifact. Confirm and read the returned local export ID. Exact rendered BibTeX equals preview and excludes the unselected record and private note. Infra shows `export-1` with only `import-1`. Cancel trash once, then confirm; the record disappears from active search. Restore in Trash and read its private note; remove collection membership and verify the original record remains. Reset twice using Infra, comparing business state with the original seed each time. Browser reload shows only the original active group record and empty Trash.

Local evidence excludes browser bootstrap values, live run directories and private data. The UI renders text with DOM text nodes, and never serves an external resource or forwards a report.
