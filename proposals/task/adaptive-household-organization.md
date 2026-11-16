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

The task combines visual-spatial reasoning with long-term personalization. A generic layout assistant might identify an empty corner and place a desk there. A capable personal agent must understand whether that corner has enough space, light, power access and clearance—and whether working there fits the user's habits.

The same physical space can have different meanings for different households. A large table might be essential for shared meals, a spare room might double as a reading space, and a piece of furniture might be worth keeping because of its personal significance. These details change which layout is best.

The agent must connect three kinds of context:

- **Spatial context:** room geometry, doors, windows, walkways, furniture dimensions, clearances and storage.
- **Personal context:** routines, preferences, accessibility needs, valued possessions, household relationships and previous decisions.
- **Practical context:** budget, rental restrictions, effort, timing and willingness to buy, move or discard items.

Visual input is essential: the agent must use photos and floor plans rather than relying only on text descriptions. Personal history is equally important: a physically feasible layout is not necessarily a good layout for this household.

This differs from a general routine-planning task. The central challenge is deciding how to change a real physical environment as a person's needs evolve.

## 5. Construction plan and effort

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| :--- | :--- | :--- | :--- |
| Persona, history and workspace | Create one fictional household, a two-bedroom apartment, floor plan, room photos, furniture inventory with dimensions, routines, preferences, budget and prior decisions. Include personal details that affect layout choices. | Consistent household profile and evidence distributed across sessions. Photos and floor plan must agree with dimensions and inventory. | 2 |
| User rollout and scenario script | **Sessions:** 5–6. **Simulated world time span:** 6 weeks. **Estimated total tokens:** 20,000–35,000 per complete scenario across all sessions, including dialogue, prior context and tool outputs. | Executable multi-session script with user messages, expected information disclosure, corrections, changes over time and response/no-reply branches. State must persist across sessions. | 2 |
| Environment integration | Reuse available file, memory and workspace tools where possible. Build a small household environment to expose photos, floor plans, furniture inventory, dimensions, budget and household constraints. Support updates to the proposed layout and inventory. | Runnable task package, deterministic initial state, reset procedure and checks that spatial data and tool actions work as intended. | 2–3 |
| Rubrics, reference and hints | Define criteria for spatial feasibility, use of personal context, constraint handling, budget, trade-off reasoning, continuity and communication. Create a reference solution and a fixed hint for each scenario. | Grader with measurable criteria, explicit success gates, partial-credit rules and a feasible reference solution. | 2 |
| Agent rollouts and analysis | Run at least one independent unhinted rollout per designated GPT, Claude and Gemini model; target five per model. Run separate hinted validation for each model. Record exact model versions, configurations, traces, scores and costs. | Evidence meeting the repository validation protocol, including failure analysis and reproducible run details. | 2–3 |

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