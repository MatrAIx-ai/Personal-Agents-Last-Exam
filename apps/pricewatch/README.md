# PriceWatch

An MCP-only synthetic App for exact product-price watches and auditable offer candidates. App `pricewatch` 1.0.0 targets public PALE runtime 1.6.0 / Core API 1.2.0 and Node.js >=18. It has no required App, network service, model API, media or Messaging dependency.

Approved scope: [Environment PR #221](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/221), approved proposal commit `8003171b8bdd6fa11ba83d9c9da3b5fec85c54c5`. The [implementation clarification](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/221#pullrequestreview-6032607839) is resolved below. Task [#207](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/207) is a downstream consumer; its skin history, scenario, grading and model qualification are separate work.

## Run and verify

Business tests and the walkthrough use only this package and Node built-ins:

```sh
cd apps/pricewatch
npm test
npm run example
```

From a public PALE checkout, run the unchanged public verifier and shared-contract checks:

```sh
npm run contracts:check
npm run app:verify -- --app apps/pricewatch --output .artifacts/pricewatch.json
PALE_RUNTIME_ROOT="$PWD/runtime" node apps/pricewatch/tests/runtime-integration.cjs .artifacts/pricewatch-runtime.json
PALE_RUNTIME_ROOT="$PWD/runtime" PALE_NOTES_APP="$PWD/apps/notes" node apps/pricewatch/tests/notes-integration.cjs .artifacts/pricewatch-notes.json
```

The optional Notes example uses actual Notes 1.0.0 business tools in separate MCP processes. It creates a private synthetic note, registers a neutral PriceWatch rule, and writes the returned watch ID into a separate Note. It verifies the private text is absent from PriceWatch data and attributable PriceWatch tool arguments. Notes is not a package dependency or an App-to-App receiver.

For a package copied outside the checkout, set `PALE_RUNTIME_ROOT` to the public runtime directory. The provided `service.cjs` delegates only startup to that Host. Its business modules import no Host code or another App. Use `node service.cjs --role agent --run example --state-dir /tmp/pricewatch-state` for stdio MCP; trusted setup uses a separate `--role infra` process. Seed policies distinguish the read-only `scenario` profile from writable `sandbox`; trusted Infra enables the intended task permissions.

## Watch identity and material changes

`watch_key` is a caller-supplied, account-local, case-sensitive stable **intent key**, not a product-derived name. The server allocates `watch_id`. Upserting the same key updates that same watch even when its product, variant or pack changes. A different key explicitly denotes another intent; the App does not infer that two people or purposes should be merged because their products match. Transport retries keep exactly the same arguments/request ID.

All criteria fields are material: product family, variant revision, pack amount/unit, quantity, allowed sellers, currency and inclusive-price ceiling. Seller IDs are sorted/deduplicated; pack-unit spelling is trimmed/lowercased. Those normalization-only edits are business no-ops. There is no conversion between units or currencies, medical inference or arbitrary free-text metadata.

| Change under the same key | Identity/revision | Candidate effect |
| --- | --- | --- |
| Ceiling 3000 to 2800 minor units, current quote 2700 | Same watch ID; criteria revision +1; new activation if active | Withdraw old available candidate and re-evaluate; a new revision-linked candidate qualifies at 2700 |
| Variant R1 to R2, or pack one to two units | Same watch ID; criteria revision +1 | Withdraw old candidate; only exact new variant/pack quotes may qualify |
| Pause | Same criteria revision; retain prior activation in history | Withdraw available candidates; later prices do not restart the watch |
| Change criteria while paused | Criteria revision +1; still paused, no new activation | No candidate until explicit resume |
| Resume | Same criteria revision unless criteria also change; one new activation | Re-evaluate currently valid quotes; retain old terminal candidates |
| Same normalized criteria and state | No business revision or transition | No duplicate candidate; Core may still increment its own revision for a new request |

Business `watch_revision` and `activation_id` establish rule provenance. They are not Core's optimistic-write version. Core requires `{epoch, revision}` in `expected_version`. An exact retry returns the prior receipt. Reusing that request ID with changed arguments, including an updated version, conflicts; after a stale rejection, read the current state and use a new request ID.

## Tools and market events

- `pricewatch.offers.list`: released quotes, checkout lines, unknown fields and current validity; bounded pagination.
- `pricewatch.watch.upsert`: a complete neutral `criteria` object, `watch_key`, `state`, observed Core version and request ID.
- `pricewatch.watch.list`: current watches and their effective available-candidate counts; bounded pagination.
- `pricewatch.watch.get`: one watch plus separately paginated candidates and transition history, queried by `watch_id`.

Authoritative input/output schemas are in `tools.json` and `schemas/business.schema.json`. Unknown fields are rejected. The agent cannot supply account identity, quote events, eligibility evidence, role or clock changes. Account terms and quote sources are trusted synthetic market records; missing tax/shipping/identity/eligibility is unknown, never zero or eligible. Quote item totals are already extended for their quantity; discounts are applied once. All amounts are safe integer minor units, with no inferred tax or membership enrollment.

Infra injects `offer.quote_upsert`, `offer.revoke` and `offer.expire_due` in `{event_id, at, operation, payload}` envelopes. See `examples/scenario.json` and `fixtures/event-cases.json`. Episode IDs identify immutable full quotes independently of transport IDs. A changed price requires a new episode, with explicit same-target `supersedes` references if it replaces an earlier quote. Replaying revoked/superseded episodes cannot resurrect them. A future sale remains in the task runner's unreleased input until validity starts.

At `now >= valid_until`, list/get projections report no effective available candidate. Reads never write expiry history. A trusted expiry event persists the transition. Stored state and `effective_status` are separate; withdrawn history is retained. Candidate uniqueness is `(watch_id, watch_revision, activation_id, offer_episode_id)`.

An available-in-App candidate does not prove a push notification, a user read, a purchase or an actual assistant reply. The App sends no messages and does not schedule time or wake an agent. An actual notice belongs in a task transcript.

## Fixtures, state and provenance

The small fixtures contain three fictional product families, including a non-skincare filter, exact variants/packs, three sellers and twelve quote episodes. The minimal seed starts without watches. Separate replacement/history examples provide four watch rules, historical revisions/candidates and a second account. An account is loaded with its matching trusted binding; foreign-account records are rejected rather than exposed as distractors to the wrong user. Tasks supply their own dated seed and release events, not a fixed personal story.

Business data is scoped by the trusted App/run/account binding. Invalid writes/events leave business data unchanged; Core can retain denial audit entries. Reset restores the loaded data/time baseline and advances the epoch. Snapshot is administrative evidence, not an arbitrary restore API. Stored IDs and history allow the task's supplied execution trace to be joined to Core outcomes; no self-reported presentation/read receipt is used.

All code and original fictional fixtures use the repository's MIT license. Fixtures were authored for this contribution with Codex assistance; no private skin records, live prices, receipts, commercial images, scraped datasets or external API credentials were used. URLs use reserved fictional domains and are never fetched. Human plausibility/provenance review and final acceptance remain maintainer decisions.

Related work: [Fueltrail #204](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/204) addresses fuel-station alerts; [FreshCart #37](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/37) addresses multi-store catalog/membership pricing; [Porchswap #186](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/186) addresses marketplace transactions. PriceWatch owns neutral exact-retail quote/watch/candidate lifecycle behavior. These proposals can proceed in parallel; none is a required runtime dependency. Generic [Notifications #191](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/191) and deal-handling [Task #21](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/21) are not copied or assumed delivered.

See `VALIDATION.md` for the frozen package/runtime, reproduction commands and observed evidence. Local App/MCP verification is not a production deployment test or a model-agent benchmark. No GUI, phone push, checkout, clinical decision, external ingestion or global scheduler is in this approved v1.
