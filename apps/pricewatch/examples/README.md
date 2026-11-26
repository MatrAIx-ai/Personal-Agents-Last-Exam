# Reproduce the PriceWatch examples

`npm run example` runs the package-only business walkthrough in `run.cjs`. It uses real App handlers and the local schema-validating business harness, without importing Core, a network service, or another App. It does not prove Core permissions, persistence, or transport idempotency.

The additional integration drivers use separate, real Agent and Infra stdio MCP processes from the public runtime. Supply the public runtime explicitly; the App itself has no such import or hard-coded checkout path:

```sh
PALE_RUNTIME_ROOT=/absolute/path/to/pinned/runtime node tests/runtime-integration.cjs /absolute/path/to/runtime-report.json
```

The optional Notes assembly additionally requires the actual public Notes 1.0.0 package:

```sh
PALE_RUNTIME_ROOT=/absolute/path/to/pinned/runtime PALE_NOTES_APP=/absolute/path/to/notes node tests/notes-integration.cjs /absolute/path/to/notes-report.json
```

Run these from the PriceWatch package directory. Each driver copies exact packages into a disposable temporary registry and removes temporary live state on completion. The report preserves calls, results, versions, snapshots, assertions, hashes of the copied package files, and hashes of the runtime contracts used. Notes contents are verified against the actual receiving record but redacted from the combined trace; PriceWatch's neutral calls and state remain inspectable. An integration report is separate from a model-agent evaluation or maintainer acceptance.

`scenario.json` is one valid incoming quote event for the common verifier. It is data, not a scheduler, and must be injected by Infra at its stated virtual time. `fixtures/event-cases.json` contains additional independent inputs. A genuine Task supplies its own starting history and event schedule.
