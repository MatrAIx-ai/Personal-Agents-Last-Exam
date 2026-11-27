#!/usr/bin/env python3
"""Unit tests for the adaptive-household-organization deterministic grader."""

import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from test_outcomes import evaluate_proposal


TESTS_DIR = Path(__file__).resolve().parent
REF = json.loads((TESTS_DIR / "reference.json").read_text(encoding="utf-8"))["expected_layout_proposal"]

GOOD_RATIONALE = """# Household Layout Rationale

- **Dual-mode trade-offs:** Bedroom 2 serves as a daytime workspace and a nighttime guest room during the brother's 3-week stay.
- **Partner's telehealth schedule:** Marcus takes confidential client calls from 09:00-11:00 AM, so the compact desk faces the north window with the Wall B bookshelf as a clean backdrop and zero bedding in the 90-degree camera cone.
- **Heirloom retention:** Grandfather's mid-century leather armchair stays in the corner of Bedroom 2 rather than the damp basement locker.
- **Budget compliance:** Purchasing a $120.00 tri-fold guest mattress keeps total spend well under the $250.00 cap.
"""


class TestAdaptiveHouseholdGrader(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="pale-ah-test-"))

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _write_submission(self, proposal: dict | None, rationale: str | None = GOOD_RATIONALE):
        if proposal is not None:
            (self.tmp / "layout_proposal.json").write_text(json.dumps(proposal, indent=2), encoding="utf-8")
        if rationale is not None:
            (self.tmp / "rationale.md").write_text(rationale, encoding="utf-8")

    def test_reference_solution_passes_100(self):
        self._write_submission(REF)
        res = evaluate_proposal(self.tmp, TESTS_DIR)
        self.assertTrue(res["passed"], res)
        self.assertEqual(res["total_score"], 100)
        self.assertTrue(all(res["hard_gates"].values()))

    def test_doing_nothing_fails(self):
        res = evaluate_proposal(self.tmp, TESTS_DIR)
        self.assertFalse(res["passed"])
        self.assertEqual(res["total_score"], 0)

    def test_heirloom_in_basement_fails_gate(self):
        bad = json.loads(json.dumps(REF))
        bad["daytime_mode"]["placements"][0]["action"] = "stored_in_basement"
        self._write_submission(bad)
        res = evaluate_proposal(self.tmp, TESTS_DIR)
        self.assertFalse(res["passed"])
        self.assertFalse(res["hard_gates"]["gate_heirloom_retained"])
        self.assertEqual(res["scores"]["heirloom_retention"], 0)

    def test_door_swing_obstruction_fails_gate(self):
        bad = json.loads(json.dumps(REF))
        bad["nighttime_mode"]["cot_deployed_position_cm"] = [265, 20]
        bad["nighttime_mode"]["cot_deployed_rotation_deg"] = 90
        self._write_submission(bad)
        res = evaluate_proposal(self.tmp, TESTS_DIR)
        self.assertFalse(res["passed"])
        self.assertFalse(res["hard_gates"]["gate_walkway_and_door"])
        self.assertEqual(res["scores"]["spatial_feasibility"], 0)

    def test_over_budget_fails_gate(self):
        bad = json.loads(json.dumps(REF))
        bad["purchases"] = [{"item": "sofa bed", "cost_usd": 649.00}]
        bad["total_spend_usd"] = 649.00
        self._write_submission(bad)
        res = evaluate_proposal(self.tmp, TESTS_DIR)
        self.assertFalse(res["passed"])
        self.assertFalse(res["hard_gates"]["gate_budget"])
        self.assertEqual(res["scores"]["budget_compliance"], 0)

    def test_camera_backdrop_bed_visible_fails_gate(self):
        bad = json.loads(json.dumps(REF))
        # Put cot in daytime mode along Wall B (behind desk)
        bad["daytime_mode"]["placements"][2] = {
            "item_id": "guest_cot_foldable",
            "action": "relocated",
            "position_cm": [120, 40],
            "rotation_deg": 0,
        }
        self._write_submission(bad)
        res = evaluate_proposal(self.tmp, TESTS_DIR)
        self.assertFalse(res["passed"])
        self.assertFalse(res["hard_gates"]["gate_camera_privacy"])
        self.assertEqual(res["scores"]["call_privacy_backdrop"], 0)

    def test_missing_routine_in_rationale_zero_pts(self):
        self._write_submission(REF, rationale="We bought a mattress for the room.")
        res = evaluate_proposal(self.tmp, TESTS_DIR)
        self.assertEqual(res["scores"]["continuity_rationale"], 0)
        self.assertEqual(res["total_score"], 85)


if __name__ == "__main__":
    unittest.main()
