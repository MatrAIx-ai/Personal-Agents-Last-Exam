# NYC 311 Watch implementation review

Review the App against the [approved proposal](../../proposals/environment/nyc311-watch.md)
and [observation follow-up](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/268#issuecomment-7225789043).
The App is standalone; no sibling App, external delivery, or live city
backend is used. The shared runtime supplies the Web Host and Core.

## Reference and implementation

[NYC311 status documentation](https://portal.311.nyc.gov/article/?kanumber=KA-01066)
and [NYC311 lookup](https://portal.311.nyc.gov/check-status/) describe the
public confirmation-number/status workflow. The benchmark uses local IDs
and displays only clock-supported agency and case status. The public
reference does not document this sandbox's watch preference and local
reminder views. Those views are original scoped simulations; no account
login, production screenshots with private records, city notification or
real complaint submission is included. See the PR's review attachment for
ordered Chromium frames and reference evidence.

| Workflow | Chromium frames | Separate readback |
| --- | --- | --- |
| Lookup / filters / no match | 01–03 | Only created cases, absent ID empty, unknown sentinel exposes no future fields |
| Observe and manage a private watch | 04–07, 11–12 | Preview/discard does not write; save and edit update choices; stale confirm does not overwrite; remove retains activity |
| Apply irrelevant change and closure | 08–09 | Agency changes to DEP with no reminder; closure and replay leave one resolved reminder |
| Acknowledge, reload and reset | 10, 13 | Acknowledgment persists across a browser reload; reset clears it and restores the early clock and baseline |
| Pre-observation event and authority denials | 03, Core trace | Rejected open-to-closed event rolls back clock/business state; no Agent lifecycle operations |
| Full evaluation history | Core trace and [dataset](data/README.md) | Load, source/count/hash checks, status before and after observation, reset |

## Reproduce

See [README](README.md). The public validator, independent stdio Core trace,
and Chromium run exercise the same App package. No hosted deployment is
required. The browser action sequence and assertion code are in
[tests/browser.cjs](tests/browser.cjs); data capture and validation are
documented independently of the smoke seed. The public Core fixture is
2025-01-01 to 2026-12-31, 368 source records and 18 labeled synthetic gaps.
