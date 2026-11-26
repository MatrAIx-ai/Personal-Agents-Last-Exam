# LifePack Task Package — `scoped-correction-notice`

- **Proposal:** [PR #158](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/158) (`proposals/task/scoped-correction-notice.md`)
- **Format:** LifePack v1.0 (`docs/lifepack-task-format.md`)
- **Domains:** `News & information` (primary), `Work & business` (secondary)
- **Apps Used (from `apps.registry.json`):** `mail` (`1.3.0`), `messages` (`1.0.0`), `notes` (`1.0.0`), `contacts` (`1.0.0`)
- **Tested Runtime:** Node.js `v22.23.1`, Python `3.12.10` (`PyYAML 6.0.3`), PALE Core `1.2.0` / runtime `1.6.0`
- **Credentials Required:** None for local deterministic MCP replay/verifier (`reference`, `alternative-1`, `noop`, and adversarial failure baselines). External SOTA LLM rollouts (`GPT`, `Claude`, `Gemini` API keys) remain **pending**.
- **Sessions & Span:** 3 active sessions (`2026-11-18T09:15:00-05:00`, `10:05:00-05:00`, `11:30:00-05:00`) over 16 days of seeded history (`2026-11-02` to `2026-11-18`, `America/New_York`). Estimated 30k–65k visible tokens per complete 3-session rollout.

## Reproduce Setup, Replay, and Scoring

From the repository root:

```sh
# 1. Run the reference solution through live PALE MCP servers (writes evidence/runs/reference)
bash packages/scoped-correction-notice/tasks/scoped-correction-notice/solution/solve.sh

# 2. Score the reference run with the independent verifier
bash packages/scoped-correction-notice/tasks/scoped-correction-notice/tests/test.sh \
  packages/scoped-correction-notice/demo/scoped-correction-notice/evidence/runs/reference

# 3. Reproduce all 7 grader-validation scenarios + history coverage count
node packages/scoped-correction-notice/tasks/scoped-correction-notice/solution/replay.cjs --all
python3 packages/scoped-correction-notice/demo/scoped-correction-notice/evidence/count_history.py
```
