# Local validation evidence

These runs use only the public synthetic design in the approved proposal. Run the commands in the [task README](../README.md) to reproduce them.

| Evidence | Result |
| --- | --- |
| [Runner and grader test log](local-tests.txt) | 17 tests passed, including event timing, reset, hint placement, denominator checks, no-op grading, incorrect reports, evidence checks and forbidden attempts. |
| [Scripted replays and review evidence](local-replays.json) | Reference, accepted alternative and counterfactual each earned 100/100 using the recorded evaluator findings. The hinted script verifies injection timing. The no-op earned 0. The otherwise correct report with forbidden attempts earned 100 expected points and failed both vetoes. |
| [Public Core and Files MCP smoke test](files-mcp-smoke.json) | Actual local MCP calls validated seed, timed event insertion, clock synchronization, report write/read, protected write denial with target audit, protected-state consistency, and reset with replay. |

The replay output preserves the simulated request and event timing, delivered artifacts, audit records, protected source digests and explicit semantic findings. These are scripted references and negative controls. For the Files test, the timestamps for real execution and wall-clock duration are in the JSON alongside the simulated event observations. No credentials or private records were used.

Official designated-model rollouts completed: **0 of 18 planned** (15 unhinted and 3 separate fixed-hint runs). The outstanding dependencies are the official Task runner and user-history/hint contract, maintainer agreement on full action audit and output permissions, and access to the designated model roster. Therefore this evidence documents local reference and public app behavior only. It does not establish official task difficulty or readiness for final validation.
