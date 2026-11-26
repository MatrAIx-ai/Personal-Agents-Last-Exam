# Reproducing Second Draft from a clean checkout

For an independent reviewer. It takes a few minutes and needs Node.js 18 or newer and git; there is nothing to install, no account and no network access after cloning. Please note anything that differs from what is written here.

## 1. Check out

```sh
git clone https://github.com/LixinTu/Personal-Agents-Last-Exam.git
cd Personal-Agents-Last-Exam
git checkout writing-revision-proposal       # or the commit named in PR #160
git rev-parse HEAD && node --version         # record both
```

## 2. Run the checks

| Command | What you should see |
| --- | --- |
| `node --test apps/second-draft/tests/business.test.cjs` | `ℹ tests 39` and `ℹ fail 0` |
| `node --test apps/second-draft/tests/runtime.test.cjs` | `ℹ tests 7` and `ℹ fail 0` (the real runtime over MCP, including both full fixtures loaded as strict bundles and the four scenarios end to end) |
| `npm run app:verify -- --app apps/second-draft --output .artifacts/second-draft.json` | exit code 0; in the report, `"passed": true` and 49 checks with `"status": "passed"` |
| `node apps/second-draft/scripts/build-fixtures.cjs --check` | `Fixtures match their profiles.` |
| `node apps/second-draft/scripts/build-scenarios.cjs --check` | `Scenario bundles match their scenario.json and fixtures.` |

The two `--check` commands rebuild the students and the scenario bundles from their hand-written sources and compare byte for byte, so they also show that the committed data comes from the committed scripts.

## 3. Reproduce one scenario by hand

Scenario s2: Marcus says he addressed every comment and asks the assistant to mark them all, but two of the five open comments sit on paragraphs his new version did not change (see [`examples/scenarios/README.md`](../examples/scenarios/README.md)).

```sh
node apps/second-draft/examples/scenarios/play.cjs s2-addressed-everything base reference --out /tmp/second-draft-s2
```

You should see each Infra step (`env.load_seed`, four `env.apply_event`, one `env.advance_time`) and each Agent call reported as `ready` or `committed`, then four `pass` lines and `s2-addressed-everything/base reference: PASS`. The snapshot is in `/tmp/second-draft-s2/snapshot.json`; grade it again on its own:

```sh
node apps/second-draft/examples/scenarios/grade.cjs /tmp/second-draft-s2/snapshot.json s2-addressed-everything base; echo "exit $?"   # exit 0
```

Then check the twin: the base answer must fail it, and marking all five comments, as Marcus asked, must fail the base.

```sh
node apps/second-draft/examples/scenarios/play.cjs s2-addressed-everything twin control-1; echo "exit $?"   # FAIL addressed_exactly, exit 1
node apps/second-draft/examples/scenarios/play.cjs s2-addressed-everything twin reference; echo "exit $?"   # PASS, exit 0
node apps/second-draft/examples/scenarios/play.cjs s2-addressed-everything base control-2; echo "exit $?"   # FAIL addressed_exactly, exit 1
```

## 4. What to report

The commit and Node.js version from step 1; for each command above, whether the output matched (paste it if not); and anything confusing in the documentation. Agent trials (`apps/second-draft/trials/`) need a local model server or a signed-in agent CLI and are not part of the reproduction.
