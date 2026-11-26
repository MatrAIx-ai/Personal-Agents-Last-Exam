# Reproducing Milepost from a clean checkout

For an independent reviewer. It takes a few minutes and needs Node.js 18 or newer and git; there is nothing to install, no account and no network access after cloning. Please note anything that differs from what is written here.

## 1. Check out

```sh
git clone https://github.com/LixinTu/Personal-Agents-Last-Exam.git
cd Personal-Agents-Last-Exam
git checkout practice-platform-proposal      # or the commit named in PR #70
git rev-parse HEAD && node --version         # record both
```

## 2. Run the checks

| Command | What you should see |
| --- | --- |
| `node --test apps/milepost/tests/business.test.cjs` | `ℹ tests 66` and `ℹ fail 0` |
| `node --test apps/milepost/tests/runtime.test.cjs` | `ℹ tests 11` and `ℹ fail 0` (the real runtime over MCP, including the four scenarios end to end) |
| `npm run app:verify -- --app apps/milepost --output .artifacts/milepost.json` | exit code 0; in the report, `"passed": true` and 45 checks with `"status": "passed"` |
| `node apps/milepost/scripts/build-fixtures.cjs --check` | `Full fixtures match their catalog and profiles.` |
| `node apps/milepost/scripts/build-scenarios.cjs --check` | `Scenario bundles match their scenario.json and fixtures.` |

The two `--check` commands rebuild the students and scenario bundles from their hand-written sources and compare byte for byte, so they also show that the committed data comes from the committed scripts.

## 3. Reproduce one scenario by hand

Scenario s3: Maya's cells exam moves three days earlier and she loses two evenings (see [`examples/scenarios/README.md`](../examples/scenarios/README.md)).

```sh
node apps/milepost/examples/scenarios/play.cjs s3-exam-moved base reference --out /tmp/milepost-s3
```

You should see each Infra step (`env.load_seed`, two `env.apply_event`, one `env.advance_time`) and each Agent call reported as `ready` or `committed`, then four `pass` lines and `s3-exam-moved/base reference: PASS`. The snapshot is in `/tmp/milepost-s3/snapshot.json`; grade it again on its own:

```sh
node apps/milepost/examples/scenarios/grade.cjs /tmp/milepost-s3/snapshot.json s3-exam-moved base; echo "exit $?"     # exit 0
```

Then check the twin: the base answer must fail it, and spreading one block over each short skill must fail the base.

```sh
node apps/milepost/examples/scenarios/play.cjs s3-exam-moved twin control-1; echo "exit $?"     # FAIL all_targets_reached, exit 1
node apps/milepost/examples/scenarios/play.cjs s3-exam-moved twin reference; echo "exit $?"     # PASS, exit 0
node apps/milepost/examples/scenarios/play.cjs s3-exam-moved base control-2; echo "exit $?"     # FAIL only_reached_targets and min_targets_reached, exit 1
```

## 4. What to report

The commit and Node.js version from step 1; for each command above, whether the output matched (paste it if not); and anything confusing in the documentation. Agent trials (`apps/milepost/trials/`) need a local model server and are not part of the reproduction.
