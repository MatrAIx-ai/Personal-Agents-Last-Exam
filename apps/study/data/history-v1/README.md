# Language Study Workspace (#51): 2025–26 history pack v1.0.0

This opt-in data pack was [approved as a distinct scope item](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/51#issuecomment-7230888933) for inclusion with the App in PR #51. It does not change the approved proposal, business implementation, default/smoke fixtures, or public tool contract. It uses no personal account data, external content, new dependencies, or network service. Original data and scripts are [MIT-licensed](LICENSE).

## Scope and evidence

- `scope.json`: reviewed App code revision and the decision approving this data pack for inclusion.
- `generated/load-seed.json`: arguments for public Infra `env.load_seed` (add `expected_version` and a retry-stable `request_id`). Includes the identity binding and a versioned PALE dataset manifest, with authored-synthetic provenance. The fixture's readback clock is after the complete history.
- `generated/activity.jsonl`: ascending activity records with logical timestamp, civil date, source, operation and referenced IDs. These are generated events, not product logs or paper dates.
- `generated/coverage.json`: all 24 months, source and activity-type counts, active days, first/last dates and SHA-256 values for the ledger and load payload. Unlisted dates have no generated activity. All activity is synthetic.

The generator runs the actual Study queue and ratings in the sandbox profile. It releases authored English–Spanish cards over time, varies weekday/weekend practice and includes missed sessions and Again ratings. The App's existing 1/1/3/7-day stage ladder sets the due date, so later actual practice may fall after a due date. This is not an Anki or FSRS trace or a scheduler modification. The public Core check reads the full existing study.get_history response, compares it with the dated ledger, and checks the next due queue. Card text, learner identity, ratings and timestamps are synthetic.

## Verify the shipped bytes

With Node 18+ and public PALE Runtime 1.6.0 / Core API 1.2.0, run from the root of the checkout containing this file. The reviewed App code revision in `scope.json` is the browser-evidence baseline; check the final combined revision with `git rev-parse HEAD`.

```sh
# PALE_RUNTIME_ROOT is optional if <checkout>/runtime exists.
PALE_RUNTIME_ROOT=/absolute/path/to/pale/runtime node apps/study/data/history-v1/check.cjs "$PWD"
```

The checker uses a disposable state directory and separate public Infra and Agent MCP clients. It checks coverage and hashes, validates and loads the supplied bundle, queries business records as Agent, verifies that Infra snapshot is denied to Agent, then checks reset against the loaded snapshot. The smoke fixture is untouched. The replay and readback were tested against PALE runtime 1.6.0 / Core API 1.2.0.

To independently replay and compare the generated artifacts:

```sh
mkdir -p /tmp/pale-history-replay
PALE_RUNTIME_ROOT=/absolute/path/to/pale/runtime node apps/study/data/history-v1/generate.cjs "$PWD" /tmp/pale-history-replay
diff -r apps/study/data/history-v1/generated /tmp/pale-history-replay
```

Run the final-snapshot examples only after its indicated readback clock. For a task inside the history window a separate as-of seed is needed; do not load this final snapshot at an earlier clock.
