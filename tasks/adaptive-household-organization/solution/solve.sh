#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TASK_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
WORKSPACE_DIR="${WORKSPACE_DIR:-${TASK_DIR}/environment/workspace}"

mkdir -p "${WORKSPACE_DIR}"

cat > "${WORKSPACE_DIR}/layout_proposal.json" <<'EOF'
{
  "room_id": "bedroom_2_multipurpose",
  "daytime_mode": {
    "placements": [
      {
        "item_id": "armchair_grandfather",
        "action": "retained",
        "position_cm": [0, 15],
        "rotation_deg": 0
      },
      {
        "item_id": "desk_compact",
        "action": "relocated",
        "position_cm": [55, 205],
        "rotation_deg": 0
      },
      {
        "item_id": "guest_cot_foldable",
        "action": "stowed_in_closet",
        "position_cm": [280, 240],
        "rotation_deg": 0
      }
    ]
  },
  "nighttime_mode": {
    "cot_deployed_position_cm": [205, 110],
    "cot_deployed_rotation_deg": 90
  },
  "purchases": [
    {
      "item": "tri-fold guest floor mattress",
      "cost_usd": 120.0
    }
  ],
  "total_spend_usd": 120.0
}
EOF

cat > "${WORKSPACE_DIR}/rationale.md" <<'EOF'
# Adaptive Household Layout Rationale

## Summary of Trade-Offs
To support both daily remote work and a 3-week stay for the user's brother inside the 350 cm x 300 cm `bedroom_2_multipurpose` room without exceeding the $250.00 budget, we use a dual-mode (daytime / nighttime) arrangement rather than a permanent sofa bed.

## Key Constraints Addressed
1. **Heirloom Retention:** Grandfather's mid-century leather armchair (95 cm x 90 cm) is retained in the south-west corner `[0, 15]` of `bedroom_2_multipurpose`, avoiding the damp basement locker B-14.
2. **Partner's Telehealth Schedule & Camera Privacy:** Marcus takes confidential telehealth client calls between 09:00-11:00 AM. The compact birch desk is placed at `[55, 205]` facing the north window (glare-free light, >= 15 cm clear of the window radiator). Behind the desk, the 90-degree camera cone frames the solid oak bookshelf on Wall B (`[100, 0]` to `[250, 32]`), while the tri-fold guest mattress is stowed in the north-east closet (`[280, 240]`), keeping all bedding out of frame.
3. **3-Week Guest Accommodation & Clearances:** At night, the tri-fold guest mattress (190 cm x 80 cm) deploys at `[205, 110]` rotated 90 degrees (`x: 205..285, y: 110..300`). This preserves an unobstructed 80 cm door swing arc (`x: 270..350, y: 10..90`), >= 75 cm walkway clearance to all zones, and a direct emergency exit path to the door.
4. **Budget Compliance:** Purchasing only a $120.00 tri-fold guest floor mattress keeps total spend at $120.00 USD, well within the $250.00 cap.
EOF
