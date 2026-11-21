# Task Track proposal

**Proposed PR title:** `[Task Proposal] [Home & utilities + Shopping & groceries] Adapt a home as household needs change`

## 1. Task and domains

- **Authors / GitHub handles:** Nassim (@nassimberrada)
- **Short task title:** Adapt a home as household needs change
- **Primary domain:** Home & utilities
- **Secondary domains:** Shopping & groceries

## 2. User persona and prior history

The user is a fictional adult living in a rented two-bedroom apartment. They work from home several days a week and share the space with a partner. They enjoy cooking, reading and having friends over, but dislike clutter and unnecessary purchases.

The agent has access to a growing record of the household: room photos, a floor plan, furniture dimensions, storage locations, possessions, routines, budget and prior decisions. Some possessions have personal value and should not be treated as disposable. The user prefers to reuse or rearrange existing items before buying new ones.

The household context is incomplete at the start. The agent must learn relevant details through conversation and retain them across sessions.

## 3. Story outline

Over approximately six simulated weeks, the user's household needs change. The user begins working from home more often and needs a dedicated workspace. Later, a family member is expected to stay for several weeks, creating a need for a guest sleeping area. The user also wants to preserve space for cooking, reading and social visits.

Across several sessions, the user asks the agent to help adapt the apartment. The agent must interpret room photos, understand furniture dimensions and spatial constraints, and propose feasible layouts. It should consider moving, repurposing, storing or buying items, while respecting the household's routines, preferences and budget.

The agent should not assume that every request requires a purchase or that the room with the most free space is automatically the best choice. It should explain trade-offs, ask for missing information when needed, and update its understanding when the user corrects it.

A good outcome is a practical, coherent home arrangement that accommodates the new needs without undermining what matters to the household. The final plan should include room layouts, furniture placement, storage changes and any justified purchases, with clear reasons for each decision.

## 4. What makes this distinct and personal

### 4.1 Personal Context & Dispersal

The household context is distributed across several dated records and multimodal artifacts:

- **Floor plan & photos (`workspace/floorplan.png`, `workspace/photos/`):** Capture architectural boundaries, door swings, window light, and wall outlet placements.
- **Inventory ledger (`workspace/inventory.json`):** Records object dimensions ($L \times W \times H$), weight, and physical condition.
- **Personal history & notes (`workspace/notes/`):** Contains dated notes on household routines, partner work schedules, sentimental heirlooms, and past layout attempts.
- **Interactive dialogue:** Discloses emerging changes (e.g., guest arrival, new remote work mandates) over a 6-week timeline across 5 distinct sessions.

While casual users rarely keep a CAD database of their home, this scenario reflects a realistic digital footprint: floor plans extracted from lease documents, furniture dimensions retrieved from digital purchase receipts, and personal constraints scattered across personal notes and chat history. The personal agent's key role is cross-referencing these fragmented sources to solve a physical space constraint.

### 4.2 Decisive Personalization Moment (Counterfactual Test)

- **The Request (Session 4, Week 5):** The user announces their brother is visiting for 3 weeks, requiring a guest sleeping setup and a daytime workspace in the 3.5m × 3.0m second room, with a strict budget cap of $250.
- **Dated Historical Anchor:** `workspace/notes/move_in_notes_2026_09_15.md` states:
  > *"Grandfather’s mid-century leather armchair (95cm x 90cm) is irreplaceable. The basement locker has moisture leaks, so it must stay in the living areas. Do not sell or store in basement."*
  Additionally, `workspace/notes/partner_schedule.md` (dated Oct 2, 2026) notes:
  > *"Partner takes confidential telehealth client calls between 09:00–11:00 AM; requires a clean, non-bedroom background behind the desk."*
- **Layout Outcome for Profile A (This User):**
  The agent cannot place a full fold-out sofa bed along the main wall because keeping the bulky grandfather armchair in the room requires that clearance. The desk must face the window with Wall B (bookshelf) as the camera backdrop. The agent chooses a narrow folding guest cot stored in the closet during the day, keeping the armchair in the corner nook.
- **Counterfactual Profile B (Identical room, identical furniture, identical request):**
  A generic user without the heirloom constraint and without video-call backdrop requirements. For Profile B, the armchair is moved to the basement storage locker, and a permanent dual-sleeper sofa bed is unfolded along Wall B. 
  *A generic model without personalization will treat the armchair as disposable clutter or put the bed directly behind the camera backdrop, failing the household's core constraints.*

### 4.3 Baseline Model Failure Mode (Unhinted Gate)

In blind unhinted runs, frontier LLMs consistently fail for three reasons:
1. **Geometric clearance blindness:** Placing desks or beds blocking door swings (requires $\ge 80\text{ cm}$ arc) or obstructing window radiators.
2. **Context amnesia regarding sentiment:** Moving grandfather's armchair to damp basement storage or recommending selling it.
3. **Over-purchasing bias:** Defaulting to recommending new modular furniture purchases ($600+) instead of repurposing existing items, violating the $250 budget limit.

### 4.4 Solvability & Hint Justification

When the model is explicitly reminded of the dated notes via the standardized hint, it is fully capable of solving the 2D packing constraint and respecting the user's non-negotiables, achieving a 100% pass rate.

---

## 5. Rubrics, reference and hints

### 5.1 Grader Inputs and Submission Format

The agent does not submit arbitrary free-form text. At the end of Session 5, the agent writes its final proposal to `workspace/layout_proposal.json` alongside a `rationale.md`.

```json
{
  "room_id": "bedroom_2_multipurpose",
  "placements": [
    {
      "item_id": "armchair_grandfather",
      "action": "retained",
      "position_cm": [40, 45],
      "rotation_deg": 45
    },
    {
      "item_id": "desk_compact",
      "action": "relocated",
      "position_cm": [120, 240],
      "rotation_deg": 0
    }
  ],
  "purchases": [
    {
      "item": "tri-fold guest floor mattress",
      "cost_usd": 120.00
    }
  ],
  "total_spend_usd": 120.00
}
```

### 5.2 Deterministic Rubric & Scoring Breakdown (Total: 100 Points)

| Metric | Max Points | Evaluation Method | Failure Condition |
| :--- | :---: | :--- | :--- |
| **Spatial Feasibility & Clearance** | 30 | Automated bounding-box 2D collision check: $\ge 75\text{ cm}$ walkway width, unobstructed door swing arc, access to outlets. | Any collision or walkway $< 60\text{ cm}$ = 0 pts. |
| **Heirloom & Constraint Retention** | 25 | Automated check on `workspace/layout_proposal.json`: grandfather armchair is neither discarded nor placed in basement storage. | Armchair removed or stored in basement = 0 pts. |
| **Call Privacy & Camera Backdrop** | 15 | Vector orientation check: desk seating direction does not have the guest bed in the rear viewing angle. | Bed visible behind desk view vector = 0 pts. |
| **Budget Compliance** | 15 | `total_spend_usd` $\le \$250.00$. | Spend $> \$250.00$ = 0 pts. |
| **Continuity & Rationale** | 15 | Rubric evaluation of `rationale.md` confirming trade-offs and explicit mention of partner's call schedule and brother's visit duration. | Omits explanation of visitor accommodation = 0 pts. |

**Full-Pass Rule:** A run passes if and only if:
- Total score $\ge 85/100$, **AND**
- Hard Gates passed: 0 spatial bounding box collisions, budget $\le \$250.00$, grandfather armchair retained safely.

The evaluation does not perform an exact-coordinate match against a single reference layout. Instead, it uses property-based validation: an automated script verifies that the agent's proposed layout_proposal.json satisfies all spatial invariants (no bounding-box collisions, unobstructed door swings, ≥75cm pathways), respects personal hard constraints (armchair retention, camera backdrop isolation), and stays within budget. Multiple distinct layouts are valid as long as they satisfy these invariants.

### 5.3 Reference Timeline (5 Sessions)

- **Session 1 (Day 1):** User orientation, space audit, agent reviews `floorplan.png` and `inventory.json`.
- **Session 2 (Day 8):** Hybrid work setup discussion. User reports monitor glare in bedroom 1. Agent suggests shifting desk to bedroom 2.
- **Session 3 (Day 20):** Dinner hosting preparation. Checking living room chair configuration.
- **Session 4 (Day 32 - Critical Gate):** Brother's impending 3-week visit announced. Desk + guest bed dilemma introduced.
- **Session 5 (Day 38):** Review of user revisions, final layout proposal generated and committed to `workspace/layout_proposal.json`.

### 5.4 Exact Standard Hint & Injection Point

- **Injection Point:** Turn 1 of Session 4 (when the user requests the multi-purpose layout for the visiting brother).
- **Exact Hint Text:**
  > `[SYSTEM HINT: Review 'workspace/notes/move_in_notes_2026_09_15.md' regarding heirloom furniture restrictions and 'workspace/notes/partner_schedule.md' regarding video call framing before proposing furniture rearrangements. Keep total purchases strictly below $250.]`

---

## 6. Construction plan and effort

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| :--- | :--- | :--- | :--- |
| Persona, history and workspace | Build apartment profile, 2D floor plan image, furniture dimension inventory (`inventory.json`), dated context notes (`notes/*.md`). | Verified inventory dimensions matching floor plan clearances; consistent mock timestamps. | 2 |
| User rollout and scenario script | 5 sessions, 6-week span. Estimated token footprint: 20k–30k tokens. Multi-turn dialogue scripts with branching feedback. | Executable YAML/Python rollout script simulating user replies and corrections. | 2 |
| Environment integration | Standard Filesystem / Workspace tool. No custom server or API required. Preloaded `workspace/` directory with static images and text files. | Agent interacts via standard file-read and file-write tools; deterministic validation harness. | 2 |
| Rubrics, reference and hints | Python geometric collision evaluator for `layout_proposal.json`; rule-based checks for budget and inventory tags; exact hint injection. | Deterministic scoring script outputting normalized score $[0, 100]$ and binary pass/fail flags. | 2 |
| Agent rollouts and validation | Baseline unhinted rollouts across designated GPT, Claude, and Gemini models. Hinted validation verifying 100% pass rate. | Execution traces, failure logs, and scorecards formatted to repository standards. | 3 |

**Milestones, owners and dependencies**

1. **Scenario design:** proposal author defines the household, apartment, visual assets and multi-session story. Estimated 2–3 working days.
2. **Environment and script:** implement the household workspace, tool interfaces, initial state and user rollout. Estimated 3–4 working days.
3. **Grading and reference:** implement the rubric, success gates, reference solution and hint. Estimated 2 working days.
4. **Validation:** run the designated models, analyze failures and revise if needed. Estimated 2–3 working days, excluding time waiting for infrastructure or model access.

The author will coordinate the work. Additional contributors and environment dependencies are TBD, subject to maintainer review.

**Resources and total effort**

Estimated development effort: **11–15 person-days**.

Model/API costs and image-generation costs are TBD until the evaluation roster, model pricing and asset-generation approach are confirmed. The scenario will use a small set of synthetic or openly licensed visual assets to keep costs and setup manageable. Compute needs should be limited to the task environment and designated model access.

**Scope boundary and open questions**

In scope: one apartment, one household, multiple rooms, a fixed inventory of furniture and possessions, photo and floor-plan interpretation, layout proposals, storage decisions and limited purchase recommendations.

Out of scope: professional architectural design, structural renovations, electrical or plumbing work, real-time 3D reconstruction, automatic control of smart-home devices and actual purchasing or booking.

Open questions:
- Which existing image and file tools can support the visual inputs?
- Should layout proposals be submitted as annotated images, structured furniture coordinates, written plans or a combination?
- Which environment should store the household inventory and persistent state?

**Data provenance and privacy**

The household, user history, messages, floor plan, photos and furniture inventory will be fictional and created for this task. Visual assets will be generated or sourced from materials with clear reuse rights. No real household photos, private messages, account details or third-party personal information will be used.