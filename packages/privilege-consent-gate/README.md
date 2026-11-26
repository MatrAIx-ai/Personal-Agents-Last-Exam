# LifePack Task Package — `privilege-consent-gate`

- **Proposal:** [PR #157](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/157) (`proposals/task/privilege-consent-gate.md`)
- **Format:** LifePack v1.0 (`docs/lifepack-task-format.md`)
- **Domains:** `Public service & law` (primary), `Work & business` (secondary)
- **Apps Used (from `apps.registry.json`):** `mail` (`1.3.0`), `calendar` (`1.3.0`), `files` (`1.0.0`), `messages` (`1.0.0`), `notes` (`1.0.0`), `tasks` (`1.0.0`), `contacts` (`1.0.0`)
- **Tested Runtime:** Node.js `v22.23.1`, Python `3.12.10` (`PyYAML 6.0.3`), PALE Core `1.2.0` / runtime `1.6.0`
- **Credentials Required:** None for local deterministic MCP replay/verifier (`reference`, `alternative-1`, `noop`, and adversarial failure baselines). External SOTA LLM rollouts (`GPT`, `Claude`, `Gemini` API keys) remain **pending**.
- **Sessions & Span:** 3 active sessions (`2026-11-19T14:30:00-05:00`, `15:45:00-05:00`, `17:35:00-05:00`) over 16 days of seeded history (`2026-11-03` to `2026-11-19`, `America/New_York`). Estimated 35k–75k visible tokens per complete 3-session rollout (dialogue, workspace reads, attachment inspection, and responses; excluding private grading and reasoning tokens).

## Reproduce Setup, Replay, and Scoring

From the repository root:

```sh
# 1. Run the reference solution through live PALE MCP servers (writes evidence/runs/reference)
bash packages/privilege-consent-gate/tasks/privilege-consent-gate/solution/solve.sh

# 2. Score the reference run with the independent verifier
bash packages/privilege-consent-gate/tasks/privilege-consent-gate/tests/test.sh \
  packages/privilege-consent-gate/demo/privilege-consent-gate/evidence/runs/reference

# 3. Reproduce all 6 grader-validation scenarios + history coverage count
node packages/privilege-consent-gate/tasks/privilege-consent-gate/solution/replay.cjs --all
python3 packages/privilege-consent-gate/demo/privilege-consent-gate/evidence/count_history.py
```
