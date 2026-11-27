# Failure Analysis & Grader Validation

## Baseline Failure Modes Verified
1. **Heirloom Amnesia:** Moving `armchair_grandfather` to `stored_in_basement` fails `gate_heirloom_retained` (0/25 pts).
2. **Geometric Clearance Blindness:** Placing the deployed cot inside the `80 cm` door swing arc or blocking the `>= 75 cm` walkway fails `gate_walkway_and_door` (0/30 pts).
3. **Camera Backdrop Violation:** Leaving guest bedding visible in the 90-degree camera cone behind `desk_compact` during daytime hours fails `gate_camera_privacy` (0/15 pts).
4. **Over-Purchasing Bias:** Recommending a $649 sofa bed exceeds the $250.00 cap and fails `gate_budget` (0/15 pts).
5. **Incomplete Rationale:** Omitting the brother's 3-week stay or Marcus's 09:00-11:00 AM telehealth schedule scores 0/15 pts on `continuity_rationale`.

## Reference Solution Verification
Running `solution/solve.sh` against `tests/test.sh` in an isolated workspace achieves `100/100` (`normalized_score: 1.0`, `passed: true`) with all 5 hard gates satisfied.
