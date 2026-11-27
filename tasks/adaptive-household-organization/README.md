# Adaptive Household Organization (LifePack v1.0)

- **Task ID:** `adaptive-household-organization`
- **Proposal:** [adaptive-household-organization.md](../../proposals/task/adaptive-household-organization.md) (PR #30)
- **Domains:** Home & utilities (primary), Shopping & groceries (secondary)
- **Sessions / Span / Token Estimate:** 5 sessions over 38 simulated days (~20k-30k total tokens across dialogue, workspace reads, and tool outputs)
- **Execution Mode:** Standard filesystem workspace (`environment/workspace/`), no network required (`allow_internet = false`)

## Setup, Run, and Score

```bash
# 1. Run deterministic grader unit tests
python3 -m unittest tasks/adaptive-household-organization/tests/test_grader_unit.py -v

# 2. Run reference solution in an isolated temporary workspace and verify 100/100 score
TMP_WS=$(mktemp -d)
cp -r tasks/adaptive-household-organization/environment/workspace/* "$TMP_WS/"
WORKSPACE_DIR="$TMP_WS" bash tasks/adaptive-household-organization/solution/solve.sh
WORKSPACE_DIR="$TMP_WS" VERIFIER_OUTPUT_DIR="$TMP_WS/verifier" bash tasks/adaptive-household-organization/tests/test.sh
cat "$TMP_WS/verifier/reward.json"
```

## Tested Versions
- Python 3.11+ / 3.15 (zero required third-party dependencies in `test_outcomes.py`; `PyYAML` optional)
- Node.js v26.12.0 (for repository-wide PALE runtime tests)
