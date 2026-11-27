# SpaceBook validation map

All commands below run from the repository root with Node 18+ and the pinned public runtime. Browser checks require the repository's Playwright 1.56.1 and its Chromium installation. `PALE_RUNTIME_ROOT` can select an unchanged compatible public runtime for MCP/browser checks. Reports default to `.artifacts/spacebook`; set `SPACEBOOK_REPORT_DIR` to choose another output directory.

| Requirement | Reproduce | Observable evidence |
| --- | --- | --- |
| Atomic bundle, expiry equality, compatibility, opening hours, unknown attributes | `node --test apps/spacebook/tests/business.test.cjs` | No partial allocation; reads do not mutate; offset/DST and adjacent intervals checked |
| Reviewer replay/replacement chain | `node apps/spacebook/tests/integration.cjs` | Original request receipt unchanged after outage; fresh read disrupted; failed replacement preserves data; valid replacement survives restart with one active linked booking |
| Concurrent writes, stale version, replay conflict, permissions, run isolation/reset | Same integration command | Real MCP processes and persisted Core state, not an in-memory substitute |
| GUI workflows and errors | `node apps/spacebook/tests/browser.cjs` | Ordered screenshots, actual controls, persisted records/versions, stale/unavailable forms, lost-response retry, reload, expiry and mobile overflow |
| Full-window data and fixtures | `node apps/spacebook/scripts/dataset.cjs --check` | Generator and dataset hashes, monthly/source coverage, 480 lifecycles with nonuniform activity |
| Real historical loading/query/reset | `node apps/spacebook/tests/dataset.cjs` | Full evaluation dataset and eight fixtures loaded through real Infra; Agent sees only its owner's records |
| Task history cutoff | `node --test apps/spacebook/tests/history.test.cjs` | Whole completed replacement chains selected before first session; future/in-progress outcomes omitted |
| Task reference controls | `node apps/spacebook/tests/reference-controls.cjs` | Correct and recovered outcomes pass; no-op, hold-only, unsuitable, duplicate, cancelled and disrupted outcomes fail |
| Generated business declarations | `node apps/spacebook/scripts/contracts.cjs --check` | Tool definitions, schemas, contribution interface and sample policy stay aligned |
| Official compatibility | `node runtime/cli.cjs verify --app apps/spacebook --output .artifacts/spacebook/common.json` | Public verifier runs a disposable package, standalone tests/example, real MCP and lifecycle checks |
| Independent compatibility | Run the preceding command using the unchanged base checkout's `runtime/cli.cjs` and an absolute App path | Exact base revision recorded in evidence; candidate runtime remains unmodified |
| Reference regression | `npm test` | Existing public reference suite remains green |
| Optional model usability | `node apps/spacebook/tests/agent-smoke.cjs` | Two fixed GPT-4.1 configurations, ordinary and outage replacement; hidden grading/Infra excluded from model inputs; all attempted runs retained |

The model adapter follows the [official Chat Completions tool contract](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create). Use an existing `OPENAI_API_KEY` and optional HTTPS `OPENAI_BASE_URL`; the script never records credentials. A conservative local request reservation stops the batch above US$30 at the configured reservation rates; this is not an invoice or a claim about current API prices. There is no model dependency at App run time.

No cross-App dependency is delivered, so destination delivery evidence is not applicable. Human realism, source/provenance, GUI usefulness and final implementation acceptance remain reviewer responsibilities.
