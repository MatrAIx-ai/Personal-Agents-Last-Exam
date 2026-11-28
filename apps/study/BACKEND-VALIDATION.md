# Expanded Study backend validation

This milestone uses the same public runtime 1.6.0 / Core 1.2.0 pinned at upstream commit `61b637164e4abddf81536bb48935cdb688a69ff1`, and extends the v1 commit `f5653d8a5a58edd22691ea60bcf82d70d63d1348`, without editing its approved proposal. Use a new synthetic run: the expanded seed schema adds card suspension, plan revision, notice, pause cursor and append-only undo fields; these proofs are not a migration of an existing v1 run.

```sh
npm test
export PALE_RUNTIME_ROOT=/absolute/path/to/PALE/runtime
node "$PALE_RUNTIME_ROOT/cli.cjs" verify --app "$PWD" --output /tmp/study-next-verification.json
node tests/core.cjs
node tests/full-core.cjs
node tests/host.cjs
```

Tools and return fields are declared in `tools.json`. The sandbox profile simulates an authorized learner/agent; the scenario fixture denies every write through Core. Both use the same App state for permitted reads. Only Infra can change virtual time, apply deadline/card corrections, snapshot and reset. All fixtures are synthetic. The `history-scenario.json` overlay is a second seed with two history rows; the independent Core test loads and resets it. No external data, model API or actual learner data is involved.

## Six scenarios

| Scenario | Expected state and control |
| --- | --- |
| Cards | Edit/create in a valid deck and suspend/restore without erasing history or changing due day; stale Core write or read-only scenario is denied, and suspended cards stay out of the queue. |
| Plan | Preview a selected-deck deadline and new limit, discard without writing, then explicitly save against the observed Core version. A stale save cannot overwrite the saved plan. |
| Study queue | Day-0 seeded due cards precede new cards. Pause/resume preserves a card cursor across Core reads. A paused card rejects reveal/rating. Only a supplied Again or Good is stored, once per effective card/day; elapsed days do not record ratings. |
| Undo | Undo only the latest effective review of the current day. Restore prior scheduling and a consumed slot, retain the original marked undone, and allow a new rating with a new ID. A duplicate request returns the old receipt and a fresh second undo of the same row is rejected. |
| Corrected card | Infra corrects the answer at a seeded time with a card revision check; preserve history and invalidate an already-open answer version. Repeated event IDs are deduplicated; stale revisions are rejected. |
| Target change and reset | An earlier deadline changes projection and emits a local notice, not the daily limits or review ledger. Reset restores the run's loaded clock and business fields. Historical seed evidence remains available in the separate fixture. |

Capacity estimates at most one next needed visit per card by the target (inclusive) with fixed daily and new-card limits. Already reviewed cards count only if due by the target; unseen cards count even when a release date makes the target impossible. The projection does not infer learner recall, simulate future ratings or certify mastery. Separate GUI tests are needed for controls and browser/Agent state parity.
