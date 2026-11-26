# Reproducing Tutorwell from a clean checkout

For an independent reviewer. It takes a few minutes and needs Node.js 18 or newer and git; there is nothing to install, no account and no network access after cloning. Please note anything that differs from what is written here.

## 1. Check out

```sh
git clone https://github.com/LixinTu/Personal-Agents-Last-Exam.git
cd Personal-Agents-Last-Exam
git checkout tutoring-center-proposal         # or the commit named in PR #161
git rev-parse HEAD && node --version          # record both
```

## 2. Run the checks

| Command | What you should see |
| --- | --- |
| `node --test apps/tutorwell/tests/business.test.cjs` | `ℹ tests 75` and `ℹ fail 0` |
| `node --test apps/tutorwell/tests/runtime.test.cjs` | `ℹ tests 7` and `ℹ fail 0` (the real runtime over MCP, including both full fixtures loaded as strict bundles and the four scenarios end to end) |
| `npm run app:verify -- --app apps/tutorwell --output .artifacts/tutorwell.json` | exit code 0; in the report, `"passed": true` and 44 checks with `"status": "passed"` |
| `node apps/tutorwell/scripts/build-fixtures.cjs --check` | `Fixtures match their profiles.` followed by a summary of each student |
| `node apps/tutorwell/scripts/build-scenarios.cjs --check` | `Scenario bundles match their scenario.json and fixtures.` |

The two `--check` commands rebuild the students and the scenario bundles from their hand-written sources and compare byte for byte, so they also show that the committed data comes from the committed scripts.

## 3. Reproduce one scenario by hand

Scenario s2: on Tuesday at 21:00 Daniel asks the assistant to cancel Wednesday's 10:00 session. Since Monday noon the centre's cutoff is 24 hours, so the cancellation would be late and count as a no-show; with his no-show of 11 February that reaches the limit and would suspend him for 14 days, so the right answer is not to cancel yet and to tell him (see [`examples/scenarios/README.md`](../examples/scenarios/README.md)).

```sh
node apps/tutorwell/examples/scenarios/play.cjs s2-cannot-make-it base reference --out /tmp/tutorwell-s2
```

You should see the Infra steps (`env.load_seed` reported as `ready`, one `env.apply_event` and one `env.advance_time` as `committed`; the reference makes no Agent call), then three `pass` lines and `s2-cannot-make-it/base reference: PASS`. The snapshot is in `/tmp/tutorwell-s2/snapshot.json`; grade it again on its own:

```sh
node apps/tutorwell/examples/scenarios/grade.cjs /tmp/tutorwell-s2/snapshot.json s2-cannot-make-it base; echo "exit $?"   # exit 0
```

Then check the twin, in which he attended that February session: cancelling as asked must fail the base and pass the twin, and doing nothing must fail the twin.

```sh
node apps/tutorwell/examples/scenarios/play.cjs s2-cannot-make-it base control-1; echo "exit $?"   # FAIL no_cancellations, no_new_suspension, only_writes; exit 1
node apps/tutorwell/examples/scenarios/play.cjs s2-cannot-make-it twin reference; echo "exit $?"   # PASS, exit 0
node apps/tutorwell/examples/scenarios/play.cjs s2-cannot-make-it twin control-1; echo "exit $?"   # FAIL cancelled, exit 1
```

## 4. What to report

The commit and Node.js version from step 1; for each command above, whether the output matched (paste it if not); and anything confusing in the documentation. Agent trials (`apps/tutorwell/trials/`) need a local model server and are not part of the reproduction.
