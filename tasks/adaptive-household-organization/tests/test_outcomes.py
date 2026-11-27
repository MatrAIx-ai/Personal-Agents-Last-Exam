#!/usr/bin/env python3
"""Deterministic LifePack v1.0 evaluator for adaptive-household-organization."""

import argparse
import json
import math
import os
import sys
from collections import deque
from pathlib import Path

try:
    import yaml
except ImportError:
    yaml = None


def load_json(path: Path) -> dict:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def load_rubrics_meta(path: Path) -> dict:
    if yaml is not None:
        with open(path, "r", encoding="utf-8") as f:
            return yaml.safe_load(f)
    meta = {"total_points": 100, "pass_threshold": 85}
    for line in path.read_text(encoding="utf-8").splitlines():
        for key in ("total_points", "pass_threshold"):
            if line.startswith(f"{key}:"):
                meta[key] = int(line.split(":", 1)[1].strip())
    return meta


def rect_to_poly(x0: float, y0: float, x1: float, y1: float) -> list[tuple[float, float]]:
    return [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]


def item_polygon(pos_cm: list[float], rot_deg: float, dims_cm: list[float]) -> list[tuple[float, float]]:
    """Convert [x, y], rotation_deg, and [L, W] into a 2D convex polygon."""
    x, y = float(pos_cm[0]), float(pos_cm[1])
    length, width = float(dims_cm[0]), float(dims_cm[1])
    norm = rot_deg % 360
    if math.isclose(norm, 0.0, abs_tol=1e-6) or math.isclose(norm, 180.0, abs_tol=1e-6):
        return rect_to_poly(x, y, x + length, y + width)
    if math.isclose(norm, 90.0, abs_tol=1e-6) or math.isclose(norm, 270.0, abs_tol=1e-6):
        return rect_to_poly(x, y, x + width, y + length)
    cx, cy = x + length / 2.0, y + width / 2.0
    rad = math.radians(rot_deg)
    cos_a, sin_a = math.cos(rad), math.sin(rad)
    corners = [(-length / 2.0, -width / 2.0), (length / 2.0, -width / 2.0),
               (length / 2.0, width / 2.0), (-length / 2.0, width / 2.0)]
    return [(cx + dx * cos_a - dy * sin_a, cy + dx * sin_a + dy * cos_a) for dx, dy in corners]


def _project(poly: list[tuple[float, float]], ax: float, ay: float) -> tuple[float, float]:
    dots = [p[0] * ax + p[1] * ay for p in poly]
    return min(dots), max(dots)


def polys_intersect(p1: list[tuple[float, float]], p2: list[tuple[float, float]], tol: float = 1e-6) -> bool:
    """Separating Axis Theorem (SAT) check for two convex polygons."""
    for poly in (p1, p2):
        n = len(poly)
        for i in range(n):
            x1, y1 = poly[i]
            x2, y2 = poly[(i + 1) % n]
            ax, ay = -(y2 - y1), (x2 - x1)
            length = math.hypot(ax, ay)
            if length < 1e-9:
                continue
            ax, ay = ax / length, ay / length
            min1, max1 = _project(p1, ax, ay)
            min2, max2 = _project(p2, ax, ay)
            if max1 <= min2 + tol or max2 <= min1 + tol:
                return False
    return True


def point_in_poly(px: float, py: float, poly: list[tuple[float, float]]) -> bool:
    inside = False
    n = len(poly)
    for i in range(n):
        x1, y1 = poly[i]
        x2, y2 = poly[(i + 1) % n]
        if (y1 > py) != (y2 > py):
            x_int = (x2 - x1) * (py - y1) / (y2 - y1 + 1e-12) + x1
            if px < x_int:
                inside = not inside
    return inside


def point_to_poly_dist(px: float, py: float, poly: list[tuple[float, float]]) -> float:
    if point_in_poly(px, py, poly):
        return 0.0
    best = float("inf")
    n = len(poly)
    for i in range(n):
        x1, y1 = poly[i]
        x2, y2 = poly[(i + 1) % n]
        vx, vy = x2 - x1, y2 - y1
        wx, wy = px - x1, py - y1
        seg_len_sq = vx * vx + vy * vy
        t = max(0.0, min(1.0, (wx * vx + wy * vy) / seg_len_sq)) if seg_len_sq > 0 else 0.0
        dx, dy = px - (x1 + t * vx), py - (y1 + t * vy)
        best = min(best, math.hypot(dx, dy))
    return best


def poly_in_bounds(poly: list[tuple[float, float]], w: float, h: float, tol: float = 1e-6) -> bool:
    return all(-tol <= x <= w + tol and -tol <= y <= h + tol for x, y in poly)


def check_door_swing(active_polys: dict[str, list[tuple[float, float]]], door_cfg: dict) -> list[str]:
    hx, hy = door_cfg["hinge_cm"]
    radius = door_cfg["swing_radius_cm"]
    ax0, ay0, ax1, ay1 = door_cfg["arc_bbox_cm"]
    arc_poly = rect_to_poly(ax0, ay0, ax1, ay1)
    errors = []
    for item_id, poly in active_polys.items():
        if not polys_intersect(poly, arc_poly):
            continue
        # Sample points in the quarter-circle swing arc to verify real arc collision
        step = 5.0
        x = ax0
        hit = False
        while x <= ax1 and not hit:
            y = ay0
            while y <= ay1:
                if math.hypot(x - hx, y - hy) <= radius - 1.0 and point_in_poly(x, y, poly):
                    hit = True
                    break
                y += step
            x += step
        if hit:
            errors.append(f"Item '{item_id}' obstructs door swing arc")
    return errors


def check_walkway_clearance(
    active_polys: dict[str, list[tuple[float, float]]],
    rules: dict,
    target_polys: dict[str, list[tuple[float, float]]],
) -> tuple[bool, str]:
    """Verify >= min_walkway_cm clearance path from door entrance to target item perimeters."""
    w = rules["room_bounds_cm"]["width"]
    h = rules["room_bounds_cm"]["height"]
    min_half = rules["min_walkway_cm"] / 2.0
    step = 5.0
    nx, ny = int(w // step) + 1, int(h // step) + 1

    obs_list = list(active_polys.values())

    def cell_clear(ix: int, iy: int) -> bool:
        cx, cy = ix * step, iy * step
        if cx < min_half - 1e-6 or cx > w - min_half + 1e-6:
            return False
        if cy < min_half - 1e-6 or cy > h - min_half + 1e-6:
            return False
        for poly in obs_list:
            if point_to_poly_dist(cx, cy, poly) < min_half - 1e-6:
                return False
        return True

    clear_grid = [[cell_clear(ix, iy) for iy in range(ny)] for ix in range(nx)]

    ex, ey = rules["door"]["entrance_point_cm"]
    sx, sy = int(round(ex / step)), int(round(ey / step))
    if not (0 <= sx < nx and 0 <= sy < ny and clear_grid[sx][sy]):
        return False, "Door entrance lacks >= 75cm walkway clearance"

    visited = {(sx, sy)}
    q = deque([(sx, sy)])
    while q:
        cx, cy = q.popleft()
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx_i, ny_i = cx + dx, cy + dy
            if 0 <= nx_i < nx and 0 <= ny_i < ny and (nx_i, ny_i) not in visited and clear_grid[nx_i][ny_i]:
                visited.add((nx_i, ny_i))
                q.append((nx_i, ny_i))

    # Each target item's perimeter must be reachable from the >= 75cm walkway
    for item_id, tpoly in target_polys.items():
        reachable = any(point_to_poly_dist(ix * step, iy * step, tpoly) <= min_half + 15.0 for ix, iy in visited)
        if not reachable:
            return False, f"No >= 75cm walkway reaches '{item_id}'"
    return True, "OK"


def poly_centroid(poly: list[tuple[float, float]]) -> tuple[float, float]:
    return sum(p[0] for p in poly) / len(poly), sum(p[1] for p in poly) / len(poly)


def poly_in_camera_frustum(
    poly: list[tuple[float, float]],
    origin: tuple[float, float],
    cam_dir: tuple[float, float],
    half_fov_deg: float,
) -> bool:
    cos_limit = math.cos(math.radians(half_fov_deg))
    ox, oy = origin
    xs = [p[0] for p in poly]
    ys = [p[1] for p in poly]
    # Sample bounding points + vertices
    samples = list(poly) + [poly_centroid(poly)]
    min_x, max_x, min_y, max_y = min(xs), max(xs), min(ys), max(ys)
    for gx in range(int(min_x), int(max_x) + 1, 15):
        for gy in range(int(min_y), int(max_y) + 1, 15):
            if point_in_poly(gx, gy, poly):
                samples.append((float(gx), float(gy)))
    for sx, sy in samples:
        vx, vy = sx - ox, sy - oy
        dist = math.hypot(vx, vy)
        if dist < 1e-6:
            continue
        dot = (vx / dist) * cam_dir[0] + (vy / dist) * cam_dir[1]
        if dot >= cos_limit - 1e-6:
            return True
    return False


def evaluate_proposal(workspace_dir: Path, tests_dir: Path) -> dict:
    rules = load_json(tests_dir / "rules.json")
    rubrics = load_rubrics_meta(tests_dir / "rubrics.yaml")
    proposal_path = workspace_dir / "layout_proposal.json"

    rationale_path = workspace_dir / "rationale.md"
    if not rationale_path.exists() and (workspace_dir.parent / "rationale.md").exists():
        rationale_path = workspace_dir.parent / "rationale.md"

    result = {
        "task_id": rules["task_id"],
        "scores": {
            "spatial_feasibility": 0,
            "heirloom_retention": 0,
            "call_privacy_backdrop": 0,
            "budget_compliance": 0,
            "continuity_rationale": 0,
        },
        "total_score": 0,
        "max_score": rubrics["total_points"],
        "normalized_score": 0.0,
        "hard_gates": {
            "gate_zero_collisions": False,
            "gate_walkway_and_door": False,
            "gate_heirloom_retained": False,
            "gate_camera_privacy": False,
            "gate_budget": False,
        },
        "passed": False,
        "diagnostics": [],
    }

    if not proposal_path.exists():
        result["diagnostics"].append("Missing workspace/layout_proposal.json")
        return result

    try:
        proposal = load_json(proposal_path)
    except Exception as exc:
        result["diagnostics"].append(f"Invalid JSON in layout_proposal.json: {exc}")
        return result

    room_w = rules["room_bounds_cm"]["width"]
    room_h = rules["room_bounds_cm"]["height"]
    dims_map = rules["item_dimensions_cm"]

    day_placements = proposal.get("daytime_mode", {}).get("placements", [])
    night_cfg = proposal.get("nighttime_mode", {})

    # Build daytime active polygons
    day_active: dict[str, list[tuple[float, float]]] = {}
    stowed_items: dict[str, list[tuple[float, float]]] = {}
    for fixed in rules["fixed_items"]:
        x0, y0, x1, y1 = fixed["bbox_cm"]
        day_active[fixed["item_id"]] = rect_to_poly(x0, y0, x1, y1)

    placement_by_id = {}
    spatial_errors = []

    for p in day_placements:
        item_id = p.get("item_id")
        action = p.get("action", "")
        placement_by_id[item_id] = p
        if item_id not in dims_map:
            spatial_errors.append(f"Unknown item_id '{item_id}'")
            continue
        if action in rules["forbidden_heirloom_actions"] and item_id == rules["heirloom_item_id"]:
            continue
        pos = p.get("position_cm")
        rot = float(p.get("rotation_deg", 0))
        if not isinstance(pos, list) or len(pos) != 2:
            spatial_errors.append(f"Invalid position_cm for '{item_id}'")
            continue
        if action == "stowed_in_closet":
            stowed_dims = dims_map.get(f"{item_id}_stowed", dims_map[item_id])
            poly = item_polygon(pos, rot, stowed_dims)
            cx0, cy0, cx1, cy1 = rules["closet_bbox_cm"]
            if not all(cx0 - 1e-6 <= x <= cx1 + 1e-6 and cy0 - 1e-6 <= y <= cy1 + 1e-6 for x, y in poly):
                spatial_errors.append(f"Stowed item '{item_id}' outside closet bounds")
            stowed_items[item_id] = poly
        else:
            poly = item_polygon(pos, rot, dims_map[item_id])
            if not poly_in_bounds(poly, room_w, room_h):
                spatial_errors.append(f"Item '{item_id}' exceeds room bounds in daytime_mode")
            day_active[item_id] = poly

    # Build nighttime active polygons (same non-stowed items + deployed cot)
    night_active = {k: v for k, v in day_active.items() if k != "guest_cot_foldable"}
    cot_pos = night_cfg.get("cot_deployed_position_cm")
    cot_rot = float(night_cfg.get("cot_deployed_rotation_deg", 0))
    if not isinstance(cot_pos, list) or len(cot_pos) != 2:
        spatial_errors.append("Missing or invalid nighttime_mode.cot_deployed_position_cm")
    else:
        cot_poly = item_polygon(cot_pos, cot_rot, dims_map["guest_cot_foldable"])
        if not poly_in_bounds(cot_poly, room_w, room_h):
            spatial_errors.append("Deployed cot exceeds room bounds in nighttime_mode")
        night_active["guest_cot_foldable"] = cot_poly

    # Check pairwise collisions + radiator clearance in both modes
    rx0, ry0, rx1, ry1 = rules["radiator_clearance_bbox_cm"]
    rad_poly = rect_to_poly(rx0, ry0, rx1, ry1)
    collision_errors = []
    for mode_name, active in (("daytime_mode", day_active), ("nighttime_mode", night_active)):
        ids = list(active.keys())
        for i in range(len(ids)):
            for j in range(i + 1, len(ids)):
                if polys_intersect(active[ids[i]], active[ids[j]]):
                    collision_errors.append(f"{mode_name}: '{ids[i]}' collides with '{ids[j]}'")
        for iid, poly in active.items():
            if polys_intersect(poly, rad_poly):
                collision_errors.append(f"{mode_name}: '{iid}' obstructs north window radiator")

    zero_collisions = (len(spatial_errors) == 0 and len(collision_errors) == 0)
    result["hard_gates"]["gate_zero_collisions"] = zero_collisions
    result["diagnostics"].extend(spatial_errors + collision_errors)

    # Door swing + walkway >= 75cm in both modes
    door_errors = []
    walkway_ok = True
    for mode_name, active in (("daytime_mode", day_active), ("nighttime_mode", night_active)):
        d_errs = check_door_swing(active, rules["door"])
        door_errors.extend([f"{mode_name}: {e}" for e in d_errs])
        targets = {k: active[k] for k in ("desk_compact", "armchair_grandfather") if k in active}
        if mode_name == "nighttime_mode" and "guest_cot_foldable" in active:
            targets["guest_cot_foldable"] = active["guest_cot_foldable"]
        w_ok, w_msg = check_walkway_clearance(active, rules, targets)
        if not w_ok:
            walkway_ok = False
            door_errors.append(f"{mode_name}: {w_msg}")

    walkway_and_door_ok = (len(door_errors) == 0 and walkway_ok)
    result["hard_gates"]["gate_walkway_and_door"] = walkway_and_door_ok
    result["diagnostics"].extend(door_errors)

    if zero_collisions and walkway_and_door_ok:
        result["scores"]["spatial_feasibility"] = 30

    # Gate 3: Heirloom retention
    heirloom_id = rules["heirloom_item_id"]
    hp = placement_by_id.get(heirloom_id)
    if hp and hp.get("action") in rules["allowed_heirloom_actions"] and heirloom_id in day_active:
        result["hard_gates"]["gate_heirloom_retained"] = True
        result["scores"]["heirloom_retention"] = 25
    else:
        result["diagnostics"].append("Heirloom armchair not retained in bedroom_2_multipurpose")

    # Gate 4: Call privacy & camera backdrop (daytime_mode)
    desk_p = placement_by_id.get("desk_compact")
    if desk_p and "desk_compact" in day_active:
        desk_center = poly_centroid(day_active["desk_compact"])
        desk_rot = float(desk_p.get("rotation_deg", 0))
        rad = math.radians(desk_rot)
        # At rotation_deg=0, desk faces +Y (north window), camera behind desk looks -Y (south Wall B)
        cam_dir = (math.sin(rad), -math.cos(rad))
        half_fov = rules["camera_frustum"]["fov_deg"] / 2.0
        req_bg = rules["camera_frustum"]["required_backdrop_item"]
        bg_visible = req_bg in day_active and poly_in_camera_frustum(day_active[req_bg], desk_center, cam_dir, half_fov)
        bed_visible = False
        for bad_id in rules["camera_frustum"]["forbidden_visible_items"]:
            if bad_id in day_active and poly_in_camera_frustum(day_active[bad_id], desk_center, cam_dir, half_fov):
                bed_visible = True
            if bad_id in stowed_items and poly_in_camera_frustum(stowed_items[bad_id], desk_center, cam_dir, half_fov):
                bed_visible = True
        if bg_visible and not bed_visible:
            result["hard_gates"]["gate_camera_privacy"] = True
            result["scores"]["call_privacy_backdrop"] = 15
        else:
            result["diagnostics"].append(
                f"Camera backdrop check failed (bookshelf_visible={bg_visible}, bed_visible={bed_visible})"
            )
    else:
        result["diagnostics"].append("desk_compact missing from daytime_mode placements")

    # Gate 5: Budget compliance
    purchases = proposal.get("purchases", [])
    total_spend = proposal.get("total_spend_usd")
    if isinstance(total_spend, (int, float)) and total_spend >= 0:
        item_sum = sum(float(x.get("cost_usd", 0)) for x in purchases if isinstance(x, dict))
        if total_spend <= rules["budget_cap_usd"] + 1e-6 and math.isclose(total_spend, item_sum, abs_tol=0.01):
            result["hard_gates"]["gate_budget"] = True
            result["scores"]["budget_compliance"] = 15
        else:
            result["diagnostics"].append(f"Budget violation or sum mismatch: total={total_spend}, sum={item_sum}")
    else:
        result["diagnostics"].append("Missing or invalid total_spend_usd")

    # Continuity & Rationale (15 pts)
    if rationale_path.exists():
        text = rationale_path.read_text(encoding="utf-8").lower()
        has_brother = ("brother" in text or "guest" in text or "visitor" in text) and ("3 week" in text or "three week" in text or "3-week" in text)
        has_partner = ("telehealth" in text or "call" in text or "marcus" in text or "partner" in text) and ("09:00" in text or "9:00" in text or "9-11" in text or "morning" in text)
        has_heirloom = "armchair" in text or "heirloom" in text or "grandfather" in text
        has_budget = "budget" in text or "250" in text or "120" in text
        has_tradeoff = "trade-off" in text or "tradeoff" in text or "daytime" in text or "nighttime" in text
        if has_brother and has_partner:
            pts = 6
            if has_heirloom:
                pts += 3
            if has_budget:
                pts += 3
            if has_tradeoff:
                pts += 3
            result["scores"]["continuity_rationale"] = pts
        else:
            result["diagnostics"].append("rationale.md missing visitor 3-week stay or partner call schedule explanation")
    else:
        result["diagnostics"].append("Missing rationale.md")

    total = sum(result["scores"].values())
    result["total_score"] = total
    result["normalized_score"] = round(total / float(result["max_score"]), 4)
    all_gates = all(result["hard_gates"].values())
    result["passed"] = (total >= rubrics["pass_threshold"]) and all_gates
    return result


def main() -> int:
    parser = argparse.ArgumentParser()
    default_task_dir = Path(__file__).resolve().parent.parent
    parser.add_argument("--workspace", type=Path, default=default_task_dir / "environment" / "workspace")
    parser.add_argument("--tests-dir", type=Path, default=default_task_dir / "tests")
    parser.add_argument("--output-dir", type=Path, default=Path("/logs/verifier"))
    args = parser.parse_args()

    res = evaluate_proposal(args.workspace, args.tests_dir)
    if args.output_dir:
        args.output_dir.mkdir(parents=True, exist_ok=True)
        (args.output_dir / "reward.json").write_text(json.dumps(res, indent=2) + "\n", encoding="utf-8")
        (args.output_dir / "reward.txt").write_text(("1\n" if res["passed"] else "0\n"), encoding="utf-8")

    print(json.dumps(res, indent=2))
    return 0 if res["passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
